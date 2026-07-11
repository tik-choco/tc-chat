import { useState } from "preact/hooks";
import { X, HelpCircle, Bell } from "lucide-preact";
import { type ChatDisplay, loadGiphyApiKey, saveGiphyApiKey } from "../lib/chatStore";
import type { NotifPermission } from "../hooks/useMessageAlerts";
import { useT, useLocale, LOCALES, LOCALE_LABELS } from "../lib/i18n";

export function SettingsPanel(props: {
  chatDisplay: ChatDisplay;
  onChangeChatDisplay: (display: ChatDisplay) => void;
  devMode: boolean;
  onChangeDevMode: (enabled: boolean) => void;
  notifPermission: NotifPermission;
  /** Asks the browser for Notification permission (must run on a user gesture). */
  onRequestNotifications: () => void;
  mediaCaution: boolean;
  onChangeMediaCaution: (enabled: boolean) => void;
  onClose: () => void;
  /** Closes this panel and re-opens the first-run onboarding guide. */
  onOpenGuide: () => void;
}) {
  const {
    chatDisplay,
    onChangeChatDisplay,
    devMode,
    onChangeDevMode,
    notifPermission,
    onRequestNotifications,
    mediaCaution,
    onChangeMediaCaution,
    onClose,
    onOpenGuide,
  } = props;
  const t = useT();
  const { locale, setLocale } = useLocale();
  const [giphyKey, setGiphyKey] = useState(() => loadGiphyApiKey());
  const [giphySaved, setGiphySaved] = useState(false);

  function handleSaveGiphyKey() {
    saveGiphyApiKey(giphyKey.trim());
    setGiphySaved(true);
    window.setTimeout(() => setGiphySaved(false), 1500);
  }

  const displayOptions: { id: ChatDisplay; label: string; desc: string }[] = [
    { id: "list", label: t("settings.displayListLabel"), desc: t("settings.displayListDesc") },
    { id: "bubble", label: t("settings.displayBubbleLabel"), desc: t("settings.displayBubbleDesc") },
  ];

  return (
    <div class="modal-overlay" onClick={onClose}>
      <div class="modal settings-panel" onClick={(e) => e.stopPropagation()}>
        <header class="modal-header">
          <h2>{t("settings.title")}</h2>
          <button type="button" class="modal-close" aria-label={t("common.close")} onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <section class="settings-section">
          <h3 class="settings-title">{t("settings.language")}</h3>
          <div class="settings-options settings-options--languages">
            {LOCALES.map((loc) => (
              <button
                key={loc}
                type="button"
                lang={loc}
                class={`settings-lang ${locale === loc ? "settings-lang--active" : ""}`}
                aria-pressed={locale === loc}
                onClick={() => setLocale(loc)}
              >
                {LOCALE_LABELS[loc]}
              </button>
            ))}
          </div>
        </section>

        <section class="settings-section">
          <h3 class="settings-title">{t("settings.chatDisplay")}</h3>
          <div class="settings-options">
            {displayOptions.map((opt) => (
              <button
                key={opt.id}
                type="button"
                class={`settings-option ${chatDisplay === opt.id ? "settings-option--active" : ""}`}
                onClick={() => onChangeChatDisplay(opt.id)}
              >
                <span class="settings-option-radio" aria-hidden="true" />
                <span class="settings-option-body">
                  <span class="settings-option-label">{opt.label}</span>
                  <span class="settings-option-desc">{opt.desc}</span>
                </span>
              </button>
            ))}
          </div>
        </section>

        <section class="settings-section">
          <h3 class="settings-title">{t("settings.notifications")}</h3>
          <div class="settings-options">
            <button
              type="button"
              class={`settings-option ${notifPermission === "granted" ? "settings-option--active" : ""}`}
              aria-pressed={notifPermission === "granted"}
              // Once denied/unsupported only the browser UI can change it, so
              // the button turns into a passive status row.
              disabled={notifPermission === "denied" || notifPermission === "unsupported"}
              onClick={onRequestNotifications}
            >
              <Bell size={16} class="settings-option-icon" />
              <span class="settings-option-body">
                <span class="settings-option-label">{t("settings.notifLabel")}</span>
                <span class="settings-option-desc">
                  {notifPermission === "granted"
                    ? t("settings.notifGranted")
                    : notifPermission === "denied"
                      ? t("settings.notifDenied")
                      : notifPermission === "unsupported"
                        ? t("settings.notifUnsupported")
                        : t("settings.notifDesc")}
                </span>
              </span>
            </button>
          </div>
        </section>

        <section class="settings-section">
          <h3 class="settings-title">{t("settings.giphyApiKey")}</h3>
          <p class="settings-desc">{t("settings.giphyApiKeyDesc")}</p>
          <div class="settings-giphy-row">
            <input
              type="text"
              class="settings-giphy-input"
              placeholder={t("settings.giphyApiKeyPlaceholder")}
              value={giphyKey}
              onInput={(e) => setGiphyKey((e.target as HTMLInputElement).value)}
            />
            <button type="button" class="settings-option settings-giphy-save" onClick={handleSaveGiphyKey}>
              {giphySaved ? t("settings.giphyApiKeySaved") : t("common.save")}
            </button>
          </div>
        </section>

        <section class="settings-section">
          <h3 class="settings-title">{t("settings.help")}</h3>
          <div class="settings-options">
            <button type="button" class="settings-option" onClick={onOpenGuide}>
              <HelpCircle size={16} class="settings-option-icon" />
              <span class="settings-option-body">
                <span class="settings-option-label">{t("settings.viewGuide")}</span>
              </span>
            </button>
          </div>
        </section>

        <section class="settings-section">
          <h3 class="settings-title">{t("settings.mediaCaution")}</h3>
          <div class="settings-options">
            <button
              type="button"
              class={`settings-option ${mediaCaution ? "settings-option--active" : ""}`}
              aria-pressed={mediaCaution}
              onClick={() => onChangeMediaCaution(!mediaCaution)}
            >
              <span class="settings-option-radio" aria-hidden="true" />
              <span class="settings-option-body">
                <span class="settings-option-label">{t("settings.mediaCautionLabel")}</span>
                <span class="settings-option-desc">{t("settings.mediaCautionDesc")}</span>
              </span>
            </button>
          </div>
        </section>

        <section class="settings-section">
          <h3 class="settings-title">{t("settings.developer")}</h3>
          <div class="settings-options">
            <button
              type="button"
              class={`settings-option ${devMode ? "settings-option--active" : ""}`}
              aria-pressed={devMode}
              onClick={() => onChangeDevMode(!devMode)}
            >
              <span class="settings-option-radio" aria-hidden="true" />
              <span class="settings-option-body">
                <span class="settings-option-label">{t("settings.developerModeLabel")}</span>
                <span class="settings-option-desc">{t("settings.developerModeDesc")}</span>
              </span>
            </button>
          </div>
        </section>

        <div class="modal-actions">
          <button type="button" class="send-btn" onClick={onClose}>
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
