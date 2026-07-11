import { Video, VideoOff } from "lucide-preact";
import { useT } from "../lib/i18n";

/** Topbar camera control, sitting next to VoicePanel/ScreenShareView. Starting
 * is gated behind ChatWindow's MediaCautionDialog (see onStart), so this
 * component only surfaces on/off + participant count, not the getUserMedia
 * call itself. */
export function VideoCallPanel(props: {
  on: boolean;
  remoteCount: number;
  onStart: () => void;
  onStop: () => void;
}) {
  const { on, remoteCount, onStart, onStop } = props;
  const t = useT();

  return (
    <div class="video-call-panel">
      <button
        type="button"
        class={`pill-btn ${on ? "pill-btn--danger" : ""}`}
        onClick={on ? onStop : onStart}
        title={on ? t("media.stopCamera") : t("media.startVideoCall")}
      >
        {on ? <VideoOff size={16} /> : <Video size={16} />}{" "}
        <span class="btn-label">{on ? t("media.stopCamera") : t("media.startVideoCall")}</span>
      </button>
      {remoteCount > 0 && (
        <span class="video-call-count" title={t("media.inCall")}>
          {t("media.participantCount", { count: remoteCount })}
        </span>
      )}
    </div>
  );
}
