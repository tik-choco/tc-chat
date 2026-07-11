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
    if (!roomId || joined) return;
    const node = await getNode();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    localStreamRef.current = stream;
    const [track] = stream.getAudioTracks();
    const trackId = `${LOCAL_TRACK_PREFIX}:${track.id}`;
    node.registerLocalTrack(trackId, track, { publish: true, enabled: true });
    localTrackIdRef.current = trackId;
    setJoined(true);
    setMuted(false);
  }

  function leave() {
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
