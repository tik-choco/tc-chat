// Camera video calls over the same mistlib node/room. Publishes a local
// camera track when started, and tracks remote camera tracks arriving via
// MEDIA_EVENT_TRACK_ADDED/REMOVED. Remote video tracks are told apart from
// screen shares purely by trackId prefix ("tc-chat-cam:" here vs.
// useScreenShare's "tc-chat-screen:") since mistlib's MediaEventPayload
// carries no camera-vs-screen distinction of its own.
//
// Unlike voice/screen-share, a stopped camera also broadcasts an explicit
// "tc-chat:camera-stopped" wire: mistlib's own TRACK_REMOVED media event is
// node-wide and can be missed/reordered around a room switch, so receivers
// get three independent signals to drop a sender's tile -- the stopped wire,
// EVENT_PEER_DISCONNECTED, and the remote track's own "ended" event -- and
// any one of them is enough.
import { useEffect, useRef, useState } from "preact/hooks";
import {
  getNode,
  localNodeId,
  subscribeMediaEvent,
  subscribeEvent,
  isRawEvent,
  decodeRawPayload,
  MEDIA_EVENT_TRACK_ADDED,
  MEDIA_EVENT_TRACK_REMOVED,
  EVENT_PEER_DISCONNECTED,
  DELIVERY_RELIABLE,
  type MediaEventPayload,
} from "../lib/mistClient";
import { useT } from "../lib/i18n";

const LOCAL_TRACK_PREFIX = "tc-chat-cam";
const STOPPED_WIRE_TYPE = "tc-chat:camera-stopped";

interface CameraStoppedWire extends Record<string, unknown> {
  type: typeof STOPPED_WIRE_TYPE;
}

export interface RemoteCameraTrack {
  trackId: string;
  fromId: string;
  stream: MediaStream;
}

