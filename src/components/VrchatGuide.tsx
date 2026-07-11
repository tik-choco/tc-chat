import { useState } from "preact/hooks";
import { createPortal } from "preact/compat";
import { Monitor, X, Check } from "lucide-preact";
import { useT } from "../lib/i18n";

const RTSP_URL = "rtsp://127.0.0.1:8554/stream";

/** A copyable code line with a one-tap copy button and transient feedback. */
function CopyLine(props: { value: string; label?: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(props.value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable; ignore.
    }
  }
  return (
    <div class="copy-line">
      <code>{props.label ?? props.value}</code>
      <button type="button" class="copy-line-btn" onClick={copy}>
        {copied ? <Check size={14} /> : t("common.copy")}
      </button>
    </div>
  );
}

/**
 * Explains how a tc-chat screen share reaches VRChat via mistl's RTSP relay.
 * The facts here come from the mistl source: `mistl stream relay --room <id>`
 * locks onto the first peer publishing video in that room, then serves it at
 * rtsp://127.0.0.1:8554/stream for VRChat's AVPro player.
 */
export function VrchatGuide(props: { roomId: string; sharing: boolean; onClose: () => void }) {
  const { roomId, sharing, onClose } = props;
  const t = useT();
  // Pass the friendly room id; mistl derives the same channel id tc-chat joins
  // under (net::channel_id_for), so both land in the same swarm.
  const relayCommand = `mistl stream relay --room ${roomId}`;

  // Portal to <body> so the fixed overlay escapes the topbar's containing
  // block (its `backdrop-filter` makes it one for `position: fixed`
  // descendants), which would otherwise pin `inset: 0` to the topbar instead
  // of the viewport.
  return createPortal(
    <div class="modal-overlay" onClick={onClose}>
      <div class="modal vrchat-guide" onClick={(e) => e.stopPropagation()}>
        <header class="modal-header">
          <h2 class="modal-title-icon">
            <Monitor size={18} /> {t("account.vrchatGuideTitle")}
          </h2>
          <button type="button" class="modal-close" aria-label={t("common.close")} onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <p class="vrchat-intro">
          {t("account.vrchatIntroLead")}
          <strong>mistl</strong>
          {t("account.vrchatIntroTail")}
        </p>

        <ol class="vrchat-steps">
          <li>
            <span class="vrchat-step-title">{t("account.vrchatStep1Title")}</span>
            <span class="vrchat-step-body">
              {sharing ? (
                <span class="vrchat-live">{t("account.vrchatSharingLive")}</span>
              ) : (
                t("account.vrchatStep1Hint")
              )}
            </span>
          </li>
          <li>
            <span class="vrchat-step-title">{t("account.vrchatStep2Title")}</span>
            <span class="vrchat-step-body">{t("account.vrchatStep2Body")}</span>
            <CopyLine value={relayCommand} />
          </li>
          <li>
            <span class="vrchat-step-title">{t("account.vrchatStep3Title")}</span>
            <span class="vrchat-step-body">{t("account.vrchatStep3Body")}</span>
            <CopyLine value={RTSP_URL} />
          </li>
        </ol>

        <div class="vrchat-notes">
          <p>
            <strong>{t("account.vrchatHintLabel")}</strong> {t("account.vrchatHintBody")}
          </p>
          <p>
            {t("account.vrchatLanNote1")}
            <code>stream.rtsp_url</code>
            {t("account.vrchatLanNote2")}
            <code>0.0.0.0</code>
            {t("account.vrchatLanNote3")}
            <code>rtsp://&lt;LAN-IP&gt;:8554/stream</code>
            {t("account.vrchatLanNote4")}
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
