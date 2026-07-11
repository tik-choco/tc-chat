// Friend-request handshake over the P2P wire. Mirrors useProfileDirectory's
// signed-broadcast + re-greet pattern: every wire is self-signed (fromId is
// the sender's DID, signature covers every other field — see wireSign) so a
// peer can't forge a request/response on someone else's behalf, and every
// send is scoped to the raw roomId channel so requests never leak into a
// room the recipient hasn't joined (see p2p-room-scoping-invariant).
import { useEffect, useRef, useState } from "preact/hooks";
import {
  getNode,
  subscribeEvent,
  isRawEvent,
  decodeRawPayload,
  EVENT_PEER_CONNECTED,
  DELIVERY_RELIABLE,
} from "../lib/mistClient";
import { signWireFields, verifyWire } from "../lib/wireSign";
import {
  acceptFriend,
  computeDmRoomId,
  loadFriends,
  removeFriend as removeFriendEntry,
  upsertRequest,
  type Friend,
} from "../lib/friendsStore";

interface FriendRequestWire extends Record<string, unknown> {
  type: "tc-chat:friend-request";
  fromId: string;
  toDid: string;
  name: string;
  sentAt: number;
  signature: string;
}

interface FriendResponseWire extends Record<string, unknown> {
  type: "tc-chat:friend-response";
  fromId: string;
  toDid: string;
  accept: boolean;
  name: string;
  sentAt: number;
  signature: string;
}

interface FriendCancelWire extends Record<string, unknown> {
  type: "tc-chat:friend-cancel";
  fromId: string;
  toDid: string;
  sentAt: number;
  signature: string;
}

type FriendWire = FriendRequestWire | FriendResponseWire | FriendCancelWire;

async function sendRequestWire(
  fromId: string,
  toDid: string,
  name: string,
  target: string | null,
  channelId: string,
): Promise<void> {
  const node = await getNode();
  const unsigned = {
    type: "tc-chat:friend-request" as const,
    fromId,
    toDid,
    name,
    sentAt: Date.now(),
  };
  const wire: FriendRequestWire = { ...unsigned, signature: await signWireFields(unsigned) };
  node.sendMessage(target, wire, DELIVERY_RELIABLE, channelId);
}

async function sendResponseWire(
  fromId: string,
  toDid: string,
  accept: boolean,
  name: string,
  target: string | null,
  channelId: string,
): Promise<void> {
  const node = await getNode();
  const unsigned = {
    type: "tc-chat:friend-response" as const,
    fromId,
    toDid,
    accept,
    name,
    sentAt: Date.now(),
  };
  const wire: FriendResponseWire = { ...unsigned, signature: await signWireFields(unsigned) };
  node.sendMessage(target, wire, DELIVERY_RELIABLE, channelId);
}

async function sendCancelWire(
  fromId: string,
  toDid: string,
  target: string | null,
  channelId: string,
): Promise<void> {
  const node = await getNode();
  const unsigned = {
    type: "tc-chat:friend-cancel" as const,
    fromId,
    toDid,
    sentAt: Date.now(),
  };
  const wire: FriendCancelWire = { ...unsigned, signature: await signWireFields(unsigned) };
  node.sendMessage(target, wire, DELIVERY_RELIABLE, channelId);
}

