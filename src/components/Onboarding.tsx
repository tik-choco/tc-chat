import { useState } from "preact/hooks";
import {
  X,
  ArrowLeft,
  ArrowRight,
  Check,
  MessagesSquare,
  Globe,
  AlertTriangle,
  MessageCircle,
  LayoutList,
  Phone,
  Monitor,
} from "lucide-preact";
import { useT } from "../lib/i18n";
import "../styles/onboarding.css";

// First-run guide shown by app.tsx as a modal overlay: welcome -> rooms (incl.
// the "global room is public" caution) -> feature tour -> done. Every step is
// skippable and closing at any point counts as "done" (the flag is owned by
// the caller via `onClose`) — the settings screen can re-open it any time.

const STEP_COUNT = 4;

export function Onboarding(props: { onClose: () => void }) {
  const t = useT();
  const [step, setStep] = useState(0);

  return (
    <div class="modal-overlay">
      <div
        class="modal onboarding-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t("onboarding.dialogLabel")}
      >
        <button
          class="ob-close"
          type="button"
          onClick={props.onClose}
          title={t("common.close")}
          aria-label={t("common.close")}
        >
          <X size={18} />
        </button>

        {step === 0 && (
          <div class="ob-body">
            <div class="ob-hero">
              <MessagesSquare size={36} />
            </div>
            <h2 class="ob-title">{t("onboarding.step0Title")}</h2>
            <p class="ob-text">{t("onboarding.step0Text1")}</p>
            <p class="ob-text">{t("onboarding.step0Text2")}</p>
          </div>
        )}

        {step === 1 && (
          <div class="ob-body">
            <div class="ob-step-head">
              <Globe size={22} />
              <h2 class="ob-title">{t("onboarding.step1Title")}</h2>
            </div>
            <p class="ob-text">{t("onboarding.step1Text")}</p>
            <div class="ob-warning" role="note">
              <AlertTriangle size={18} class="ob-warning-icon" />
              <div class="ob-warning-body">
                <strong>{t("onboarding.warningTitle")}</strong>
                <p>{t("onboarding.warningBody")}</p>
              </div>
            </div>
            <p class="ob-text ob-text-subtle">{t("onboarding.privateRoomsHint")}</p>
          </div>
        )}

        {step === 2 && (
          <div class="ob-body">
            <h2 class="ob-title">{t("onboarding.step2Title")}</h2>
            <ul class="ob-feature-list">
              <li>
                <MessageCircle size={16} />
                <span>
                  <strong>{t("onboarding.featureChatTitle")}</strong> — {t("onboarding.featureChatBody")}
                </span>
              </li>
              <li>
                <LayoutList size={16} />
                <span>
                  <strong>{t("onboarding.featureBoardTitle")}</strong> — {t("onboarding.featureBoardBody")}
                </span>
              </li>
              <li>
                <Phone size={16} />
                <span>
                  <strong>{t("onboarding.featureVoiceTitle")}</strong> — {t("onboarding.featureVoiceBody")}
                </span>
              </li>
              <li>
                <Monitor size={16} />
                <span>
                  <strong>{t("onboarding.featureScreenTitle")}</strong> — {t("onboarding.featureScreenBody")}
                </span>
              </li>
            </ul>
          </div>
        )}

        {step === 3 && (
          <div class="ob-body">
            <div class="ob-step-head">
              <Check size={22} />
              <h2 class="ob-title">{t("onboarding.step3Title")}</h2>
            </div>
            <p class="ob-text">{t("onboarding.step3Text")}</p>
            <p class="ob-text ob-text-subtle">{t("onboarding.step3Subtle")}</p>
          </div>
        )}

        <footer class="ob-footer">
          <div class="ob-dots" aria-hidden="true">
            {Array.from({ length: STEP_COUNT }, (_, i) => (
              <span key={i} class={"ob-dot" + (i === step ? " is-active" : "")} />
            ))}
          </div>
          <div class="ob-footer-actions">
            {step > 0 && (
              <button class="ob-btn" type="button" onClick={() => setStep(step - 1)}>
                <ArrowLeft size={16} />
                {t("onboarding.back")}
              </button>
            )}
            {step < STEP_COUNT - 1 && (
              <button class="ob-btn ob-btn-accent" type="button" onClick={() => setStep(step + 1)}>
                {t("onboarding.next")}
                <ArrowRight size={16} />
              </button>
            )}
            {step === STEP_COUNT - 1 && (
              <button class="ob-btn ob-btn-accent" type="button" onClick={props.onClose}>
                <Check size={16} />
                {t("onboarding.finish")}
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
