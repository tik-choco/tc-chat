import { useState } from "preact/hooks";
import type { JSX } from "preact";
import { X } from "lucide-preact";
import { useT } from "../lib/i18n";

/** Dumb controlled dialog for setting a per-room display-name override —
 * only applies to messages sent in `roomName`, overriding the global
 * profile name. All persistence lives in the caller (app.tsx); this panel
 * just edits local text and reports the trimmed result on save. */
export function RoomNamePanel(props: {
  roomName: string;
  globalName: string;
  value: string;
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  const { roomName, globalName, value, onSave, onClose } = props;
  const t = useT();
  const [name, setName] = useState(value);

  function handleSubmit(e: JSX.TargetedEvent<HTMLFormElement>) {
    e.preventDefault();
    onSave(name.trim());
    onClose();
  }

  return (
    <div class="modal-overlay" onClick={onClose}>
      <div class="modal" onClick={(e) => e.stopPropagation()}>
        <header class="modal-header">
          <h2>{t("account.roomNicknameTitle")}</h2>
          <button type="button" class="modal-close" aria-label={t("common.close")} onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <p class="board-subtitle">{roomName}</p>

        <form onSubmit={handleSubmit}>
          <label class="field">
            <input
              value={name}
              maxLength={60}
              placeholder={t("account.roomNicknamePlaceholder", { name: globalName })}
              onInput={(e) => setName((e.target as HTMLInputElement).value)}
            />
          </label>

          <p class="profile-hint">{t("account.roomNicknameHint")}</p>

          <div class="modal-actions">
            <button type="button" class="composer-cancel" onClick={onClose}>
              {t("common.cancel")}
            </button>
            <button type="submit" class="send-btn">
              {t("common.save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
