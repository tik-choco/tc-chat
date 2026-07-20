// Screen sharing over the same mistlib node/room. Publishes a local display
// video track when started, and tracks remote video tracks arriving via
// MEDIA_EVENT_TRACK_ADDED/REMOVED. mistlib's MediaEventPayload carries no
// screen-vs-camera distinction, so remote video tracks are told apart by
// trackId prefix instead: camera tracks (see useVideoCall's "tc-chat-cam:"
// prefix) are filtered out below so they never render as a screen-share tile.
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

const LOCAL_TRACK_PREFIX = "tc-chat-screen";
const LOCAL_AUDIO_TRACK_PREFIX = "tc-chat-screen-audio";

// Explicit "I stopped sharing" broadcast. mistlib's unpublish/remove does not
// reliably surface MEDIA_EVENT_TRACK_REMOVED on remote peers, so without this
// the viewers' tiles linger showing the last frame. Sent on the share room's
// channel (same wire as presence). Receivers apply it regardless of which
// room they're currently viewing: remote tracks are node-wide (media events
// carry no room id), so the teardown must be node-wide too — it removes a
// tile, carries no content, and thus can't leak posts across rooms.
const SHARE_STOPPED_TYPE = "tc-chat:screen-share-stopped";

interface ShareStoppedMessage extends Record<string, unknown> {
  type: typeof SHARE_STOPPED_TYPE;
}

export interface RemoteScreenTrack {
  trackId: string;
  fromId: string;
  stream: MediaStream;
}