export function useVideoCall(roomId: string | null) {
  const t = useT();
  const [on, setOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteTracks, setRemoteTracks] = useState<RemoteCameraTrack[]>([]);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localTrackIdRef = useRef<string | null>(null);
  // The room the camera was started in -- stop() needs this to room-scope the
  // "stopped" broadcast even after roomId has already changed (room switch)
  // or gone null (unmount), same reasoning as useScreenShare's teardown.
  const cameraRoomIdRef = useRef<string | null>(null);
  // Blocks a second start() while getUserMedia from the first call is still
  // pending -- without this, two overlapping captures race and the first
  // stream's tracks are never stopped (leaked capture indicator).
  const startingRef = useRef(false);
  // Bumped by stop() (including its early-return path) so a start() that's
  // still awaiting getUserMedia/getNode() can notice it was cancelled and
  // discard whatever it just acquired instead of publishing into a room the
  // user already left.
  const generationRef = useRef(0);

  function dropTrack(trackId: string) {
    setRemoteTracks((prev) => prev.filter((rt) => rt.trackId !== trackId));
  }

  function dropSender(fromId: string) {
    setRemoteTracks((prev) => prev.filter((rt) => rt.fromId !== fromId));
  }

  useEffect(() => {
    const unsubscribeMedia = subscribeMediaEvent((eventType, payload: MediaEventPayload) => {
      if (payload.kind !== "video") return;
      if (!payload.trackId.startsWith(LOCAL_TRACK_PREFIX)) return; // not a camera track
      // Never treat our own published camera (looped back by the mesh) as a
      // remote participant -- that would show the local user twice.
      if (payload.fromId === localNodeId()) return;
      if (eventType === MEDIA_EVENT_TRACK_ADDED) {
        const stream = payload.stream ?? new MediaStream([payload.track]);
        setRemoteTracks((prev) => {
          if (prev.some((rt) => rt.trackId === payload.trackId)) return prev;
          // One live camera per sender: a re-start (new trackId, same sender)
          // replaces the old tile instead of stacking a duplicate next to it.
          const others = prev.filter((rt) => rt.fromId !== payload.fromId);
          return [...others, { trackId: payload.trackId, fromId: payload.fromId, stream }];
        });
        // Backstop: also drop the tile straight off the underlying track's own
        // "ended" event, in case a TRACK_REMOVED media event or the stopped
        // wire never arrives (e.g. the sender's tab crashed).
        payload.track.addEventListener("ended", () => dropTrack(payload.trackId));
      } else if (eventType === MEDIA_EVENT_TRACK_REMOVED) {
        // Match by trackId so a stale removal for an already-replaced track
        // can't tear down the sender's current tile.
        dropTrack(payload.trackId);
      }
    });

    // roomId is the on-the-wire swarm topic (see mistClient.ts): filter raw
    // events to this room so another joined room's stopped-wire can't drop a
    // tile here.
    const unsubscribeEvent = subscribeEvent((eventType, fromId, payload, evtRoomId) => {
      if (isRawEvent(eventType)) {
        if (roomId && evtRoomId && evtRoomId !== roomId) return;
        const decoded = decodeRawPayload(payload) as CameraStoppedWire | null;
        if (decoded?.type === STOPPED_WIRE_TYPE) dropSender(fromId);
        return;
      }
      if (eventType === EVENT_PEER_DISCONNECTED) dropSender(fromId);
    });

    return () => {
      unsubscribeMedia();
      unsubscribeEvent();
    };
  }, [roomId]);

  // Leaving the room (or unmounting) always tears down the camera, so a
  // stale track never keeps publishing into a room the user already left.
  useEffect(() => {
    if (!roomId) stop();
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  async function start() {
    if (!roomId || on || startingRef.current) return;
    startingRef.current = true;
    const generation = generationRef.current;
    try {
      setError(null);
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      } catch {
        // stop() may have already run while the permission prompt was open --
        // don't clobber whatever state it left behind.
        if (generationRef.current === generation) setError(t("media.startCameraFailed"));
        return;
      }
      if (generationRef.current !== generation) {
        // stop() ran while getUserMedia was pending -- discard the capture
        // instead of publishing into a room the user already left.
        stream.getTracks().forEach((tr) => tr.stop());
        return;
      }
      const node = await getNode();
      if (generationRef.current !== generation) {
        stream.getTracks().forEach((tr) => tr.stop());
        return;
      }
      const [track] = stream.getVideoTracks();
      const trackId = `${LOCAL_TRACK_PREFIX}:${track.id}`;
      // The OS/browser can revoke the camera (device unplugged, permission
      // pulled) without the user clicking our own stop button.
      track.addEventListener("ended", stop);
      localStreamRef.current = stream;
      localTrackIdRef.current = trackId;
      cameraRoomIdRef.current = roomId;
      node.registerLocalTrack(trackId, track, { publish: true, enabled: true });
      setLocalStream(stream);
      setOn(true);
    } finally {
      startingRef.current = false;
    }
  }

  function stop() {
    generationRef.current++;
    const stream = localStreamRef.current;
    if (!stream) {
      setOn(false);
      return;
    }
    const trackId = localTrackIdRef.current;
    const stopRoomId = cameraRoomIdRef.current;
    getNode().then((node) => {
      if (trackId) {
        node.unpublishLocalTrack(trackId);
        node.removeLocalTrack(trackId);
      }
      if (stopRoomId) {
        try {
          const wire: CameraStoppedWire = { type: STOPPED_WIRE_TYPE };
          node.sendMessage(null, wire, DELIVERY_RELIABLE, stopRoomId);
        } catch (err) {
          // Best-effort, same as usePresence's beacon: a stop can race a room
          // teardown and throw "Room not joined" -- peers still drop our tile
          // via EVENT_PEER_DISCONNECTED or the track's "ended" event.
          console.debug("camera-stopped broadcast skipped (room not ready yet):", err);
        }
      }
    });
    stream.getTracks().forEach((tr) => tr.stop());
    localStreamRef.current = null;
    localTrackIdRef.current = null;
    cameraRoomIdRef.current = null;
    setLocalStream(null);
    setOn(false);
  }

  return { on, error, localStream, remoteTracks, start, stop };
}
