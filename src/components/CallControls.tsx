import { useState } from "preact/hooks";
import {
  PhoneCall,
  PhoneOff,
  Mic,
  MicOff,
  Video,
  VideoOff,
  ScreenShare,
  ScreenShareOff,
  Cast,
} from "lucide-preact";
import { VrchatGuide } from "./VrchatGuide";
import { useT } from "../lib/i18n";

/**
 * Unified topbar call control cluster: join/leave voice, mute, camera, screen
 * share, and the VRChat relay guide trigger. Replaces the three separate
 * panels this room used to render side by side (VoicePanel, ScreenShareView,
 * VideoCallPanel) with one compact control group; the always-on-when-in-call
 * participant strip lives separately in CallDock.
 */
export function CallControls(props: {
  roomId: string;
  joined: boolean;
  muted: boolean;
  remoteVoiceCount: number;
  cameraOn: boolean;
  sharing: boolean;
  onJoin: () => void;
  onLeave: () => void;
  onToggleMute: () => void;
  onCameraStart: () => void;
  onCameraStop: () => void;
  onShareStart: () => void;
  onShareStop: () => void;
}) {
  const {
    roomId,
    joined,
    muted,
    remoteVoiceCount,
    cameraOn,
    sharing,
    onJoin,
    onLeave,
    onToggleMute,
    onCameraStart,
    onCameraStop,
    onShareStart,
    onShareStop,
  } = props;
  const t = useT();
  const [guideOpen, setGuideOpen] = useState(false);

  return (
    <div class="call-controls">
      {!joined && (
        <button
          type="button"
          class="call-join-btn"
          onClick={onJoin}
          title={
            remoteVoiceCount > 0
              ? t("media.joinCallCount", { count: remoteVoiceCount })
              : t("media.joinCall")
          }
        >
          <PhoneCall size={15} />
          <span class="btn-label">{t("media.joinCall")}</span>
          {remoteVoiceCount > 0 && <span class="call-join-count">{remoteVoiceCount}</span>}
        </button>
      )}

      <div class="call-controls-group" role="group">
        {joined && (
          <button
            type="button"
            class={`call-ctl-btn${muted ? " call-ctl-btn--muted" : ""}`}
            aria-pressed={muted}
            title={muted ? t("media.unmute") : t("media.mute")}
            onClick={onToggleMute}
          >
            {muted ? <MicOff size={16} /> : <Mic size={16} />}
          </button>
        )}

        <button
          type="button"
          class={`call-ctl-btn${cameraOn ? " call-ctl-btn--live" : ""}`}
          aria-pressed={cameraOn}
          title={cameraOn ? t("media.stopCamera") : t("media.startVideoCall")}
          onClick={cameraOn ? onCameraStop : onCameraStart}
        >
          {cameraOn ? <VideoOff size={16} /> : <Video size={16} />}
        </button>

        <button
          type="button"
          class={`call-ctl-btn${sharing ? " call-ctl-btn--live" : ""}`}
          aria-pressed={sharing}
          title={sharing ? t("media.stopSharing") : t("media.shareScreen")}
          onClick={sharing ? onShareStop : onShareStart}
        >
          {sharing ? <ScreenShareOff size={16} /> : <ScreenShare size={16} />}
        </button>

        {joined && (
          <button
            type="button"
            class="call-ctl-btn call-ctl-btn--leave"
            title={t("media.leave")}
            onClick={onLeave}
          >
            <PhoneOff size={16} />
          </button>
        )}
      </div>

      <button
        type="button"
        class="call-ctl-btn call-ctl-btn--ghost"
        title={t("media.vrchatGuide")}
        aria-label={t("media.vrchatGuide")}
        onClick={() => setGuideOpen(true)}
      >
        <Cast size={16} />
      </button>

      {guideOpen && (
        <VrchatGuide roomId={roomId} sharing={sharing} onClose={() => setGuideOpen(false)} />
      )}
    </div>
  );
}
