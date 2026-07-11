// Ephemeral "X is typing…" indicator, broadcast the same way presence is
// (see usePresence.ts): small EVENT_RAW pings scoped to the room's swarm
// topic. Unlike presence, a typing peer isn't tracked until they disconnect —
// each ping just (re)schedules a self-clearing timeout, so going quiet
// (stopped typing, or the tab/peer disappeared) fades the indicator on its
// own without needing an explicit "stopped typing" message.
import { useEffect, useRef, useState } from "preact/hooks";
import {
  getNode,
  subscribeEvent,
  isRawEvent,
  decodeRawPayload,
  DELIVERY_UNRELIABLE,
} from "../lib/mistClient";

interface TypingMessage extends Record<string, unknown> {
  type: "tc-chat:typing";
  name: string;
}

// How long a peer stays "typing" after their last ping.
const EXPIRE_MS = 4000;
// Minimum gap between our own outgoing pings, so a fast typist doesn't
// spam the room with a broadcast on every keystroke.
const THROTTLE_MS = 2000;

export function useTyping(roomId: string | null, localName: string) {
  const [typingNames, setTypingNames] = useState<string[]>([]);
  const peersRef = useRef(new Map<string, string>()); // fromId -> name
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const lastSentRef = useRef(0);
  const localNameRef = useRef(localName);
  localNameRef.current = localName;

  useEffect(() => {
    peersRef.current = new Map();
    timersRef.current.forEach((timer) => clearTimeout(timer));
    timersRef.current = new Map();
    setTypingNames([]);
    if (!roomId) return;

    let cancelled = false;
    // Same convention as usePresence: the swarm topic is the raw room id.
    const channelId = roomId;

    const snapshot = () => setTypingNames(Array.from(peersRef.current.values()));

    const unsubscribe = subscribeEvent((eventType, fromId, payload, evtRoomId) => {
      if (cancelled) return;
      if (!isRawEvent(eventType)) return;
      if (evtRoomId && evtRoomId !== channelId) return; // another room's typing ping
      const decoded = decodeRawPayload(payload) as TypingMessage | null;
      if (decoded?.type !== "tc-chat:typing") return;

      const existing = timersRef.current.get(fromId);
      if (existing) clearTimeout(existing);
      peersRef.current.set(fromId, decoded.name);
      timersRef.current.set(
        fromId,
        setTimeout(() => {
          peersRef.current.delete(fromId);
          timersRef.current.delete(fromId);
          snapshot();
        }, EXPIRE_MS),
      );
      snapshot();
    });

    return () => {
      cancelled = true;
      unsubscribe();
      timersRef.current.forEach((timer) => clearTimeout(timer));
      timersRef.current = new Map();
    };
  }, [roomId]);

  const notifyTyping = () => {
    if (!roomId) return;
    const now = Date.now();
    if (now - lastSentRef.current < THROTTLE_MS) return;
    lastSentRef.current = now;
    const channelId = roomId;
    getNode()
      .then((node) => {
        const msg: TypingMessage = { type: "tc-chat:typing", name: localNameRef.current };
        node.sendMessage(null, msg, DELIVERY_UNRELIABLE, channelId);
      })
      .catch((err) => {
        // Best-effort: a dropped ping just means the indicator doesn't show.
        console.debug("typing broadcast skipped (room not ready yet):", err);
      });
  };

  return { typingNames, notifyTyping };
}
