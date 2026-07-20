// Voice chat over the same mistlib node/room. Publishes a local microphone
// track when joined, and plays back remote tracks as they arrive via
// MEDIA_EVENT_TRACK_ADDED/REMOVED.
import { useEffect, useRef, useState } from "preact/hooks";
import {
  getNode,
  localNodeId,
  subscribeMediaEvent,
  MEDIA_EVENT_TRACK_ADDED,
  MEDIA_EVENT_TRACK_REMOVED,
  type MediaEventPayload,
} from "../lib/mistClient";

const LOCAL_TRACK_PREFIX = "tc-chat-mic";

export interface RemoteAudioTrack {
  trackId: string;
  fromId: string;
  stream: MediaStream;
}

export function useVoiceChat(roomId: string | null) {
  const [joined, setJoined] = useState(false);
  const [muted, setMuted] = useState(false);
  const [remoteTracks, setRemoteTracks] = useState<RemoteAudioTrack[]>([]);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localTrackIdRef = useRef<string | null>(null);
  // Blocks a second join() while getNode()/getUserMedia from the first call
  // is still pending -- without this, two overlapping captures race and the
  // first stream's tracks are never stopped (leaked capture indicator).
  const joiningRef = useRef(false);
  // Bumped by leave() (including its early-return path) so a join() that's
  // still awaiting getNode()/getUserMedia can notice it was cancelled and
  // discard whatever it just acquired instead of publishing into a room the
  // user already left.
  const generationRef = useRef(0);

  useEffect(() => {
    const unsubscribe = subscribeMediaEvent((eventType, payload: MediaEventPayload) => {
      if (payload.kind !== "audio") return;
      // Never treat our own published mic (looped back by the mesh) as a remote
      // participant — that made the local user show up twice in the call.
      if (payload.fromId === localNodeId()) return;
      if (eventType === MEDIA_EVENT_TRACK_ADDED) {
        const stream = payload.stream ?? new MediaStream([payload.track]);
        setRemoteTracks((prev) => {
          if (prev.some((t) => t.trackId === payload.trackId)) return prev;
          return [...prev, { trackId: payload.trackId, fromId: payload.fromId, stream }];
        });
      } else if (eventType === MEDIA_EVENT_TRACK_REMOVED) {
        setRemoteTracks((prev) => prev.filter((t) => t.trackId !== payload.trackId));
      }
    });
    return unsubscribe;
  }, []);

  // Leaving the room (or unmounting) always tears down the mic, so stale
  // audio never keeps publishing into a room the user already left.
  useEffect(() => {
    if (!roomId) leave();
    return () => leave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  async function join() {
    if (!roomId || joined || joiningRef.current) return;
    joiningRef.current = true;
    const generation = generationRef.current;
    try {
      const node = await getNode();
      if (generationRef.current !== generation) return; // leave() ran before getNode() resolved
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      if (generationRef.current !== generation) {
        // leave() ran while getUserMedia was pending -- don't publish a mic
        // into a room the user already left.
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      localStreamRef.current = stream;
      const [track] = stream.getAudioTracks();
      const trackId = `${LOCAL_TRACK_PREFIX}:${track.id}`;
      node.registerLocalTrack(trackId, track, { publish: true, enabled: true });
      localTrackIdRef.current = trackId;
      setJoined(true);
      setMuted(false);
    } finally {
      joiningRef.current = false;
    }
  }

  function leave() {
    generationRef.current++;
    const node_ = localStreamRef.current;
    if (!node_) {
      setJoined(false);
      return;
    }
    const trackId = localTrackIdRef.current;
    if (trackId) {
      getNode().then((node) => {
        node.unpublishLocalTrack(trackId);
        node.removeLocalTrack(trackId);
      });
    }
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    localTrackIdRef.current = null;
    setJoined(false);
    setRemoteTracks([]);
  }

  async function toggleMute() {
    if (!localTrackIdRef.current) return;
    const node = await getNode();
    const next = !muted;
    node.setLocalTrackEnabled(localTrackIdRef.current, !next);
    setMuted(next);
  }

  return { joined, muted, remoteTracks, join, leave, toggleMute };
}
