// Lets a peer who joins a room later catch up on prior chat + board history.
//
// On join, this hook broadcasts a one-shot `tc-chat:history-request`. Any peer
// already in the room replays its per-room signed wire log (see appendWireLog)
// directly to the requester. The replayed wires are ordinary
// `tc-chat:message` / `tc-chat:node` / `tc-chat:reaction` wires, so the
// requester's existing hooks hydrate and — crucially — re-verify each one's
// signature. Replay is therefore trust-free: a replayer can omit or reorder
// wires but cannot forge content or identity.
import { useEffect } from "preact/hooks";
import {
  getNode,
  subscribeEvent,
  isRawEvent,
  decodeRawPayload,
  localNodeId,
  DELIVERY_RELIABLE,
} from "../lib/mistClient";
import { loadWireLog } from "../lib/chatStore";
import { GLOBAL_ROOM_ID, newId } from "../lib/util";

interface HistoryRequest extends Record<string, unknown> {
  type: "tc-chat:history-request";
  id: string;
  roomId: string;
}

const REQUEST_DELAY_MS = 700;
const ANSWER_THROTTLE_MS = 3000;

export function useHistorySync(roomId: string | null) {
  useEffect(() => {
    // The global room is a live-only public space (see chatStore's
    // isEphemeralRoom): it neither asks peers for prior history nor answers
    // others' history requests, so a visit only ever shows posts made while
    // actually connected.
    if (!roomId || roomId === GLOBAL_ROOM_ID) return;
    let cancelled = false;
    // The swarm topic is the raw room id itself — no derived/obscured channel
    // id, so any peer joining the same room name lands in the same swarm.
    const channelId = roomId;
    // Throttle replays per requester so a peer can't trigger a replay storm.
    const answeredAt = new Map<string, number>();

    function replayTo(requesterId: string) {
      const now = Date.now();
      if (now - (answeredAt.get(requesterId) ?? 0) < ANSWER_THROTTLE_MS) return;
      answeredAt.set(requesterId, now);
      const log = loadWireLog(roomId!);
      if (log.length === 0) return;
      getNode().then((node) => {
        // A little jitter so multiple responders don't burst simultaneously.
        setTimeout(() => {
          if (cancelled) return;
          // Room-scoped even though it's a targeted reply, so the requester's
          // per-room roomId filter accepts it (see usePostStream).
          for (const wire of log) node.sendMessage(requesterId, wire, DELIVERY_RELIABLE, channelId);
        }, Math.random() * 400);
      });
    }

    const unsubscribe = subscribeEvent((eventType, fromId, payload, evtRoomId) => {
      if (!isRawEvent(eventType)) return;
      if (evtRoomId && evtRoomId !== channelId) return; // another room's request
      if (fromId === localNodeId()) return; // ignore our own broadcast echo
      const decoded = decodeRawPayload(payload) as HistoryRequest | null;
      if (decoded?.type === "tc-chat:history-request" && decoded.roomId === roomId) {
        replayTo(fromId);
      }
    });

    // Ask once, after the message/board subscribers have had time to mount.
    const timer = setTimeout(() => {
      getNode().then((node) => {
        if (cancelled) return;
        const request: HistoryRequest = { type: "tc-chat:history-request", id: newId(), roomId };
        node.sendMessage(null, request, DELIVERY_RELIABLE, channelId);
      });
    }, REQUEST_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      unsubscribe();
    };
  }, [roomId]);
}
