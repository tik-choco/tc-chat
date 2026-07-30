// The personal notes space (PersonalChat) — a chat-shaped scratchpad that
// never leaves this device. The strings lean hard on saying so, because the
// space sits in the room list next to real, shared rooms and the whole value
// of it depends on the user trusting that nothing here is broadcast. See
// personalNotesStore.ts. Author `ja`, then `en: typeof ja`.
const ja = {
  title: "マイメモ",
  subtitle: "この端末だけに保存されます",
  privacyNote:
    "ここに書いた内容は誰にも送信されません。他のルームと違い、通信も同期も行われず、この端末の中だけに保存されます。",
  empty: "まだメモはありません。思いついたことを気軽に書き留めておけます。",
  composerPlaceholder: "メモを入力…",
  send: "保存",
  attach: "ファイルを添付",
  attachHint: "画像・動画・ファイルを添付できます",
  edited: "編集済み",
  editNote: "メモを編集",
  deleteNote: "メモを削除",
  deleteConfirmTitle: "このメモを削除しますか？",
  deleteConfirmBody: "削除すると元に戻せません。",
  captionPlaceholder: "キャプション（任意）",
  loading: "読み込み中…",
  attachmentFailed: "添付ファイルを読み込めませんでした",
  errLoad: "メモを読み込めませんでした。ページを再読み込みしてみてください。",
  errSave: "メモを保存できませんでした。保存領域が使えない可能性があります。",
  errAttach: "ファイルを添付できませんでした。",
};

const en: typeof ja = {
  title: "My notes",
  subtitle: "Saved on this device only",
  privacyNote:
    "Nothing written here is ever sent to anyone. Unlike the other rooms there is no transmission and no sync — it stays on this device.",
  empty: "No notes yet. Jot down whatever comes to mind.",
  composerPlaceholder: "Write a note…",
  send: "Save",
  attach: "Attach a file",
  attachHint: "Attach an image, a video or any file",
  edited: "edited",
  editNote: "Edit note",
  deleteNote: "Delete note",
  deleteConfirmTitle: "Delete this note?",
  deleteConfirmBody: "This can't be undone.",
  captionPlaceholder: "Caption (optional)",
  loading: "Loading…",
  attachmentFailed: "Couldn't load the attachment",
  errLoad: "Couldn't load your notes. Try reloading the page.",
  errSave: "Couldn't save the note — the storage area may be unavailable.",
  errAttach: "Couldn't attach that file.",
};

export const personal = { ja, en };
