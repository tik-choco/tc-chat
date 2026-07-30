// "Download my history" strings (HistoryArchivePanel) — an export-only,
// room-by-room backup of what this browser has cached locally. See
// historyArchive.ts for exactly what that leaves out (media/file bytes,
// reactor DIDs) and why there is no matching import feature. Author `ja`,
// then `en: typeof ja`.
const ja = {
  title: "履歴のバックアップ",
  desc: "このブラウザに保存されている各ルームの履歴を、JSONファイルとしてダウンロードできます。",
  openPanel: "履歴のバックアップ",
  download: "ダウンロード",
  postCount: "{count}件の投稿",
  empty: "投稿はまだありません",
  noRooms: "参加しているルームがありません",
  mediaNote: "画像やファイルの中身は含まれません。ファイルへの参照（CID）のみが記録されます。",
};

const en: typeof ja = {
  title: "History backup",
  desc: "Download each room's locally cached history as a JSON file.",
  openPanel: "History backup",
  download: "Download",
  postCount: "{count} posts",
  empty: "No posts yet",
  noRooms: "You haven't joined any rooms",
  mediaNote: "Images and files aren't included — only a reference (CID) to them is recorded.",
};

export const archive = { ja, en };
