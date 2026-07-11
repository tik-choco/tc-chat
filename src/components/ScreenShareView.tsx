import { useState } from "preact/hooks";
import { ScreenShare, ScreenShareOff, Cast } from "lucide-preact";
import { VrchatGuide } from "./VrchatGuide";
import { useT } from "../lib/i18n";

/** Just the share controls; the remote video itself lives in RemoteScreenStage
 * so it can occupy the content area instead of being crammed into the topbar. */
export function ScreenShareView(props: {
  roomId: string;
  sharing: boolean;
  error: string | null;
  /** True once a share started but the captured stream had no audio track --
   * a silent-success case (getDisplayMedia resolves fine either way), most
   * often because the user didn't tick "share audio" in the browser's
   * picker. Non-blocking, so it renders alongside `error` rather than
   * replacing the share controls. */
  audioMissing?: boolean;
  onStart: () => void;
  onStop: () => void;
}) {
  const { roomId, sharing, error, audioMissing, onStart, onStop } = props;
  const t = useT();
  const [guideOpen, setGuideOpen] = useState(false);

  return (
    <div class="screen-share-panel">
      <button
        type="button"
        class={`pill-btn ${sharing ? "pill-btn--danger" : ""}`}
        onClick={sharing ? onStop : onStart}
        title={sharing ? t("media.stopSharing") : t("media.shareScreen")}
      >
        {sharing ? <ScreenShareOff size={16} /> : <ScreenShare size={16} />}{" "}
        <span class="btn-label">
          {sharing ? t("media.stopSharing") : t("media.shareScreen")}
        </span>
      </button>
      <button
        type="button"
        class="pill-btn pill-btn--ghost pill-btn--icon"
        title={t("media.vrchatGuide")}
        aria-label={t("media.vrchatGuide")}
        onClick={() => setGuideOpen(true)}
      >
        <Cast size={16} />
      </button>
      {error && <span class="screen-share-error">{error}</span>}
      {!error && sharing && audioMissing && (
        <span class="screen-share-hint">{t("media.noAudioCaptured")}</span>
      )}

      {guideOpen && (
        <VrchatGuide roomId={roomId} sharing={sharing} onClose={() => setGuideOpen(false)} />
      )}
    </div>
  );
}
