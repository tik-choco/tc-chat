// The one distribution engine behind BOTH the chat and the board. A stream is
// bound to a room + a `surface` ("chat" | "board"); chat and board are just two
// instances of this hook over the same signed-wire protocol. Every entry — a
// chat message, a media/file attachment, a recruitment post, a thread's opening
// post, a nested comment — is a PostNode.
//
// Structured bodies (title/text/roles/tags) are content-addressed via
// storage_add() and only the CID + metadata is broadcast; media/file kinds
// point their CID straight at the file bytes. Reactions ride their own tiny
// signed wire and are merged from a shared per-room index. Every signed wire is
// logged (appendWireLog) so a late joiner can replay verifiable history.
import { useEffect, useRef, useState } from "preact/hooks";
import {
  getNode,
  subscribeEvent,
  isRawEvent,
  decodeRawPayload,
  storage_add,
  storage_get,
  DELIVERY_RELIABLE,
} from "../lib/mistClient";
import {
  appendPost,
  appendWireLog,
  applyPostDelete,
  applyPostEdit,
  applyReaction,
  loadPosts,
  type PostNode,
  type PostSurface,
  type PostKind,
  type ReactionOp,
} from "../lib/chatStore";
import { ensureDidIdentity } from "../crypto/didIdentity";
import { signWireFields, verifyWire } from "../lib/wireSign";
import type { TcStorageFileEntry } from "../interop/tcStorageFiles";
import { resolveTcStorageFileContent } from "../interop/tcStorageContent";
import { newId } from "../lib/util";

interface PostWire extends Record<string, unknown> {
  type: "tc-chat:post";
  surface: PostSurface;
  id: string;
  parentId: string | null;
  fromId: string;
  fromName: string;
  timestamp: number;
  kind: PostKind;
  cid: string;
  mimeType?: string;
  fileName?: string;
  fileSize?: number;
  signature: string;
}

interface ReactionWire extends Record<string, unknown> {
  type: "tc-chat:reaction";
  id: string;
  targetId: string;
  emoji: string;
  op: ReactionOp;
  fromId: string;
  fromName: string;
  timestamp: number;
  signature: string;
}

// Author-only mutations of an existing post. Both are signed like every other
// wire, but the signature alone only proves the sender wrote the wire — what
// makes them author-ONLY is the receive-side rule that `fromId` must equal the
// targeted post's stored `fromId` (enforced in applyPostEdit/applyPostDelete).
interface PostEditWire extends Record<string, unknown> {
  type: "tc-chat:post-edit";
  id: string;
  surface: PostSurface;
  targetId: string;
  /** The edited JSON body, re-stored via storage_add (structured kinds only). */
  cid: string;
  fromId: string;
  fromName: string;
  timestamp: number;
  signature: string;
}

interface PostDeleteWire extends Record<string, unknown> {
  type: "tc-chat:post-delete";
  id: string;
  surface: PostSurface;
  targetId: string;
  fromId: string;
  fromName: string;
  timestamp: number;
  signature: string;
}

/** JSON body used for the structured kinds (text/project/event). */
interface PostBody {
  title?: string;
  text?: string;
  roles?: string[];
  tags?: string[];
  startsAt?: number;
  endsAt?: number;
  location?: string;
  thumbCid?: string;
  thumbMimeType?: string;
  capacity?: number;
}

export interface CreatePostInput {
  parentId: string | null;
  kind: PostKind;
  title?: string;
  text?: string;
  roles?: string[];
  tags?: string[];
  startsAt?: number;
  endsAt?: number;
  location?: string;
  /** Downscaled thumbnail image to attach (board root posts). */
  thumb?: { bytes: Uint8Array; mimeType: string };
  /** Recruitment capacity (project kind): how many members the post is looking for. */
  capacity?: number;
}

function structuredKind(kind: PostKind): boolean {
  return kind === "text" || kind === "project" || kind === "event";
}

