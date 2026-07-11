import { useMemo, useState } from "preact/hooks";
import { CalendarDays, Plus } from "lucide-preact";
import type { PostNode } from "../lib/chatStore";
import type { ProfileDirectory } from "../lib/profileDirectory";
import { useT } from "../lib/i18n";
import { groupByDate, isPastDay, formatEventDay } from "../lib/agenda";
import { CalendarEventComposer, type EventFormValues } from "./CalendarEventComposer";
import { CalendarEventRow } from "./CalendarEventRow";

/** The room-shared calendar: an agenda list of "event" posts for this room,
 * grouped by day, riding the exact same signed post-stream engine as chat and
 * the board (see useCalendarEvents). */
export function CalendarView(props: {
  roomName: string;
  localNodeId: string | null;
  events: PostNode[];
  ready: boolean;
  directory: ProfileDirectory;
  onCreate: (input: EventFormValues) => void;
  onEdit: (id: string, input: EventFormValues) => void;
  onDelete: (id: string) => void;
}) {
  const { roomName, localNodeId, events, ready, directory, onCreate, onEdit, onDelete } = props;
  const t = useT();
  const [composing, setComposing] = useState(false);
  const [showPast, setShowPast] = useState(false);

  const live = useMemo(() => events.filter((e) => !e.deleted), [events]);
  const groups = useMemo(() => groupByDate(live, (e) => e.startsAt ?? e.timestamp), [live]);
  const now = Date.now();
  const upcoming = useMemo(() => groups.filter((g) => !isPastDay(g.dayStart, now)), [groups, now]);
  const past = useMemo(() => groups.filter((g) => isPastDay(g.dayStart, now)), [groups, now]);

  function handleCreate(input: EventFormValues) {
    onCreate(input);
    setComposing(false);
  }

  return (
    <div class="board calendar-view">
      <header class="board-header">
        <div class="board-header-titles">
          <h2>
            <CalendarDays size={18} class="topbar-hash" /> {roomName}
          </h2>
          <p class="board-subtitle">{t("calendar.roomCalendarSubtitle")}</p>
        </div>
        <button
          type="button"
          class="send-btn"
          disabled={!ready}
          onClick={() => setComposing((v) => !v)}
        >
          <Plus size={16} /> {t("calendar.newEvent")}
        </button>
      </header>

      <div class="board-scroll">
        {composing && (
          <CalendarEventComposer mode="create" onSubmit={handleCreate} onCancel={() => setComposing(false)} />
        )}

        {upcoming.length === 0 && !composing && (
          <div class="board-empty">
            <p>{t("calendar.noEvents")}</p>
          </div>
        )}

        {upcoming.map((group) => (
          <section key={group.dateKey} class="event-day-group">
            <h4 class="event-day-label">{formatEventDay(group.dayStart)}</h4>
            {group.items.map((event) => (
              <CalendarEventRow
                key={event.id}
                event={event}
                localId={localNodeId}
                directory={directory}
                onEdit={onEdit}
                onDelete={onDelete}
              />
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
                <CalendarEventRow
                  key={event.id}
                  event={event}
                  localId={localNodeId}
                  directory={directory}
                  onEdit={onEdit}
                  onDelete={onDelete}
                />
              ))}
            </section>
          ))}
      </div>
    </div>
  );
}
