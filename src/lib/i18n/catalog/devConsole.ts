// DevConsole (the developer-mode live log panel). Level badges (LOG/INFO/
// WARN/ERROR/DEBUG) are intentionally left untranslated, same convention as
// browser devtools, so they stay recognizable across languages.
const ja = {
  title: "開発者コンソール",
  searchPlaceholder: "ログを検索",
  clear: "クリア",
  copyAll: "すべてコピー",
  empty: "ログはまだありません",
  newLogs: "新しいログ",
  collapse: "折りたたむ",
  expand: "開く",
};

const en: typeof ja = {
  title: "Developer console",
  searchPlaceholder: "Search logs",
  clear: "Clear",
  copyAll: "Copy all",
  empty: "No log entries yet",
  newLogs: "New logs",
  collapse: "Collapse",
  expand: "Expand",
};

export const devConsole = { ja, en };
