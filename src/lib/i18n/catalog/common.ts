// Shared, cross-feature strings — actions and chrome reused everywhere. Domain
// catalogs (chat/board/media/account) should reuse these keys (t("common.save"))
// instead of re-defining "保存" etc., so wording stays consistent app-wide.
//
// Pattern for every catalog file: author `ja` (the source), then `en` typed as
// `typeof ja` so TypeScript flags any key present in one but missing in the
// other. Additional languages live in ../locales/<lang>.ts.
const ja = {
  cancel: "キャンセル",
  save: "保存",
  delete: "削除",
  deleteConfirm: "削除する",
  close: "閉じる",
  closeMenu: "メニューを閉じる",
  send: "送信",
  edit: "編集",
  copy: "コピー",
  copied: "コピーしました",
  loading: "読み込み中…",
  globalRoom: "グローバル",
  verified: "検証済み",
  you: "あなた",
  edited: "(編集済み)",
  irreversible: "この操作は取り消せません。",
  retry: "再試行",
  // Shown when a post's body/media couldn't be fetched from the swarm at all
  // (e.g. the author is offline and nobody else is relaying it) — distinct
  // from a still-in-flight loading state.
  mediaUnavailable: "コンテンツを利用できません（投稿者がオフラインの可能性があります）",
};

const en: typeof ja = {
  cancel: "Cancel",
  save: "Save",
  delete: "Delete",
  deleteConfirm: "Delete",
  close: "Close",
  closeMenu: "Close menu",
  send: "Send",
  edit: "Edit",
  copy: "Copy",
  copied: "Copied",
  loading: "Loading…",
  globalRoom: "Global",
  verified: "Verified",
  you: "You",
  edited: "(edited)",
  irreversible: "This action cannot be undone.",
  retry: "Retry",
  mediaUnavailable: "Content unavailable (poster may be offline)",
};

export const common = { ja, en };