export function useScreenShare(roomId: string | null) {
  const t = useT();
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Chrome/Edge only show the "share audio" checkbox for tab/whole-screen
  // shares (not a single window), and even then the user has to tick it --
  // getDisplayMedia({ audio: true }) still resolves successfully with a
  // video-only stream if they don't. That's silent on the wire (mistl's relay
  // just never sees an audio track from this peer -- see mistl's
  // stream/relay.rs `AudioDecision::Buffer`/`decide_audio` and its
  // `summary_task` starvation warning), so surface it here instead of
  // leaving the user to wonder why VRChat has no sound.
  const [audioMissing, setAudioMissing] = useState(false);
  const [remoteTracks, setRemoteTracks] = useState<RemoteScreenTrack[]>([]);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localTrackIdRef = useRef<string | null>(null);
  const localAudioTrackIdRef = useRef<string | null>(null);
  // Room the current share was started in — stop() must announce on that
  // room's channel even if the user has since switched rooms.
  const shareRoomIdRef = useRef<string | null>(null);
  // Blocks a second start() while the picker/getDisplayMedia from the first
  // call is still open -- without this, two overlapping captures race and
  // the first stream's tracks are never stopped (leaked capture indicator).
  const startingRef = useRef(false);
  // Bumped by stop() (including its early-return path) so a start() that's
  // still awaiting the picker or getNode() can notice it was cancelled and
  // discard whatever it just acquired instead of publishing into a room the
  // user already left.
  const generationRef = useRef(0);

  useEffect(() => {
    const unsubscribe = subscribeMediaEvent((eventType, payload: MediaEventPayload) => {
      if (payload.kind !== "video") return;
      // Camera feeds (useVideoCall) are also plain "video" media events --
      // exclude them by trackId prefix so they render in VideoCallStage only.
      if (payload.trackId.startsWith("tc-chat-cam")) return;
      // Ignore our own display track if the mesh loops it back — otherwise the
      // sharer would see their own screen as a second, remote tile.
      if (payload.fromId === localNodeId()) return;
      if (eventType === MEDIA_EVENT_TRACK_ADDED) {
        const stream = payload.stream ?? new MediaStream([payload.track]);
        // Last-resort teardown: if neither TRACK_REMOVED nor the sharer's
        // stopped-broadcast reaches us, the receiving track still ends when
        // the sender's transceiver goes away — drop the tile then.
        payload.track?.addEventListener?.(
          "ended",
          () => setRemoteTracks((prev) => prev.filter((t) => t.trackId !== payload.trackId)),
          { once: true },
        );
        setRemoteTracks((prev) => {
          if (prev.some((t) => t.trackId === payload.trackId)) return prev;
          // One live screen per sharer: a re-share (new trackId, same sender)
          // replaces the old tile instead of stacking a duplicate next to it.
          const others = prev.filter((t) => t.fromId !== payload.fromId);
          return [...others, { trackId: payload.trackId, fromId: payload.fromId, stream }];
        });
      } else if (eventType === MEDIA_EVENT_TRACK_REMOVED) {
        // Match by trackId so a stale removal for an already-replaced track
        // can't tear down the sharer's current tile.
        setRemoteTracks((prev) => prev.filter((t) => t.trackId !== payload.trackId));
      }
    });
    return unsubscribe;
  }, []);

  // Non-media teardown signals: the sharer's explicit stopped-broadcast (the
  // normal stop path — see SHARE_STOPPED_TYPE) and peer disconnects (crash /
  // tab close / room leave, where no broadcast ever arrives). Both drop every
  // tile of that sender, not a specific trackId, since the sender publishes
  // at most one live screen at a time.
  useEffect(() => {
    const unsubscribe = subscribeEvent((eventType, fromId, payload) => {
      if (isRawEvent(eventType)) {
        const decoded = decodeRawPayload(payload) as ShareStoppedMessage | null;
        if (decoded?.type === SHARE_STOPPED_TYPE) {
          setRemoteTracks((prev) => prev.filter((t) => t.fromId !== fromId));
        }
        return;
      }
      if (eventType === EVENT_PEER_DISCONNECTED) {
        setRemoteTracks((prev) => prev.filter((t) => t.fromId !== fromId));
      }
    });
    return unsubscribe;
  }, []);

  // Leaving the room (or unmounting) always tears down the share, so a
  // stale display track never keeps publishing into a room the user left.
  useEffect(() => {
    if (!roomId) stop();
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  async function start() {
    if (!roomId || sharing || startingRef.current) return;
    startingRef.current = true;
    const generation = generationRef.current;
    try {
      setError(null);
      setAudioMissing(false);
      let stream: MediaStream;
      try {
        // audio: true asks the browser to show its native "share audio"
        // checkbox in the picker — the user opts in there, not in-app.
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      } catch {
        // stop() may have already run while the picker was open -- don't
        // clobber whatever state it left behind.
        if (generationRef.current === generation) setError(t("media.startShareFailed"));
        return;
      }
      if (generationRef.current !== generation) {
        // stop() ran while the picker was open -- discard the capture
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
      // The browser's native "stop sharing" control ends the video track;
      // the audio track (if any) is stopped by stop() below.
      track.addEventListener("ended", stop);
      localStreamRef.current = stream;
      localTrackIdRef.current = trackId;
      shareRoomIdRef.current = roomId;
      node.registerLocalTrack(trackId, track, { publish: true, enabled: true });

      const [audioTrack] = stream.getAudioTracks();
      if (audioTrack) {
        const audioTrackId = `${LOCAL_AUDIO_TRACK_PREFIX}:${audioTrack.id}`;
        localAudioTrackIdRef.current = audioTrackId;
        node.registerLocalTrack(audioTrackId, audioTrack, { publish: true, enabled: true });
      } else {
        setAudioMissing(true);
      }
      setSharing(true);
    } finally {
      startingRef.current = false;
    }
  }

  function stop() {
    generationRef.current++;
    const stream = localStreamRef.current;
    if (!stream) {
      setSharing(false);
      setAudioMissing(false);
      return;
    }
    const trackId = localTrackIdRef.current;
    const audioTrackId = localAudioTrackIdRef.current;
    const shareRoomId = shareRoomIdRef.current;
    getNode().then((node) => {
      if (trackId) {
        node.unpublishLocalTrack(trackId);
        node.removeLocalTrack(trackId);
      }
      if (audioTrackId) {
        node.unpublishLocalTrack(audioTrackId);
        node.removeLocalTrack(audioTrackId);
      }
      // Tell viewers explicitly — unpublish alone doesn't reliably reach them
      // as TRACK_REMOVED, which left their tiles frozen on the last frame.
      if (shareRoomId) {
        const msg: ShareStoppedMessage = { type: SHARE_STOPPED_TYPE };
        try {
          node.sendMessage(null, msg, DELIVERY_RELIABLE, shareRoomId);
        } catch (err) {
          // Best-effort: the room session may already be torn down (leave /
          // rejoin race). Viewers still recover via peer-disconnect or the
          // receiving track's own "ended".
          console.debug("share-stopped broadcast skipped:", err);
        }
      }
    });
    stream.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    localTrackIdRef.current = null;
    localAudioTrackIdRef.current = null;
    shareRoomIdRef.current = null;
    setSharing(false);
    setAudioMissing(false);
  }

  return { sharing, error, audioMissing, remoteTracks, start, stop };
}
