import { useEffect, useRef } from "preact/hooks";
import { Mic, MicOff, Volume2 } from "lucide-preact";
import type { RemoteAudioTrack } from "../hooks/useVoiceChat";
import type { Peer } from "../hooks/usePresence";
import { Avatar } from "./Avatar";
import { useT } from "../lib/i18n";

/** Hidden audio sink for one remote voice track. Rendered unconditionally for
 * every track regardless of whether the visual participant strip below is
 * shown, so playback never depends on strip visibility. */
function RemoteAudio(props: { track: RemoteAudioTrack }) {
  const ref = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = props.track.stream;
  }, [props.track.stream]);
  return <audio ref={ref} autoPlay />;
}

/** Chip showing one voice participant (avatar + name, mic state for self). When
 * `onClick` is set (remote peers whose DID we know) it opens their profile. */
function VoiceChip(props: {
  id: string;
  name: string;
  self?: boolean;
  muted?: boolean;
  onClick?: () => void;
}) {
  const t = useT();
  const inner = (
    <>
      <Avatar id={props.id} name={props.name} size={20} />
      <span class="voice-chip-name">{props.name}</span>
      {props.self && (
        <span class="voice-chip-mic">
          {props.muted ? <MicOff size={13} /> : <Mic size={13} />}
        </span>
      )}
    </>
  );
  if (props.onClick) {
    return (
      <button
        type="button"
        class="voice-chip voice-chip--btn"
        title={t("media.viewProfile", { name: props.name })}
        onClick={props.onClick}
      >
        {inner}
      </button>
    );
  }
  return <span class={`voice-chip ${props.self ? "voice-chip--self" : ""}`}>{inner}</span>;
}

/**
 * Participant strip + status notes for the active call, decoupled from
 * CallControls' buttons. Always renders the hidden `<audio>` sinks (so remote
 * voice keeps playing even while the visual strip is hidden), and shows the
 * visible strip only once there is something worth showing: joined, a remote
 * voice participant, or a camera/share error/note to surface.
 */
export function CallDock(props: {
  joined: boolean;
  muted: boolean;
  remoteTracks: RemoteAudioTrack[];
  peers: Peer[];
  selfId: string;
  selfName: string;
  cameraError: string | null;
  shareError: string | null;
  shareAudioMissing: boolean;
  onOpenProfile?: (did: string, fallbackName: string) => void;
}) {
  const {
    joined,
    muted,
    remoteTracks,
    peers,
    selfId,
    selfName,
    cameraError,
    shareError,
    shareAudioMissing,
    onOpenProfile,
  } = props;
  const t = useT();

  const nameFor = (id: string) =>
    peers.find((p) => p.id === id)?.name ?? t("media.participantFallback");
  const didFor = (id: string) => peers.find((p) => p.id === id)?.did;
  // One chip per person even if the mesh delivered more than one audio track
  // for them (e.g. mic + shared audio). Remote tracks arrive whether or not we
  // ourselves have joined, so participants are visible before joining too.
  const remoteParticipants = [...new Map(remoteTracks.map((t) => [t.fromId, t])).values()];
  const count = remoteParticipants.length + (joined ? 1 : 0);
  const visible =
    joined || remoteParticipants.length > 0 || !!cameraError || !!shareError || shareAudioMissing;

  const audioElements = remoteTracks.map((t) => <RemoteAudio key={t.trackId} track={t} />);

  return (
    <>
      {audioElements}
      {visible && (
        <div class="call-dock">
          {(joined || remoteParticipants.length > 0) && (
            <span class="call-dock-status" title={t("media.inCall")}>
              <Volume2 size={14} /> {t("media.participantCount", { count })}
            </span>
          )}
          {joined && <VoiceChip id={selfId || selfName} name={selfName} self muted={muted} />}
          {remoteParticipants.map((t) => {
            const did = didFor(t.fromId);
            return (
              <VoiceChip
                key={t.fromId}
                id={t.fromId}
                name={nameFor(t.fromId)}
                onClick={
                  did && onOpenProfile ? () => onOpenProfile(did, nameFor(t.fromId)) : undefined
                }
              />
            );
          })}
          {cameraError && <span class="call-dock-note call-dock-note--error">{cameraError}</span>}
          {shareError && <span class="call-dock-note call-dock-note--error">{shareError}</span>}
          {shareAudioMissing && (
            <span class="call-dock-note">{t("media.noAudioCaptured")}</span>
          )}
        </div>
      )}
    </>
  );
}
