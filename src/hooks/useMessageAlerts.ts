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
  getNode,
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
  type PostKind,
  type PostSurface,
} from "../lib/chatStore";
import type { Friend } from "../lib/friendsStore";
import { getLocale, translate } from "../lib/i18n";
import { hashForRoomId } from "../lib/util";

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
      const bytes = await storage_get(wire.cid);
      const body = JSON.parse(new TextDecoder().decode(bytes)) as { text?: string };
      if (body.text) return body.text.slice(0, 120);
    } catch {
      // Body not fetchable yet — fall through to the generic label.
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
      getNode()
        .then((node) => node.joinRoomAsync(roomId))
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

    async function handlePost(wire: ChatPostWire, roomId: string) {
      if (!(await verifyWire(wire))) return;
      if (cancelled || seen.has(wire.id)) return;
      seen.add(wire.id);

      const isActive = roomId === activeRoomRef.current;
      if (!isActive) {
        setUnread((u) => ({ ...u, [roomId]: (u[roomId] ?? 0) + 1 }));
      }

      const friend = dmRoomsRef.current.get(roomId);
      if (!friend) return;

      // Persist background DM posts so the conversation is already there when
      // the user opens it (the active room's stream is stored by usePostStream;
      // storing here too is safe — appendPost dedups by id).
      if (!isActive) {
        appendWireLog(roomId, wire);
        let text: string | undefined;
        if (wire.kind === "text" || wire.kind === "project" || wire.kind === "event") {
          try {
            const bytes = await storage_get(wire.cid);
            const body = JSON.parse(new TextDecoder().decode(bytes)) as {
              text?: string;
              title?: string;
            };
            text = body.text;
          } catch {
            // Body unfetchable right now; store the post shell anyway.
          }
          if (cancelled) return;
        }
        appendPost({
          id: wire.id,
          roomId,
          surface: "chat",
          parentId: wire.parentId,
          fromId: wire.fromId,
          fromName: wire.fromName,
          timestamp: wire.timestamp,
          kind: wire.kind,
          cid: wire.cid,
          text,
          mimeType: wire.mimeType,
          fileName: wire.fileName,
          fileSize: wire.fileSize,
          reactions: [],
        });
      }

      if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
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
    async function handleDelete(wire: ChatPostDeleteWire, roomId: string) {
      if (!(await verifyWire(wire))) return;
      if (cancelled || seen.has(wire.id)) return;
      seen.add(wire.id);
      appendWireLog(roomId, wire);
      applyPostDelete("chat", roomId, wire.targetId, wire.fromId);
    }

    async function handleEdit(wire: ChatPostEditWire, roomId: string) {
      if (!(await verifyWire(wire))) return;
      if (cancelled || seen.has(wire.id)) return;
      seen.add(wire.id);
      appendWireLog(roomId, wire);
      let body: { text?: string; title?: string; startsAt?: number; endsAt?: number; location?: string };
      try {
        const bytes = await storage_get(wire.cid);
        body = JSON.parse(new TextDecoder().decode(bytes)) as typeof body;
      } catch {
        // Body not fetchable yet — the wire log entry above keeps this
        // replayable, so just skip applying it for now.
        return;
      }
      if (cancelled) return;
      applyPostEdit("chat", roomId, wire.targetId, wire.fromId, {
        cid: wire.cid,
        text: body.text,
        title: body.title,
        editedAt: wire.timestamp,
        startsAt: body.startsAt,
        endsAt: body.endsAt,
        location: body.location,
      });
    }

    const unsubscribe = subscribeEvent((eventType, _fromId, payload, evtRoomId) => {
      if (cancelled || !isRawEvent(eventType) || !evtRoomId) return;
      const decoded = decodeRawPayload(payload) as
        | ChatPostWire
        | ChatPostEditWire
        | ChatPostDeleteWire
        | null;
      if (decoded?.type === "tc-chat:post" && decoded.surface === "chat") {
        if (decoded.fromId === selfDid) return; // our own message, never "for me"
        // A message in the room on screen while the tab is visible needs neither
        // a badge nor a notification — the user is already looking at it.
        if (evtRoomId === activeRoomRef.current && !document.hidden) return;
        handlePost(decoded, evtRoomId);
      } else if (decoded?.type === "tc-chat:post-delete" && decoded.surface === "chat") {
        // Unlike posts, this has no self-skip: a delete from our OWN did on
        // another device must still apply here.
        if (evtRoomId === activeRoomRef.current) return;
        handleDelete(decoded, evtRoomId);
      } else if (decoded?.type === "tc-chat:post-edit" && decoded.surface === "chat") {
        if (evtRoomId === activeRoomRef.current) return;
        handleEdit(decoded, evtRoomId);
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
