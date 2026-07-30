// Cross-room message search (SearchPanel). Author `ja`, then `en: typeof ja`.
//
// A hit's surface is labelled with the room tab's own key (chat.chatTab etc.)
// rather than a duplicate set here, so a result always reads with the same
// word as the tab it will navigate to.
const ja = {
  title: "メッセージを検索",
  placeholder: "キーワードを入力…",
  empty: "検索したいキーワードを入力してください",
  noResults: "一致するメッセージが見つかりませんでした",
  resultsCount: "{count}件見つかりました",
  openAction: "開く",
  /** Sidebar entry point that opens this panel. */
  openPanel: "メッセージを検索",
};

const en: typeof ja = {
  title: "Search messages",
  placeholder: "Type a keyword…",
  empty: "Type something to search for",
  noResults: "No matching messages found",
  resultsCount: "{count} results",
  openAction: "Open",
  openPanel: "Search messages",
};

export const search = { ja, en };
