import { useState } from "preact/hooks";
import type { JSX } from "preact";
import { useT } from "../lib/i18n";

export interface EventFormValues {
  title: string;
  text?: string;
  startsAt: number;
  endsAt?: number;
  location?: string;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** epoch ms -> the string a `datetime-local` input expects, in local time. */
function toDatetimeLocal(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The inverse — undefined for an empty/unparseable value. */
function fromDatetimeLocal(value: string): number | undefined {
  if (!value) return undefined;
  const ts = new Date(value).getTime();
  return Number.isNaN(ts) ? undefined : ts;
}

/**
 * The single composer for a calendar event, in either "create" or "edit"
 * mode. Only title + startsAt are mandatory — endsAt/location/description are
 * all optional, unlike the board's NodeComposer where body text is required.
 */
export function CalendarEventComposer(props: {
  mode: "create" | "edit";
  initial?: EventFormValues;
  onSubmit: (input: EventFormValues) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const { mode, initial, onSubmit, onCancel } = props;
  const [title, setTitle] = useState(initial?.title ?? "");
  const [startsAt, setStartsAt] = useState(initial ? toDatetimeLocal(initial.startsAt) : "");
  const [endsAt, setEndsAt] = useState(initial?.endsAt ? toDatetimeLocal(initial.endsAt) : "");
  const [location, setLocation] = useState(initial?.location ?? "");
  const [text, setText] = useState(initial?.text ?? "");
  const [error, setError] = useState("");

  function handleSubmit(e: JSX.TargetedEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!title.trim()) {
      setError(t("calendar.errTitle"));
      return;
    }
    const startsAtMs = fromDatetimeLocal(startsAt);
    if (!startsAtMs) {
      setError(t("calendar.errStartsAt"));
      return;
    }
    onSubmit({
      title: title.trim(),
      text: text.trim() || undefined,
      startsAt: startsAtMs,
      endsAt: fromDatetimeLocal(endsAt),
      location: location.trim() || undefined,
    });
  }

  return (
    <form class={`node-composer event-composer event-composer--${mode}`} onSubmit={handleSubmit}>
      <input
        class="composer-title"
        placeholder={t("calendar.titlePlaceholder")}
        value={title}
        autoFocus
        onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
      />
      <div class="event-composer-row">
        <label class="event-composer-field">
          <span>{t("calendar.startsAtLabel")}</span>
          <input
            type="datetime-local"
            value={startsAt}
            onInput={(e) => setStartsAt((e.target as HTMLInputElement).value)}
          />
        </label>
        <label class="event-composer-field">
          <span>{t("calendar.endsAtLabel")}</span>
          <input
            type="datetime-local"
            value={endsAt}
            onInput={(e) => setEndsAt((e.target as HTMLInputElement).value)}
          />
        </label>
      </div>
      <input
        placeholder={t("calendar.locationPlaceholder")}
        value={location}
        onInput={(e) => setLocation((e.target as HTMLInputElement).value)}
      />
      <textarea
        class="composer-text"
        placeholder={t("calendar.descriptionPlaceholder")}
        rows={2}
        value={text}
        onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
      />

      {error && <p class="form-error">{error}</p>}

      <div class="composer-actions">
        <button type="button" class="composer-cancel" onClick={onCancel}>
          {t("common.cancel")}
        </button>
        <button type="submit" class="send-btn">
          {mode === "edit" ? t("common.save") : t("calendar.newEvent")}
        </button>
      </div>
    </form>
  );
}
