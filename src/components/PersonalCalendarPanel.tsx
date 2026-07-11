import { useMemo, useState } from "preact/hooks";
import type { JSX } from "preact";
import { X, Plus } from "lucide-preact";
import { useT } from "../lib/i18n";
import { groupByDate, isPastDay, formatEventDay, formatEventTime } from "../lib/agenda";
import type { PersonalEvent } from "../lib/personalCalendarStore";
import { ConfirmDialog } from "./ConfirmDialog";

interface FormValues {
  title: string;
  startsAt: number;
  endsAt?: number;
  notes?: string;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toDatetimeLocal(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocal(value: string): number | undefined {
  if (!value) return undefined;
  const ts = new Date(value).getTime();
  return Number.isNaN(ts) ? undefined : ts;
}

/** Same shape as CalendarEventComposer, minus `location` — personal events
 * have no room/meeting-place concept, just a free-form notes field. */
function PersonalEventForm(props: {
  initial?: FormValues;
  onSubmit: (input: FormValues) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const { initial, onSubmit, onCancel } = props;
  const [title, setTitle] = useState(initial?.title ?? "");
  const [startsAt, setStartsAt] = useState(initial ? toDatetimeLocal(initial.startsAt) : "");
  const [endsAt, setEndsAt] = useState(initial?.endsAt ? toDatetimeLocal(initial.endsAt) : "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
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
      startsAt: startsAtMs,
      endsAt: fromDatetimeLocal(endsAt),
      notes: notes.trim() || undefined,
    });
  }

  return (
    <form class="node-composer event-composer" onSubmit={handleSubmit}>
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
      <textarea
        class="composer-text"
        placeholder={t("calendar.descriptionPlaceholder")}
        rows={2}
        value={notes}
        onInput={(e) => setNotes((e.target as HTMLTextAreaElement).value)}
      />
      {error && <p class="form-error">{error}</p>}
      <div class="composer-actions">
        <button type="button" class="composer-cancel" onClick={onCancel}>
          {t("common.cancel")}
        </button>
        <button type="submit" class="send-btn">
          {t("common.save")}
        </button>
      </div>
    </form>
  );
}

function PersonalEventRow(props: {
  event: PersonalEvent;
  onEdit: (id: string, input: FormValues) => void;
  onRemove: (id: string) => void;
}) {
  const t = useT();
  const { event, onEdit, onRemove } = props;
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  if (editing) {
    return (
      <PersonalEventForm
        initial={{ title: event.title, startsAt: event.startsAt, endsAt: event.endsAt, notes: event.notes }}
        onSubmit={(input) => {
          onEdit(event.id, input);
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <article class="event-row">
      <div class="event-row-body">
        <header class="event-row-head">
          <span class="event-row-time">{formatEventTime(event.startsAt)}</span>
          {event.endsAt !== undefined && (
            <span class="event-row-time">– {formatEventTime(event.endsAt)}</span>
          )}
          <h3 class="event-row-title">{event.title}</h3>
        </header>
        {event.notes && <p class="event-row-text">{event.notes}</p>}
        <div class="event-row-actions">
          <button type="button" class="board-node-action" onClick={() => setEditing(true)}>
            ✏️ {t("common.edit")}
          </button>
          <button
            type="button"
            class="board-node-action board-node-action--danger"
            title={t("board.deleteHint")}
            onClick={(e) => {
              if (e.shiftKey) onRemove(event.id);
              else setConfirming(true);
            }}
          >
            🗑 {t("common.delete")}
          </button>
        </div>
        {confirming && (
          <ConfirmDialog
            title={t("calendar.deleteEventTitle")}
            message={t("calendar.deleteEventMessage")}
            confirmLabel={t("common.deleteConfirm")}
            onConfirm={() => {
              onRemove(event.id);
              setConfirming(false);
            }}
            onCancel={() => setConfirming(false)}
          />
        )}
      </div>
    </article>
  );
}

/** A passive agenda list of the local user's own events — saved only on this
 * device, never broadcast to any room (contrast with CalendarView, the
 * room-shared calendar). No author concept: everything shown is your own. */
export function PersonalCalendarPanel(props: {
  events: PersonalEvent[];
  onAdd: (input: FormValues) => void;
  onEdit: (id: string, input: FormValues) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const { events, onAdd, onEdit, onRemove, onClose } = props;
  const [composing, setComposing] = useState(false);
  const [showPast, setShowPast] = useState(false);

  const groups = useMemo(() => groupByDate(events, (e) => e.startsAt), [events]);
  const now = Date.now();
  const upcoming = useMemo(() => groups.filter((g) => !isPastDay(g.dayStart, now)), [groups, now]);
  const past = useMemo(() => groups.filter((g) => isPastDay(g.dayStart, now)), [groups, now]);

  function handleAdd(input: FormValues) {
    onAdd(input);
    setComposing(false);
  }

  return (
    <div class="modal-overlay" onClick={onClose}>
      <div class="modal personal-calendar-panel" onClick={(e) => e.stopPropagation()}>
        <header class="modal-header">
          <h2>{t("calendar.personalCalendarTitle")}</h2>
          <button type="button" class="modal-close" aria-label={t("common.close")} onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <p class="board-subtitle">{t("calendar.personalCalendarSubtitle")}</p>

        <div class="personal-calendar-scroll">
          {!composing && (
            <button type="button" class="send-btn" onClick={() => setComposing(true)}>
              <Plus size={16} /> {t("calendar.newEvent")}
            </button>
          )}
          {composing && <PersonalEventForm onSubmit={handleAdd} onCancel={() => setComposing(false)} />}

          {upcoming.length === 0 && !composing && (
            <div class="board-empty">
              <p>{t("calendar.noEvents")}</p>
            </div>
          )}

          {upcoming.map((group) => (
            <section key={group.dateKey} class="event-day-group">
              <h4 class="event-day-label">{formatEventDay(group.dayStart)}</h4>
              {group.items.map((event) => (
                <PersonalEventRow key={event.id} event={event} onEdit={onEdit} onRemove={onRemove} />
              ))}
            </section>
          ))}

          {past.length > 0 && (
            <div class="event-past-toggle">
              <button
                type="button"
                class="board-node-action board-node-action--muted"
                onClick={() => setShowPast((v) => !v)}
              >
                {showPast ? `▾ ${t("calendar.hidePast")}` : `▸ ${t("calendar.showPast")}`}
              </button>
            </div>
          )}
          {showPast &&
            past.map((group) => (
              <section key={group.dateKey} class="event-day-group event-day-group--past">
                <h4 class="event-day-label">{formatEventDay(group.dayStart)}</h4>
                {group.items.map((event) => (
                  <PersonalEventRow key={event.id} event={event} onEdit={onEdit} onRemove={onRemove} />
                ))}
              </section>
            ))}
        </div>
      </div>
    </div>
  );
}
