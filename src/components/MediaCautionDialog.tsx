import { useEffect, useRef, useState } from "preact/hooks";
import { AlertTriangle } from "lucide-preact";
import { useT } from "../lib/i18n";

/**
 * Shown before starting a camera or screen-share broadcast — both put the
 * user's camera image / screen contents on the wire to EVERYONE currently in
 * the room, which is easy to trigger without thinking about who else is
 * present. Default ON (see loadMediaCaution/saveMediaCaution in chatStore.ts);
 * checking the box below is the only way to turn it off, and SettingsPanel
 * offers the same toggle for turning it back on later.
 *
 * Matches ConfirmDialog's shell (modal.css's .confirm-dialog) so it reads as
 * the same kind of "are you sure" prompt, not a separate UI pattern.
 */
export function MediaCautionDialog(props: {
  kind: "camera" | "screen";
  onConfirm: (skipFuture: boolean) => void;
  onCancel: () => void;
}) {
  const { kind, onConfirm, onCancel } = props;
  const t = useT();
  const [skipFuture, setSkipFuture] = useState(false);
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div class="modal-overlay" onClick={onCancel}>
      <div
        class="modal confirm-dialog media-caution-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={t("media.cautionTitle")}
        onClick={(e) => e.stopPropagation()}
      >
        <div class="confirm-icon confirm-icon--primary">
          <AlertTriangle size={22} />
        </div>
        <h2 class="confirm-title">{t("media.cautionTitle")}</h2>
        <p class="confirm-message">
          {kind === "camera" ? t("media.cautionBodyCamera") : t("media.cautionBodyScreen")}
        </p>
        <label class="media-caution-checkbox">
          <input
            type="checkbox"
            checked={skipFuture}
            onChange={(e) => setSkipFuture((e.target as HTMLInputElement).checked)}
          />
          {t("media.cautionDontShowAgain")}
        </label>
        <div class="modal-actions">
          <button type="button" class="btn-ghost" onClick={onCancel}>
            {t("media.cautionCancel")}
          </button>
          <button
            ref={confirmRef}
            type="button"
            class="send-btn"
            onClick={() => onConfirm(skipFuture)}
          >
            {t("media.cautionContinue")}
          </button>
        </div>
      </div>
    </div>
  );
}