export function usePostStream(roomId: string | null, surface: PostSurface, localName: string) {
  const [nodes, setNodes] = useState<PostNode[]>([]);
  const localNameRef = useRef(localName);
  localNameRef.current = localName;

  useEffect(() => {
    if (!roomId) {
      setNodes([]);
      return;
    }
    setNodes(loadPosts(surface, roomId));

    let cancelled = false;
    // Only accept wires that arrived on THIS room's swarm topic. The node may be
    // joined to several rooms at once, and every subscriber sees every room's
    // events, so without this a message from another room would be stored under
    // whichever room we happen to be viewing. The swarm topic is the raw room
    // id itself — no derived/obscured channel id.
    const channelId = roomId;

    async function hydratePost(wire: PostWire) {
      try {
        if (!(await verifyWire(wire))) {
          console.warn("discarding post with invalid signature", wire.id);
          return;
        }
        appendWireLog(roomId!, wire);
        const identity = await ensureDidIdentity();
        // Only structured kinds carry a JSON body worth fetching up front;
        // media/file resolve their CID lazily when rendered.
        let body: PostBody = {};
        if (structuredKind(wire.kind)) {
          const bytes = await storage_get(wire.cid);
          if (cancelled) return;
          body = JSON.parse(new TextDecoder().decode(bytes)) as PostBody;
        }
        if (cancelled) return;
        setNodes(
          appendPost({
            id: wire.id,
            roomId: roomId!,
            surface,
            parentId: wire.parentId,
            fromId: wire.fromId,
            fromName: wire.fromId === identity.did ? "自分" : wire.fromName,
            timestamp: wire.timestamp,
            kind: wire.kind,
            cid: wire.cid,
            title: body.title,
            text: body.text,
            roles: body.roles,
            tags: body.tags,
            startsAt: body.startsAt,
            endsAt: body.endsAt,
            location: body.location,
            thumbCid: body.thumbCid,
            thumbMimeType: body.thumbMimeType,
            capacity: body.capacity,
            mimeType: wire.mimeType,
            fileName: wire.fileName,
            fileSize: wire.fileSize,
            reactions: [],
          }),
        );
      } catch (err) {
        console.error("failed to hydrate post", err);
      }
    }

    async function hydrateReaction(wire: ReactionWire) {
      try {
        if (!(await verifyWire(wire))) {
          console.warn("discarding reaction with invalid signature", wire.id);
          return;
        }
        appendWireLog(roomId!, wire);
        const identity = await ensureDidIdentity();
        if (cancelled) return;
        applyReaction(
          roomId!,
          wire.targetId,
          {
            emoji: wire.emoji,
            fromId: wire.fromId,
            fromName: wire.fromId === identity.did ? "自分" : wire.fromName,
          },
          wire.op,
        );
        setNodes(loadPosts(surface, roomId!));
      } catch (err) {
        console.error("failed to apply reaction", err);
      }
    }

    async function hydratePostEdit(wire: PostEditWire) {
      try {
        if (!(await verifyWire(wire))) {
          console.warn("discarding post edit with invalid signature", wire.id);
          return;
        }
        appendWireLog(roomId!, wire);
        // Edits only exist for structured kinds, so the new CID is always a
        // JSON body worth fetching before applying.
        const bytes = await storage_get(wire.cid);
        if (cancelled) return;
        const body = JSON.parse(new TextDecoder().decode(bytes)) as PostBody;
        // applyPostEdit re-checks that wire.fromId matches the stored post's
        // author — a valid signature only proves the sender wrote the wire,
        // not that they own the target.
        applyPostEdit(surface, roomId!, wire.targetId, wire.fromId, {
          cid: wire.cid,
          text: body.text,
          title: body.title,
          editedAt: wire.timestamp,
          startsAt: body.startsAt,
          endsAt: body.endsAt,
          location: body.location,
          thumbCid: body.thumbCid,
          thumbMimeType: body.thumbMimeType,
          capacity: body.capacity,
        });
        setNodes(loadPosts(surface, roomId!));
      } catch (err) {
        console.error("failed to apply post edit", err);
      }
    }

    async function hydratePostDelete(wire: PostDeleteWire) {
      try {
        if (!(await verifyWire(wire))) {
          console.warn("discarding post delete with invalid signature", wire.id);
          return;
        }
        appendWireLog(roomId!, wire);
        if (cancelled) return;
        // Same author-only boundary as edits (see applyPostDelete).
        applyPostDelete(surface, roomId!, wire.targetId, wire.fromId);
        setNodes(loadPosts(surface, roomId!));
      } catch (err) {
        console.error("failed to apply post delete", err);
      }
    }

    const unsubscribe = subscribeEvent((eventType, _fromId, payload, evtRoomId) => {
      if (!isRawEvent(eventType)) return;
      if (evtRoomId && evtRoomId !== channelId) return; // not this room's traffic
      const decoded = decodeRawPayload(payload) as
        | PostWire
        | ReactionWire
        | PostEditWire
        | PostDeleteWire
        | null;
      if (decoded?.type === "tc-chat:post" && (decoded as PostWire).surface === surface) {
        hydratePost(decoded as PostWire);
      } else if (decoded?.type === "tc-chat:reaction") {
        hydrateReaction(decoded as ReactionWire);
      } else if (
        decoded?.type === "tc-chat:post-edit" &&
        (decoded as PostEditWire).surface === surface
      ) {
        hydratePostEdit(decoded as PostEditWire);
      } else if (
        decoded?.type === "tc-chat:post-delete" &&
        (decoded as PostDeleteWire).surface === surface
      ) {
        hydratePostDelete(decoded as PostDeleteWire);
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [roomId, surface]);

  /** Text / project / event posts and comments (a structured JSON body). */
  async function createPost(input: CreatePostInput) {
    if (!roomId) return;
    // Every other kind requires body text, but a calendar event's description
    // is optional — only its title (checked here) and startsAt (enforced by
    // the calendar UI) are mandatory.
    if (!input.text?.trim() && !input.title?.trim()) return;
    const identity = await ensureDidIdentity();
    const thumbCid = input.thumb
      ? await storage_add(`${newId()}-thumb`, input.thumb.bytes)
      : undefined;
    const body: PostBody = {
      title: input.title?.trim() || undefined,
      text: input.text?.trim() || undefined,
      roles: input.roles?.length ? input.roles : undefined,
      tags: input.tags?.length ? input.tags : undefined,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      location: input.location?.trim() || undefined,
      thumbCid,
      thumbMimeType: thumbCid ? input.thumb!.mimeType : undefined,
      capacity:
        Number.isInteger(input.capacity) && input.capacity! > 0 ? input.capacity : undefined,
    };
    const cid = await storage_add(`${newId()}.json`, new TextEncoder().encode(JSON.stringify(body)));
    const id = newId();
    const timestamp = Date.now();
    const unsigned = {
      type: "tc-chat:post" as const,
      surface,
      id,
      parentId: input.parentId,
      fromId: identity.did,
      fromName: localNameRef.current,
      timestamp,
      kind: input.kind,
      cid,
    };
    const wire: PostWire = { ...unsigned, signature: await signWireFields(unsigned) };
    await publishPost(wire, {
      id,
      roomId,
      surface,
      parentId: input.parentId,
      fromId: identity.did,
      fromName: "自分",
      timestamp,
      kind: input.kind,
      cid,
      ...body,
    });
  }

  /** A freshly uploaded media file (its bytes become the CID body). */
  async function createMedia(file: File) {
    if (!roomId) return;
    const identity = await ensureDidIdentity();
    const cid = await storage_add(file.name, new Uint8Array(await file.arrayBuffer()));
    const id = newId();
    const timestamp = Date.now();
    const meta = { mimeType: file.type, fileName: file.name, fileSize: file.size };
    const unsigned = {
      type: "tc-chat:post" as const,
      surface,
      id,
      parentId: null,
      fromId: identity.did,
      fromName: localNameRef.current,
      timestamp,
      kind: "media" as const,
      cid,
      ...meta,
    };
    const wire: PostWire = { ...unsigned, signature: await signWireFields(unsigned) };
    await publishPost(wire, {
      id,
      roomId,
      surface,
      parentId: null,
      fromId: identity.did,
      fromName: "自分",
      timestamp,
      kind: "media",
      cid,
      ...meta,
    });
  }

  /**
   * A file saved in tc-storage. Its own CID can't be reused on the wire —
   * tc-storage stores every file as a passphrase-encrypted envelope that only
   * this browser's local keys can open (see tcStorageContent.ts) — so posting
   * one means: decrypt locally, then re-add the PLAINTEXT bytes under a new
   * CID, exactly like a fresh upload. Sharing into a room is deliberately a
   * decryption boundary: everyone in the room gets viewable content. Throws
   * when no local key opens the envelope (the caller surfaces the failure).
   */
  async function createStoredFile(entry: TcStorageFileEntry) {
    if (!roomId) return;
    const identity = await ensureDidIdentity();
    const { bytes, mimeType } = await resolveTcStorageFileContent(entry);
    const cid = await storage_add(entry.name, bytes);
    const id = newId();
    const timestamp = Date.now();
    const meta = {
      mimeType: mimeType || entry.mimeType,
      fileName: entry.name,
      fileSize: bytes.byteLength,
    };
    const unsigned = {
      type: "tc-chat:post" as const,
      surface,
      id,
      parentId: null,
      fromId: identity.did,
      fromName: localNameRef.current,
      timestamp,
      kind: "file" as const,
      cid,
      ...meta,
    };
    const wire: PostWire = { ...unsigned, signature: await signWireFields(unsigned) };
    await publishPost(wire, {
      id,
      roomId,
      surface,
      parentId: null,
      fromId: identity.did,
      fromName: "自分",
      timestamp,
      kind: "file",
      cid,
      ...meta,
    });
  }

  async function publishPost(wire: PostWire, optimistic: Omit<PostNode, "reactions">) {
    const node = await getNode();
    // Room-scoped so the wire only reaches peers in this room's swarm.
    node.sendMessage(null, wire, DELIVERY_RELIABLE, roomId!);
    appendWireLog(roomId!, wire);
    setNodes(appendPost({ ...optimistic, reactions: [] }));
  }

  async function toggleReaction(targetId: string, emoji: string) {
    if (!roomId) return;
    const node = await getNode();
    const identity = await ensureDidIdentity();
    const already = loadPosts(surface, roomId)
      .find((n) => n.id === targetId)
      ?.reactions.some((r) => r.emoji === emoji && r.fromId === identity.did);
    const op: ReactionOp = already ? "remove" : "add";
    const timestamp = Date.now();
    const unsigned = {
      type: "tc-chat:reaction" as const,
      id: newId(),
      targetId,
      emoji,
      op,
      fromId: identity.did,
      fromName: localNameRef.current,
      timestamp,
    };
    const wire: ReactionWire = { ...unsigned, signature: await signWireFields(unsigned) };
    node.sendMessage(null, wire, DELIVERY_RELIABLE, roomId);
    appendWireLog(roomId, wire);
    applyReaction(roomId, targetId, { emoji, fromId: identity.did, fromName: "自分" }, op);
    setNodes(loadPosts(surface, roomId));
  }

  /**
   * Edits the local author's OWN structured post (text/project/event). The
   * edited body is re-stored (new CID) and broadcast as a signed post-edit
   * wire. Media/file posts aren't editable — their CID is the file bytes.
   */
  async function editPost(
    targetId: string,
    input: {
      text?: string;
      title?: string;
      startsAt?: number;
      endsAt?: number;
      location?: string;
      /** undefined = keep existing thumbnail, null = remove it, object = replace it. */
      thumb?: { bytes: Uint8Array; mimeType: string } | null;
      /** undefined = keep existing capacity, null = remove it, number = set it. */
      capacity?: number | null;
    },
  ) {
    if (!roomId) return;
    const identity = await ensureDidIdentity();
    const target = loadPosts(surface, roomId).find((n) => n.id === targetId);
    // Never emit an edit for a post we don't own — receivers would reject it
    // anyway (applyPostEdit), this just keeps the guard on both sides.
    if (!target || target.fromId !== identity.did || target.deleted) return;
    if (!structuredKind(target.kind)) return;
    // A calendar event's description is optional (only title/startsAt are
    // mandatory) — every other structured kind still requires body text.
    if (!input.text?.trim() && !input.title?.trim() && target.kind !== "event") return;
    // thumb: undefined keeps the existing thumbnail, null drops it, and an
    // object replaces it with a freshly stored image.
    const thumbCid =
      input.thumb === undefined
        ? target.thumbCid
        : input.thumb === null
          ? undefined
          : await storage_add(`${newId()}-thumb`, input.thumb.bytes);
    const thumbMimeType =
      input.thumb === undefined
        ? target.thumbMimeType
        : input.thumb === null
          ? undefined
          : input.thumb.mimeType;
    const body: PostBody = {
      // A caller that doesn't mention a field keeps the existing one (chat
      // edits only ever pass text); roles/tags always survive an edit.
      title: input.title !== undefined ? input.title.trim() || undefined : target.title,
      text: input.text !== undefined ? input.text.trim() || undefined : target.text,
      roles: target.roles?.length ? target.roles : undefined,
      tags: target.tags?.length ? target.tags : undefined,
      startsAt: input.startsAt ?? target.startsAt,
      endsAt: input.endsAt ?? target.endsAt,
      location: input.location !== undefined ? input.location.trim() || undefined : target.location,
      thumbCid,
      thumbMimeType,
      capacity: input.capacity === undefined ? target.capacity : (input.capacity ?? undefined),
    };
    const cid = await storage_add(`${newId()}.json`, new TextEncoder().encode(JSON.stringify(body)));
    const timestamp = Date.now();
    const unsigned = {
      type: "tc-chat:post-edit" as const,
      id: newId(),
      surface,
      targetId,
      cid,
      fromId: identity.did,
      fromName: localNameRef.current,
      timestamp,
    };
    const wire: PostEditWire = { ...unsigned, signature: await signWireFields(unsigned) };
    const node = await getNode();
    // Room-scoped so the wire only reaches peers in this room's swarm.
    node.sendMessage(null, wire, DELIVERY_RELIABLE, roomId);
    appendWireLog(roomId, wire);
    applyPostEdit(surface, roomId, targetId, identity.did, {
      cid,
      text: body.text,
      title: body.title,
      editedAt: timestamp,
      startsAt: body.startsAt,
      endsAt: body.endsAt,
      location: body.location,
      thumbCid: body.thumbCid,
      thumbMimeType: body.thumbMimeType,
      capacity: body.capacity,
    });
    setNodes(loadPosts(surface, roomId));
  }

  /** Tombstones the local author's OWN post (any kind) and broadcasts it. */
  async function deletePost(targetId: string) {
    if (!roomId) return;
    const identity = await ensureDidIdentity();
    const target = loadPosts(surface, roomId).find((n) => n.id === targetId);
    if (!target || target.fromId !== identity.did || target.deleted) return;
    const unsigned = {
      type: "tc-chat:post-delete" as const,
      id: newId(),
      surface,
      targetId,
      fromId: identity.did,
      fromName: localNameRef.current,
      timestamp: Date.now(),
    };
    const wire: PostDeleteWire = { ...unsigned, signature: await signWireFields(unsigned) };
    const node = await getNode();
    node.sendMessage(null, wire, DELIVERY_RELIABLE, roomId);
    appendWireLog(roomId, wire);
    applyPostDelete(surface, roomId, targetId, identity.did);
    setNodes(loadPosts(surface, roomId));
  }

  return { nodes, createPost, createMedia, createStoredFile, toggleReaction, editPost, deletePost };
}
