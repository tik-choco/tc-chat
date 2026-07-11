// Room calendar (CalendarView/CalendarEventComposer/CalendarEventRow) and the
// personal calendar (PersonalCalendarPanel). Author `ja`, then `en: typeof
// ja`. Reuse ../common for shared actions (save, cancel, delete, edit, close,
// edited, irreversible).
const ja = {
  newEvent: "新しい予定",
  titlePlaceholder: "予定のタイトル",
  startsAtLabel: "開始日時",
  endsAtLabel: "終了日時（任意）",
  locationPlaceholder: "場所（任意）",
  descriptionPlaceholder: "詳細（任意）",
  today: "今日",
  noEvents: "予定はまだありません",
  showPast: "過去の予定を表示",
  hidePast: "過去の予定を隠す",
  deleteEventTitle: "予定を削除",
  deleteEventMessage: "この予定を削除しますか？この操作は取り消せません。",
  errTitle: "タイトルを入力してください",
  errStartsAt: "開始日時を入力してください",
  personalCalendarTitle: "個人カレンダー",
  personalCalendarSubtitle: "自分の端末だけに保存される、あなただけの予定です。",
  roomCalendarSubtitle: "このルームの参加者全員が見える予定表です。",
};

const en: typeof ja = {
  newEvent: "New event",
  titlePlaceholder: "Event title",
  startsAtLabel: "Starts",
  endsAtLabel: "Ends (optional)",
  locationPlaceholder: "Location (optional)",
  descriptionPlaceholder: "Description (optional)",
  today: "Today",
  noEvents: "No events yet",
  showPast: "Show past events",
  hidePast: "Hide past events",
  deleteEventTitle: "Delete event",
  deleteEventMessage: "Delete this event? This can't be undone.",
  errTitle: "Please enter a title",
  errStartsAt: "Please choose a start date/time",
  personalCalendarTitle: "Personal calendar",
  personalCalendarSubtitle: "Saved only on this device — visible to no one else.",
  roomCalendarSubtitle: "Visible to everyone currently in this room.",
};

export const calendar = { ja, en };
