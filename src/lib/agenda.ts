// Shared date-bucketing for the room calendar (CalendarView.tsx) and the
// personal calendar (PersonalCalendarPanel.tsx) — the two calendar features
// stay fully separate in data/components, but both render an agenda list
// grouped by day, so the grouping logic lives here once.

export interface AgendaGroup<T> {
  /** Sortable key, e.g. "2026-07-08". */
  dateKey: string;
  /** Epoch ms at local midnight for this day. */
  dayStart: number;
  items: T[];
}

/** Groups items by local calendar day, each group's items sorted ascending by start time. */
export function groupByDate<T>(items: T[], getStartsAt: (item: T) => number): AgendaGroup<T>[] {
  const sorted = [...items].sort((a, b) => getStartsAt(a) - getStartsAt(b));
  const groups = new Map<string, AgendaGroup<T>>();
  for (const item of sorted) {
    const d = new Date(getStartsAt(item));
    const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    let group = groups.get(dateKey);
    if (!group) {
      group = { dateKey, dayStart: new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(), items: [] };
      groups.set(dateKey, group);
    }
    group.items.push(item);
  }
  return Array.from(groups.values()).sort((a, b) => a.dayStart - b.dayStart);
}

/** Whether a local calendar day (from an AgendaGroup's dayStart) is before today. */
export function isPastDay(dayStart: number, now: number): boolean {
  const today = new Date(now);
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return dayStart < todayStart;
}

/** "7/8 (火)" style day label in the browser's locale. */
export function formatEventDay(ts: number): string {
  return new Intl.DateTimeFormat(undefined, { month: "numeric", day: "numeric", weekday: "short" }).format(ts);
}

/** "14:30" style time label. */
export function formatEventTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
