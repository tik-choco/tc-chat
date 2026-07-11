// Tracks who else is in the currently joined room. mistlib itself only
// knows peer ids (EVENT_PEER_CONNECTED/DISCONNECTED) — it has no concept of
// a display name — so peers exchange small "presence" broadcasts over
// EVENT_RAW to learn each other's chosen name.
import { useEffect, useRef, useState } from "preact/hooks";
import {
  getNode,
  subscribeEvent,
  isRawEvent,
  decodeRawPayload,
  EVENT_PEER_CONNECTED,
  EVENT_PEER_DISCONNECTED,
  DELIVERY_RELIABLE,
} from "../lib/mistClient";
import { ensureDidIdentity } from "../crypto/didIdentity";

export interface Peer {
  /** mistlib transport node id (the raw-event sender id). */
  id: string;
  name: string;
  /** The peer's DID, so their entry can be linked to the profile directory. */
  did?: string;
}

interface PresenceMessage extends Record<string, unknown> {
  type: "tc-chat:presence";
  name: string;
  /** did:key of the sender — lets others open this peer's profile detail. */
  did?: string;
}

interface PeerInfo {
  name: string;
  did?: string;
}

export function usePresence(roomId: string | null, localName: string) {
  const [peers, setPeers] = useState<Peer[]>([]);
  const peersRef = useRef(new Map<string, PeerInfo>());
  const localNameRef = useRef(localName);
  localNameRef.current = localName;

  useEffect(() => {
    peersRef.current = new Map();
    setPeers([]);
    if (!roomId) return;

    let cancelled = false;
    // The swarm topic is the raw room id itself — no derived/obscured channel
    // id, so any peer joining the same room name lands in the same swarm.
    const channelId = roomId;

    const snapshot = () =>
      setPeers(Array.from(peersRef.current, ([id, info]) => ({ id, ...info })));

    const broadcastPresence = async (toId?: string) => {
      const node = await getNode();
      // Include our DID so peers can resolve us in the profile directory; it's
      // fine if identity resolution is what we await on here.
      const did = await ensureDidIdentity()
        .then((i) => i.did)
        .catch(() => undefined);
      if (cancelled) return;
      const msg: PresenceMessage = { type: "tc-chat:presence", name: localNameRef.current, did };
      try {
        node.sendMessage(toId ?? null, msg, DELIVERY_RELIABLE, channelId);
      } catch (err) {
        // Backstop: useChatRoom now gates "joined" on joinRoomAsync, so the
        // room session normally exists by the time this runs. A beacon can
        // still race a room teardown/rebuild (leave+rejoin) and throw "Room not
        // joined" — it's best-effort (peers re-learn our name via the
        // EVENT_PEER_CONNECTED re-greet below), so drop it rather than let it
        // surface as an unhandled rejection.
        console.debug("presence broadcast skipped (room not ready yet):", err);
      }
    };

    const unsubscribe = subscribeEvent((eventType, fromId, payload, evtRoomId) => {
      if (cancelled) return;
      if (isRawEvent(eventType)) {
        if (evtRoomId && evtRoomId !== channelId) return; // another room's presence
        const decoded = decodeRawPayload(payload) as PresenceMessage | null;
        if (decoded?.type === "tc-chat:presence") {
          peersRef.current.set(fromId, { name: decoded.name, did: decoded.did });
          snapshot();
        }
        return;
      }
      if (eventType === EVENT_PEER_CONNECTED) {
        // Greet the newcomer directly so they learn our name even if our
        // broadcast on join happened before they had joined the room.
        broadcastPresence(fromId);
      } else if (eventType === EVENT_PEER_DISCONNECTED) {
        peersRef.current.delete(fromId);
        snapshot();
      }
    });

    broadcastPresence();

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [roomId]);

  return peers;
}
