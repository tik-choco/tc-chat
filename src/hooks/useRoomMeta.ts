// Propagates a room's SHARED name/icon (set by any peer) to everyone else in
// the room, and collects whatever the room has already converged on — so
// every peer sees the same room name/icon, not just whoever set it locally.
// Mirrors useProfileDirectory.ts's broadcast/merge pattern but keyed by room
// rather than by peer: last-write-wins by `updatedAt`, greeted to late
// joiners, re-announced on join so peers who missed the original broadcast
// still converge.
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import {
  getNode,
  subscribeEvent,
  isRawEvent,
  decodeRawPayload,
  EVENT_PEER_CONNECTED,
  DELIVERY_RELIABLE,
} from "../lib/mistClient";
import { ensureDidIdentity } from "../crypto/didIdentity";
import { signWireFields, verifyWire } from "../lib/wireSign";
import {
  loadRoomMetaStore,
  mergeRoomMeta,
  getRoomMeta,
  type RoomMetaStore,
  type RoomMetaRecord,
} from "../lib/roomMetaStore";

interface RoomMetaWire extends Record<string, unknown> {
  type: "tc-chat:room-meta";
  fromId: string;
  name: string;
  iconCid: string;
  updatedAt: number;
  signature: string;
}

async function broadcastRoomMeta(
  meta: RoomMetaRecord,
  target: string | null,
  channelId: string,
): Promise<void> {
  const node = await getNode();
  const identity = await ensureDidIdentity();
  const unsigned = {
    type: "tc-chat:room-meta" as const,
    fromId: identity.did,
    name: meta.name || "",
    iconCid: meta.iconCid || "",
    updatedAt: meta.updatedAt,
  };
  const wire: RoomMetaWire = { ...unsigned, signature: await signWireFields(unsigned) };
  node.sendMessage(target, wire, DELIVERY_RELIABLE, channelId);
}

export function useRoomMeta(roomId: string | null): {
  meta: RoomMetaRecord | undefined;
  metaFor: (roomId: string) => RoomMetaRecord | undefined;
  setRoomMeta: (fields: { name?: string; iconCid?: string }) => void;
} {
  const [store, setStore] = useState<RoomMetaStore>(() => loadRoomMetaStore());
  const metaRef = useRef<RoomMetaRecord | undefined>(undefined);
  metaRef.current = getRoomMeta(store, roomId);

  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    // The swarm topic is the raw room id itself — no derived/obscured channel
    // id, so any peer joining the same room name lands in the same swarm.
    const channelId = roomId;

    async function handleWire(wire: RoomMetaWire) {
      if (!(await verifyWire(wire))) return;
      if (cancelled) return;
      setStore((s) =>
        mergeRoomMeta(s, channelId, {
          name: wire.name || undefined,
          iconCid: wire.iconCid || undefined,
          updatedAt: wire.updatedAt,
        }),
      );
    }

    const unsubscribe = subscribeEvent((eventType, fromId, payload, evtRoomId) => {
      if (cancelled) return;
      if (eventType === EVENT_PEER_CONNECTED) {
        // Greet the newcomer with whatever we already know for this room, so
        // late joiners converge even if whoever originally set it has left.
        const current = metaRef.current;
        if (current) broadcastRoomMeta(current, fromId, channelId).catch(() => {});
        return;
      }
      if (!isRawEvent(eventType)) return;
      if (evtRoomId && evtRoomId !== channelId) return; // another room's meta
      const decoded = decodeRawPayload(payload) as RoomMetaWire | null;
      if (decoded?.type === "tc-chat:room-meta") handleWire(decoded);
    });

    // Re-announce what we already know on join too, not just to new
    // joiners — peers already in the room may have joined before us and
    // missed the original broadcast.
    const current = metaRef.current;
    if (current) broadcastRoomMeta(current, null, channelId).catch(() => {});

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [roomId]);

  const setRoomMeta = useCallback(
    (fields: { name?: string; iconCid?: string }) => {
      if (!roomId) return;
      const next: RoomMetaRecord = {
        name: fields.name?.trim() || undefined,
        iconCid: fields.iconCid || undefined,
        updatedAt: Date.now(),
      };
      setStore((s) => mergeRoomMeta(s, roomId, next));
      broadcastRoomMeta(next, null, roomId).catch(() => {});
    },
    [roomId],
  );

  const metaFor = useCallback((id: string) => getRoomMeta(store, id), [store]);

  return { meta: getRoomMeta(store, roomId), metaFor, setRoomMeta };
}
