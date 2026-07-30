// Per-room alerting strings — the room notify/badge toggles in a room's
// settings and the silenced-rooms list in SettingsPanel. Silencing a room is
// local-only and per-room (unlike muting a person, which is global): see
// roomNotifyStore.ts. Author `ja`, then `en: typeof ja`.
const ja = {
  roomAlertsTitle: "ルームごとの通知設定",
  roomAlertsDesc:
    "通知をオフにしても、このルームの投稿は普段どおり届いて保存されます。止まるのはデスクトップ通知と未読バッジだけです（ユーザーのミュートとは別の機能です）。",
  notifyLabel: "デスクトップ通知",
  notifyDesc: "このルームの新着投稿でデスクトップ通知を表示しません。",
  badgeLabel: "未読バッジ",
  badgeDesc: "このルームの未読件数をサイドバーに表示しません。",
  silencedBadge: "通知オフ",
  toggleAria: "「{room}」の通知設定を切り替え",
  settingsEmpty: "通知をオフにしているルームはありません",
  settingsCount: "{count}件のルームで通知オフ",
  allEnabled: "通知は既定のまま",
};

const en: typeof ja = {
  roomAlertsTitle: "Room notifications",
  roomAlertsDesc:
    "Turning off alerts for a room doesn't stop its posts — they still arrive and get saved as usual. It only stops desktop notifications and the unread badge (this is separate from muting a person).",
  notifyLabel: "Desktop notifications",
  notifyDesc: "Don't show a desktop notification for new posts in this room.",
  badgeLabel: "Unread badge",
  badgeDesc: "Don't show this room's unread count in the sidebar.",
  silencedBadge: "Silenced",
  toggleAria: 'Toggle alert settings for "{room}"',
  settingsEmpty: "You haven't silenced any rooms",
  settingsCount: "{count} rooms silenced",
  allEnabled: "Alerts at default",
};

export const notifications = { ja, en };
