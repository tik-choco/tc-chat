import { useEffect, useRef } from "preact/hooks";
import { Mic, MicOff, Volume2 } from "lucide-preact";
import type { RemoteAudioTrack } from "../hooks/useVoiceChat";
import type { Peer } from "../hooks/usePresence";
import { Avatar } from "./Avatar";
import { useT } from "../lib/i18n";

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

export function VoicePanel(props: {
  joined: boolean;
  muted: boolean;
  remoteTracks: RemoteAudioTrack[];
  peers: Peer[];
  selfId: string;
  selfName: string;
  onJoin: () => void;
  onLeave: () => void;
  onToggleMute: () => void;
  onOpenProfile?: (did: string, fallbackName: string) => void;
}) {
  const {
    joined,
    muted,
    remoteTracks,
    peers,
    selfId,
    selfName,
    onJoin,
    onLeave,
    onToggleMute,
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
  const inCall = joined || remoteParticipants.length > 0;

  return (
    <div class="voice-panel">
      {remoteTracks.map((t) => (
        <RemoteAudio key={t.trackId} track={t} />
      ))}

      {inCall && (
        <div class="voice-participants" title={t("media.inCall")}>
          <span class="voice-status">
            <Volume2 size={14} /> {t("media.participantCount", { count })}
          </span>
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
        </div>
      )}

      {!joined ? (
        <button
          type="button"
          class="voice-btn voice-btn--join"
          onClick={onJoin}
          title={t("media.joinVoice")}
        >
          <Mic size={16} />{" "}
          <span class="btn-label">
            {count > 0 ? t("media.joinCallCount", { count }) : t("media.joinCall")}
          </span>
        </button>
      ) : (
        <div class="voice-controls">
          <button type="button" class="voice-btn" onClick={onToggleMute}>
            {muted ? (
              <>
                <MicOff size={15} /> {t("media.unmute")}
              </>
            ) : (
              <>
                <Mic size={15} /> {t("media.mute")}
              </>
            )}
          </button>
          <button type="button" class="voice-btn voice-btn--leave" onClick={onLeave}>
            {t("media.leave")}
          </button>
        </div>
      )}
    </div>
  );
}
