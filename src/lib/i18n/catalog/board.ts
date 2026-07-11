// Board surface strings (BoardNodeView, NodeComposer, ProjectBoard). Author
// `ja`, then `en: typeof ja`. Reuse ../common for shared actions. Filled by the
// board conversion pass.
const ja = {
  // Post kinds / filters (shared by the composer toggle, filter bar, and badge).
  filterAll: "すべて",
  recruit: "募集",
  topic: "話題",

  // Board chrome (ProjectBoard).
  subtitle: "スレッドは何段でもぶら下げられます",
  newPost: "新規投稿",
  emptyAll: "まだ投稿がありません",
  emptyFiltered: "この種類の投稿はまだありません",
  firstPost: "最初の投稿をする",

  // Node view (BoardNodeView).
  reply: "返信",
  replies: "{count}件の返信",
  showReplies: "{count}件の返信を表示",
  postDeleted: "この投稿は削除されました",
  verifiedTooltip: "検証済み: {did}",
  deleteHint: "削除（Shift+クリックで確認なし）",
  deletePostTitle: "投稿を削除",
  deletePostMessage: "この投稿を削除しますか？この操作は取り消せません。",
  titlePlaceholder: "タイトル",

  // Composer (NodeComposer).
  titleOptionalPlaceholder: "タイトル（任意）",
  recruitTitlePlaceholder: "募集タイトル",
  replyPlaceholder: "返信を書く…",
  recruitBodyPlaceholder: "募集の概要・詳細",
  bodyPlaceholder: "内容を書く…",
  rolesPlaceholder: "募集役割 (カンマ区切り)",
  tagsPlaceholder: "タグ (カンマ区切り)",
  errBody: "内容を入力してください",
  errRecruitBody: "募集の内容を入力してください",
  errRecruitTitle: "募集タイトルを入力してください",
  submitPost: "投稿",
  submitRecruit: "募集を投稿",

  // --- note-article import chip (tc-note handoff via the shared bus) ---
  importArticleChip: "tc-noteの記事を取り込む: {title}",
  importArticleDismiss: "取り込みを見送る",
  // --- end note-article import chip ---
};

const en: typeof ja = {
  filterAll: "All",
  recruit: "Recruiting",
  topic: "Discussion",

  subtitle: "Threads can nest as deep as you like",
  newPost: "New post",
  emptyAll: "No posts yet",
  emptyFiltered: "No posts of this type yet",
  firstPost: "Write the first post",

  reply: "Reply",
  replies: "{count} replies",
  showReplies: "Show {count} replies",
  postDeleted: "This post was deleted",
  verifiedTooltip: "Verified: {did}",
  deleteHint: "Delete (Shift+click to skip confirmation)",
  deletePostTitle: "Delete post",
  deletePostMessage: "Delete this post? This action cannot be undone.",
  titlePlaceholder: "Title",

  titleOptionalPlaceholder: "Title (optional)",
  recruitTitlePlaceholder: "Recruitment title",
  replyPlaceholder: "Write a reply…",
  recruitBodyPlaceholder: "Describe what you're looking for",
  bodyPlaceholder: "Write something…",
  rolesPlaceholder: "Roles wanted (comma-separated)",
  tagsPlaceholder: "Tags (comma-separated)",
  errBody: "Please enter some text",
  errRecruitBody: "Please describe what you're recruiting for",
  errRecruitTitle: "Please enter a recruitment title",
  submitPost: "Post",
  submitRecruit: "Post recruitment",

  // --- note-article import chip (tc-note handoff via the shared bus) ---
  importArticleChip: "Import tc-note article: {title}",
  importArticleDismiss: "Dismiss",
  // --- end note-article import chip ---
};

export const board = { ja, en };
