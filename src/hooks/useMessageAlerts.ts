// Watches chat traffic across every joined room — not just the one on screen —
// to (a) keep an unread count per room and (b) raise a desktop notification
// when a DM addressed to us arrives while we aren't looking at it.
//
// The node stays joined to a room's swarm for the whole session (useChatRoom
// never leaves on switch), and this hook additionally joins every accepted
// friend's DM room up front, so "a message for me" can arrive even though the
// DM isn't the active room. Wires from non-active rooms are verified and
// persisted here (usePostStream only stores the active room's), so the DM is
// already populated when the user clicks the badge. This hook is also the
// ONLY listener for post-delete/post-edit wires targeting a background room —
// usePostStream is only mounted for the active room — so those are verified
// and applied here too (silently: no badge, no notification, they're
// maintenance on content the user isn't looking at).
import { useEffect, useRef, useState } from "preact/hooks";
import {
  joinAppRoom,
  subscribeEvent,
  isRawEvent,
  decodeRawPayload,
  storage_get,
} from "../lib/mistClient";
import { verifyWire } from "../lib/wireSign";
import {
  appendPost,
  appendWireLog,
  applyPostDelete,
  applyPostEdit,
  applyReaction,
  type PostKind,
  type PostSurface,
} from "../lib/chatStore";
import type { Friend } from "../lib/friendsStore";
import { getLocale, translate } from "../lib/i18n";
import { hashForRoomId } from "../lib/util";
import { decryptPostBytes, isPostEnc, type PostEnc } from "../crypto/postCipher";
import { isMuted } from "../lib/muteStore";
import { shouldBadgeRoom, shouldNotifyRoom } from "../lib/roomNotifyStore";

function isPostSurface(surface: unknown): surface is PostSurface {
  return surface === "chat" || surface === "board" || surface === "calendar" || surface === "gallery";
}

interface PostBody {
  text?: string; title?: string; roles?: string[]; tags?: string[];
  startsAt?: number; endsAt?: number; location?: string;
  thumbCid?: string; thumbMimeType?: string; capacity?: number;
}

interface ChatPostWire extends Record<string, unknown> {
  type: "tc-chat:post";
  surface: PostSurface;
  id: string;
  parentId: string | null;
  fromId: string;
  fromName: string;
  timestamp: number;
  kind: PostKind;
  cid: string;
  /** Content-key envelope for the encrypted body at `cid` (see postCipher). Absent = legacy plaintext CID. */
  enc?: PostEnc;
  mimeType?: string;
  fileName?: string;
  fileSize?: number;
  signature: string;
}

// Author-only mutations of an existing post — same shapes as usePostStream's
// PostEditWire/PostDeleteWire (see usePostStream.ts). Kept as a local copy
// rather than a shared import since the two hooks apply them under different
// gating rules (active-room visibility vs. background-room delivery).
interface ChatPostEditWire extends Record<string, unknown> {
  type: "tc-chat:post-edit";
  id: string;
  surface: PostSurface;
  targetId: string;
  cid: string;
  /** Content-key envelope for the encrypted body at `cid` (see postCipher). Absent = legacy plaintext CID. */
  enc?: PostEnc;
  fromId: string;
  fromName: string;
  timestamp: number;
  signature: string;
}

interface ChatPostDeleteWire extends Record<string, unknown> {
  type: "tc-chat:post-delete";
  id: string;
  surface: PostSurface;
  targetId: string;
  fromId: string;
  fromName: string;
  timestamp: number;
  signature: string;
}

export type NotifPermission = NotificationPermission | "unsupported";

