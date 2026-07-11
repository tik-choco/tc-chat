import { useState } from "preact/hooks";
import type { JSX } from "preact";
import { useT } from "../lib/i18n";

export function UsernameGate(props: { onSubmit: (name: string) => void }) {
  const t = useT();
  const [name, setName] = useState("");

  function handleSubmit(e: JSX.TargetedEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    props.onSubmit(trimmed);
  }

  return (
    <div class="username-gate">
      <form class="username-card" onSubmit={handleSubmit}>
        <div class="username-logo">💬</div>
        <h1>TC Chat</h1>
        <p class="username-sub">{t("account.gateTagline")}</p>
        <label class="username-field">
          <span>{t("account.displayName")}</span>
          <input
            autoFocus
            value={name}
            maxLength={40}
            placeholder={t("account.nicknamePlaceholder")}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
          />
        </label>
        <button type="submit" disabled={!name.trim()}>
          {t("account.getStarted")}
        </button>
        <p class="username-foot">{t("account.gateFooter")}</p>
      </form>
    </div>
  );
}
