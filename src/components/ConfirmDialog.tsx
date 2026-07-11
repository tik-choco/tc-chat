import { useEffect, useRef } from "preact/hooks";
import { AlertTriangle } from "lucide-preact";
import { useT } from "../lib/i18n";

/**
 * A modern, in-app confirmation modal — the replacement for `window.confirm`,
 * which is a jarring, unstyled OS prompt. Matches the shared `.modal` shell
 * (see modal.css). Overlay click and Escape both cancel; the confirm button is
 * auto-focused so a keyboard user can Enter-to-confirm.
 *
 * For destructive actions the caller usually offers a Shift-click shortcut that
 * skips this dialog entirely — this modal is the deliberate, mouse-only path.
 */
export function ConfirmDialog(props: {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" tints the confirm button red (destructive); "primary" is neutral. */
  tone?: "danger" | "primary";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const {
    title,
    message,
    confirmLabel = t("common.deleteConfirm"),
    cancelLabel = t("common.cancel"),
    tone = "danger",
    onConfirm,
    onCancel,
  } = props;
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
        class="modal confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div class={`confirm-icon confirm-icon--${tone}`}>
          <AlertTriangle size={22} />
        </div>
        <h2 class="confirm-title">{title}</h2>
        <p class="confirm-message">{message}</p>
        <div class="modal-actions">
          <button type="button" class="btn-ghost" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            class={tone === "danger" ? "btn-danger" : "send-btn"}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