export function useFriends(roomId: string | null, selfDid: string | null, localName: string) {
  const [friends, setFriends] = useState<Friend[]>(() => loadFriends());
  const friendsRef = useRef(friends);
  friendsRef.current = friends;
  const localNameRef = useRef(localName);
  localNameRef.current = localName;

  // Collect incoming requests/responses/cancels addressed to us, and
  // re-announce any outstanding outgoing requests on join and to newcomers.
  useEffect(() => {
    if (!roomId || !selfDid) return;
    let cancelled = false;
    // The swarm topic is the raw room id itself — no derived/obscured channel
    // id, so any peer joining the same room name lands in the same swarm.
    const channelId = roomId;
    const self = selfDid;
    const timers: Array<ReturnType<typeof setTimeout>> = [];

    async function respond(toDid: string, accept: boolean, target: string | null) {
      try {
        await sendResponseWire(self, toDid, accept, localNameRef.current, target, channelId);
      } catch (err) {
        // Backstop: a send can race a room teardown/rebuild — it's best-effort
        // (the requester will retry on their own re-announce timer), so drop
        // it rather than let it surface as an unhandled rejection.
        console.debug("friend response broadcast skipped (room not ready yet):", err);
      }
    }

    async function handleWire(wire: FriendWire, fromTransportId: string) {
      if (!(await verifyWire(wire))) return;
      if (cancelled) return;
      if (wire.toDid !== self) return; // addressed to someone else
      if (wire.fromId === self) return; // our own echo

      if (wire.type === "tc-chat:friend-request") {
        const existing = friendsRef.current.find((f) => f.did === wire.fromId);
        if (existing?.status === "accepted") {
          // Re-affirm: the requester may have missed our earlier accept
          // (e.g. they went offline right after sending), so answer again
          // instead of silently dropping the duplicate request.
          respond(wire.fromId, true, fromTransportId);
          return;
        }
        if (existing?.status === "pending-out") {
          // Mutual: both sides requested each other — promote and confirm.
          setFriends(upsertRequest(wire.fromId, wire.name, existing.roomId, "in"));
          respond(wire.fromId, true, fromTransportId);
          return;
        }
        if (existing?.status === "pending-in") return; // duplicate; awaiting our accept/decline
        const dmRoomId = await computeDmRoomId(self, wire.fromId);
        if (cancelled) return;
        setFriends(upsertRequest(wire.fromId, wire.name, dmRoomId, "in"));
        return;
      }

      if (wire.type === "tc-chat:friend-response") {
        const existing = friendsRef.current.find((f) => f.did === wire.fromId);
        if (existing?.status !== "pending-out") return; // stale/unsolicited response
        setFriends(wire.accept ? acceptFriend(wire.fromId) : removeFriendEntry(wire.fromId));
        return;
      }

      // tc-chat:friend-cancel
      const existing = friendsRef.current.find((f) => f.did === wire.fromId);
      if (existing?.status === "pending-in") {
        setFriends(removeFriendEntry(wire.fromId));
      }
    }

    const unsubscribe = subscribeEvent((eventType, fromId, payload, evtRoomId) => {
      if (cancelled) return;
      if (eventType === EVENT_PEER_CONNECTED) {
        // Late-joiner catch-up: mirror the profile re-announce delay so a
        // peer that connects after us still learns about any outgoing
        // request we already have pending for them.
        const timer = setTimeout(() => {
          if (cancelled) return;
          for (const f of friendsRef.current) {
            if (f.status !== "pending-out") continue;
            sendRequestWire(self, f.did, f.name, fromId, channelId).catch((err) => {
              console.debug("friend request re-announce skipped (room not ready yet):", err);
            });
          }
        }, 600);
        timers.push(timer);
        return;
      }
      if (!isRawEvent(eventType)) return;
      if (evtRoomId && evtRoomId !== channelId) return; // another room's friend traffic
      const decoded = decodeRawPayload(payload) as FriendWire | null;
      if (
        decoded?.type === "tc-chat:friend-request" ||
        decoded?.type === "tc-chat:friend-response" ||
        decoded?.type === "tc-chat:friend-cancel"
      ) {
        handleWire(decoded, fromId);
      }
    });

    // Broadcast all pending-out requests once shortly after joining the room,
    // in case the recipient is already present but never saw our request.
    const joinTimer = setTimeout(() => {
      if (cancelled) return;
      for (const f of friendsRef.current) {
        if (f.status !== "pending-out") continue;
        sendRequestWire(self, f.did, f.name, null, channelId).catch((err) => {
          console.debug("friend request broadcast skipped (room not ready yet):", err);
        });
      }
    }, 400);
    timers.push(joinTimer);

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      unsubscribe();
    };
  }, [roomId, selfDid]);

  async function sendFriendRequest(did: string, name: string): Promise<void> {
    if (!selfDid || !roomId || did === selfDid) return;
    const before = friendsRef.current.find((f) => f.did === did);
    const dmRoomId = await computeDmRoomId(selfDid, did);
    const next = upsertRequest(did, name, dmRoomId, "out");
    setFriends(next);
    const after = next.find((f) => f.did === did);
    const wasAlreadyAccepted = before?.status === "accepted";
    try {
      if (after?.status === "accepted" && !wasAlreadyAccepted) {
        // The store promoted this to mutual (they'd already requested us) —
        // confirm with a response instead of sending a redundant request.
        await sendResponseWire(selfDid, did, true, localNameRef.current, null, roomId);
      } else if (!wasAlreadyAccepted) {
        await sendRequestWire(selfDid, did, name, null, roomId);
      }
    } catch (err) {
      console.debug("friend request send skipped (room not ready yet):", err);
    }
  }

  async function acceptFriendRequest(did: string): Promise<void> {
    if (!selfDid || !roomId) return;
    setFriends(acceptFriend(did));
    try {
      await sendResponseWire(selfDid, did, true, localNameRef.current, null, roomId);
    } catch (err) {
      console.debug("friend accept send skipped (room not ready yet):", err);
    }
  }

  async function declineFriendRequest(did: string): Promise<void> {
    if (!selfDid || !roomId) return;
    setFriends(removeFriendEntry(did));
    try {
      await sendResponseWire(selfDid, did, false, localNameRef.current, null, roomId);
    } catch (err) {
      console.debug("friend decline send skipped (room not ready yet):", err);
    }
  }

  async function cancelFriendRequest(did: string): Promise<void> {
    if (!selfDid || !roomId) return;
    setFriends(removeFriendEntry(did));
    try {
      await sendCancelWire(selfDid, did, null, roomId);
    } catch (err) {
      console.debug("friend cancel send skipped (room not ready yet):", err);
    }
  }

  function removeFriend(did: string): void {
    setFriends(removeFriendEntry(did));
  }

  return {
    friends,
    sendFriendRequest,
    acceptFriendRequest,
    declineFriendRequest,
    cancelFriendRequest,
    removeFriend,
  };
}
