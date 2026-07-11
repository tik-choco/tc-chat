import { useEffect, useRef } from "preact/hooks";
import type { RemoteCameraTrack } from "../hooks/useVideoCall";
import type { Peer } from "../hooks/usePresence";
import { useT } from "../lib/i18n";

function RemoteCameraTile(props: { track: RemoteCameraTrack; name: string; onClick?: () => void }) {
  const t = useT();
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = props.track.stream;
  }, [props.track.stream]);
  return (
    <figure class="camera-tile">
      <video ref={ref} class="camera-tile-video" autoPlay playsInline />
      {props.onClick ? (
        <button
          type="button"
          class="camera-tile-cap camera-tile-cap--btn"
          title={t("media.viewProfile", { name: props.name })}
          onClick={props.onClick}
        >
          📷 {props.name}
        </button>
      ) : (
        <figcaption class="camera-tile-cap">📷 {props.name}</figcaption>
      )}
    </figure>
  );
}

/** The local self-preview tile, shown only while the camera is on. Mirrored
 * (scaleX(-1)) so it reads like a mirror, matching how the user sees
 * themselves through a webcam elsewhere; muted since the mic (if any) is
 * useVoiceChat's concern, not this stream's. */
function LocalCameraTile(props: { stream: MediaStream; name: string }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = props.stream;
  }, [props.stream]);
  return (
    <figure class="camera-tile camera-tile--self">
      <video
        ref={ref}
        class="camera-tile-video camera-tile-video--mirrored"
        autoPlay
        playsInline
        muted
      />
      <figcaption class="camera-tile-cap">📷 {props.name}</figcaption>
    </figure>
  );
}

/** The video-call "stage": a responsive grid of camera tiles shown above the
 * message stream, next to RemoteScreenStage. Renders nothing when no one
 * (including the local user) has their camera on, so it never takes space
 * unnecessarily. */
export function VideoCallStage(props: {
  tracks: RemoteCameraTrack[];
  peers: Peer[];
  selfName: string;
  localStream: MediaStream | null;
  onOpenProfile?: (did: string, fallbackName: string) => void;
}) {
  const { tracks, peers, selfName, localStream, onOpenProfile } = props;
  const t = useT();
  if (tracks.length === 0 && !localStream) return null;

  const nameFor = (id: string) =>
    peers.find((p) => p.id === id)?.name ?? t("media.participantFallback");
  const didFor = (id: string) => peers.find((p) => p.id === id)?.did;

  return (
    <div class="camera-stage">
      {tracks.map((tr) => {
        const did = didFor(tr.fromId);
        const name = nameFor(tr.fromId);
        return (
          <RemoteCameraTile
            key={tr.trackId}
            track={tr}
            name={name}
            onClick={did && onOpenProfile ? () => onOpenProfile(did, name) : undefined}
          />
        );
      })}
      {localStream && <LocalCameraTile stream={localStream} name={selfName} />}
    </div>
  );
}