function currentPermission(): NotifPermission {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

/** Best-effort text snippet for the notification body (never throws). */
async function snippetFor(wire: ChatPostWire): Promise<string> {
  if (wire.kind === "text") {
    try {
      const raw = await storage_get(wire.cid);
      // Bodies are encrypted-at-rest when the wire carries an `enc` envelope
      // (see postCipher) — legacy wires without one are still plaintext.
      const plain = wire.enc && isPostEnc(wire.enc) ? await decryptPostBytes(wire.enc, raw) : raw;
      const body = JSON.parse(new TextDecoder().decode(plain)) as { text?: string };
      if (body.text) return body.text.slice(0, 120);
    } catch {
      // Body not fetchable/decryptable yet — fall through to the generic label.
    }
  }
  if (wire.fileName) return wire.fileName;
  return translate(getLocale(), "chat.dmNotifBody");
}

export function useMessageAlerts(
  activeRoomId: string | null,
  selfDid: string | null,
  friends: Friend[],
) {
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [notifPermission, setNotifPermission] = useState<NotifPermission>(() =>
    currentPermission(),
  );

  const activeRoomRef = useRef(activeRoomId);
  activeRoomRef.current = activeRoomId;
  // DM room id -> friend, so the receive path can tell "a message for me"
  // (a DM swarm only we and the friend know) from ordinary room traffic.
  const dmRoomsRef = useRef(new Map<string, Friend>());
  dmRoomsRef.current = new Map(
    friends.filter((f) => f.status === "accepted").map((f) => [f.roomId, f]),
  );

  // Join every accepted friend's DM swarm in the background so their messages
  // reach us without the DM being open. Joins are once-per-session (the node
  // never leaves a room until reload, matching useChatRoom's behavior).
  const joinedRef = useRef(new Set<string>());
  const dmRoomsKey = friends
    .filter((f) => f.status === "accepted")
    .map((f) => f.roomId)
    .sort()
    .join(",");
  useEffect(() => {
    if (!selfDid || !dmRoomsKey) return;
    for (const roomId of dmRoomsKey.split(",")) {
      if (joinedRef.current.has(roomId)) continue;
      joinedRef.current.add(roomId);
      joinAppRoom(roomId)
        .catch((err) => {
          // Retry next time the friends list changes rather than never.
          joinedRef.current.delete(roomId);
          console.debug("background DM join failed:", err);
        });
    }
  }, [selfDid, dmRoomsKey]);

  useEffect(() => {
    if (!selfDid) return;
    let cancelled = false;
    // A wire can reach us more than once (e.g. a history replay after a
    // rejoin) — count and notify each post id at most once per session.
    const seen = new Set<string>();

    async function handlePost(wire: ChatPostWire, roomId: string, restored = false) {
      if (!(await verifyWire(wire))) return;
      if (cancelled || !restored && seen.has(roomId + ":" + wire.id)) return;
      if (!restored) seen.add(roomId + ":" + wire.id);

      const isActive = roomId === activeRoomRef.current;
      // Silencing a room gates only the two alerting side effects — the badge
      // here and the notification below — and each independently, so "badge but
      // no popup" is expressible. Everything else in this function still runs:
      // a silenced room is verified and persisted exactly as before. That's the
      // whole distinction from muting a person (isMuted, above), which drops
      // the wire outright. Don't hoist either check to the subscribeEvent
      // callback — that would also skip the background-DM persistence below.
      if (wire.surface === "chat" && !restored && wire.fromId !== selfDid && !isActive && shouldBadgeRoom(roomId)) {
        setUnread((u) => ({ ...u, [roomId]: (u[roomId] ?? 0) + 1 }));
      }

      const friend = dmRoomsRef.current.get(roomId);
      if (!friend) return;

      // Persist background DM posts so the conversation is already there when
      // the user opens it (the active room's stream is stored by usePostStream;
      // storing here too is safe — appendPost dedups by id).
      if (!isActive) {
        appendWireLog(roomId, wire);
        // wire.enc is untrusted input off the wire — validate its shape
        // before ever handing it to the cipher (same rule as usePostStream).
        // A malformed enc is treated like any other body-fetch failure below.
        let enc: PostEnc | undefined;
        if (wire.enc !== undefined) {
          if (isPostEnc(wire.enc)) enc = wire.enc;
          else console.warn("discarding post with malformed enc", wire.id);
        }
        let body: PostBody = {};
        if (wire.kind === "text" || wire.kind === "project" || wire.kind === "event") {
          try {
            const raw = await storage_get(wire.cid);
            // Legacy wires (no enc) are still plaintext CIDs; new wires carry
            // an encrypted blob keyed by the wire's enc envelope.
            const plain = enc ? await decryptPostBytes(enc, raw) : raw;
            body = JSON.parse(new TextDecoder().decode(plain)) as PostBody;
          } catch {
            // Body unfetchable/undecryptable right now; store the post shell anyway.
          }
          if (cancelled) return;
        }
        appendPost({
          id: wire.id,
          roomId,
          surface: wire.surface,
          parentId: wire.parentId,
          fromId: wire.fromId,
          fromName: wire.fromName,
          timestamp: wire.timestamp,
          kind: wire.kind,
          cid: wire.cid,
          enc,
          text: body.text,
          title: body.title,
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
        });
      }

      if (wire.surface !== "chat" || restored || wire.fromId === selfDid) return;
      if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
      if (!shouldNotifyRoom(roomId)) return;
      const body = await snippetFor(wire);
      if (cancelled) return;
      const n = new Notification(friend.name || wire.fromName, { body, tag: wire.id });
      n.onclick = () => {
        window.focus();
        // Route through the hash so App's hashchange listener switches rooms.
        window.location.hash = hashForRoomId(roomId);
        n.close();
      };
    }

    // A delete/edit for the active room is already handled by that room's
    // usePostStream (mounted regardless of tab visibility) — applying it a
    // second time here would be redundant, not incorrect (both paths dedup
    // via appendWireLog/seen), so we skip it purely to avoid double work.
    async function handleDelete(wire: ChatPostDeleteWire, roomId: string, restored = false) {
      if (!(await verifyWire(wire))) return;
      if (cancelled || !restored && seen.has(roomId + ":" + wire.id)) return;
      if (!restored) seen.add(roomId + ":" + wire.id);
      appendWireLog(roomId, wire);
      applyPostDelete(wire.surface, roomId, wire.targetId, wire.fromId);
    }

    async function handleEdit(wire: ChatPostEditWire, roomId: string, restored = false) {
      if (!(await verifyWire(wire))) return;
      if (cancelled || !restored && seen.has(roomId + ":" + wire.id)) return;
      if (!restored) seen.add(roomId + ":" + wire.id);
      appendWireLog(roomId, wire);
      let enc: PostEnc | undefined;
      if (wire.enc !== undefined) {
        if (isPostEnc(wire.enc)) enc = wire.enc;
        else {
          console.warn("discarding post edit with malformed enc", wire.id);
          return;
        }
      }
      let body: PostBody;
      try {
        const raw = await storage_get(wire.cid);
        const plain = enc ? await decryptPostBytes(enc, raw) : raw;
        body = JSON.parse(new TextDecoder().decode(plain)) as typeof body;
      } catch {
        // Body not fetchable/decryptable yet — the wire log entry above keeps
        // this replayable, so just skip applying it for now.
        return;
      }
      if (cancelled) return;
      applyPostEdit(wire.surface, roomId, wire.targetId, wire.fromId, {
        cid: wire.cid,
        enc,
        text: body.text,
        title: body.title,
        editedAt: wire.timestamp,
        editId: wire.id,
        startsAt: body.startsAt,
        endsAt: body.endsAt,
        location: body.location,
        thumbCid: body.thumbCid,
        thumbMimeType: body.thumbMimeType,
        capacity: body.capacity,
      });
    }

    const unsubscribe = subscribeEvent((eventType, _fromId, payload, evtRoomId, restored) => {
      if (cancelled || !isRawEvent(eventType) || !evtRoomId) return;
      const decoded = decodeRawPayload(payload) as
        | ChatPostWire
        | ChatPostEditWire
        | ChatPostDeleteWire
        | null;
      if (decoded && decoded.roomId !== undefined && decoded.roomId !== evtRoomId) return;
      if (restored && (evtRoomId === activeRoomRef.current || !dmRoomsRef.current.has(evtRoomId))) return;
      // Other surfaces share DM persistence/replay, while chat alone raises alerts.
      if (decoded && decoded.surface !== undefined && decoded.surface !== "chat" &&
          (evtRoomId === activeRoomRef.current || !dmRoomsRef.current.has(evtRoomId))) return;
      if (decoded?.type === "tc-chat:post" && isPostSurface(decoded.surface)) {
        if (decoded.fromId === selfDid && !dmRoomsRef.current.has(evtRoomId)) return;
        // A muted peer raises no badge and no notification, and their post is
        // never persisted for a background room. usePostStream applies the
        // same drop for the active room; deletes/edits below are deliberately
        // exempt (they only ever retract the muted peer's own content).
        if (isMuted(decoded.fromId)) return;
        // A message in the room on screen while the tab is visible needs neither
        // a badge nor a notification — the user is already looking at it.
        if (evtRoomId === activeRoomRef.current && !document.hidden) return;
        return handlePost(decoded, evtRoomId, restored);
      } else if ((decoded as { type?: string } | null)?.type === "tc-chat:reaction") {
        if (evtRoomId === activeRoomRef.current || !dmRoomsRef.current.has(evtRoomId)) return;
        return (async () => {
          const wire = decoded as unknown as Record<string, unknown> & { id: string; fromId: string; fromName: string; targetId: string; emoji: string; op: "add" | "remove"; timestamp: number };
          if (!await verifyWire(wire) || cancelled || isMuted(wire.fromId) || (wire.op !== "add" && wire.op !== "remove")) return;
          appendWireLog(evtRoomId, wire);
          applyReaction(evtRoomId, wire.targetId, { emoji: wire.emoji, fromId: wire.fromId, fromName: wire.fromName }, wire.op,
            { timestamp: wire.timestamp, id: wire.id });
        })();
      } else if (decoded?.type === "tc-chat:post-delete" && isPostSurface(decoded.surface)) {
        // Unlike posts, this has no self-skip: a delete from our OWN did on
        // another device must still apply here.
        if (evtRoomId === activeRoomRef.current) return;
        return handleDelete(decoded, evtRoomId, restored);
      } else if (decoded?.type === "tc-chat:post-edit" && isPostSurface(decoded.surface)) {
        if (evtRoomId === activeRoomRef.current) return;
        return handleEdit(decoded, evtRoomId, restored);
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [selfDid]);

  // Opening a room reads it — drop its badge.
  useEffect(() => {
    if (!activeRoomId) return;
    setUnread((u) => {
      if (!u[activeRoomId]) return u;
      const { [activeRoomId]: _read, ...rest } = u;
      return rest;
    });
  }, [activeRoomId]);

  async function requestNotifications(): Promise<void> {
    if (typeof Notification === "undefined") return;
    try {
      await Notification.requestPermission();
    } finally {
      setNotifPermission(currentPermission());
    }
  }

  return { unread, notifPermission, requestNotifications };
}
