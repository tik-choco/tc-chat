// Chat surface strings (MessageBubble, MessageInput, ChatWindow, ReactionBar,
// RoomContent). Author `ja`, then `en: typeof ja`. Reuse ../common for shared
// actions. Filled by the chat conversion pass.
const ja = {
  // MessageBubble (media body)
  mediaLoadFailed: "ファイルの取得に失敗しました",
  fullscreen: "全画面表示",
  viewFullscreen: "{name} を全画面表示",
  file: "ファイル",
  // MessageBubble (message row)
  messageDeleted: "このメッセージは削除されました",
  deleteHint: "削除（Shift+クリックで確認なし）",
  deleteMessageTitle: "メッセージを削除",
  deleteMessageConfirm: "このメッセージを削除しますか？この操作は取り消せません。",
  viewProfile: "{name} のプロフィールを表示",
  verifiedAs: "検証済み: {did}",
  // MessageInput
  attachFile: "ファイルを添付",
  pickFromStorage: "tc-storage から選択",
  pickGif: "GIF を送信",
  joinRoomPlaceholder: "ルームに参加してください",
  messagePlaceholder: "メッセージを入力",
  // MessageInput (voice recorder)
  recordVoice: "音声メッセージを録音",
  voiceRecording: "録音中…",
  voiceStopRecording: "録音を停止",
  voiceCancelRecording: "録音をキャンセル",
  voiceMicDenied: "マイクにアクセスできませんでした。ブラウザの設定でマイクの利用を許可してください。",
  // GifPicker
  gifPickerTitle: "GIF を選択",
  gifSearchPlaceholder: "GIPHY で GIF を検索",
  gifLoading: "読み込み中…",
  gifLoadFailed: "GIF の取得に失敗しました",
  gifNoResults: "GIF が見つかりませんでした",
  gifTrending: "トレンド中の GIF",
  gifSetupTitle: "GIPHY API キーが未設定です",
  gifSetupBody:
    "GIF 検索には無料の GIPHY API キーが必要です。以下のガイドに沿ってキーを取得し、貼り付けてください。",
  gifSetupLink: "GIPHY API キーの取得方法",
  gifApiKeyPlaceholder: "GIPHY API キーを貼り付け",
  gifSaveKey: "保存",
  gifAttribution: "Powered by GIPHY",
  // ChatWindow
  noMessages: "まだメッセージがありません",
  globalRoomBadge: "公開",
  globalRoomWarning:
    "グローバルルームは誰でも参加できる公開スペースです。送信した内容は参加者全員に見られます。",
  typingIndicator: "{names} が入力中です…",
  // ReactionBar
  addReaction: "リアクションを追加",
  nameSeparator: "、",
  // RoomContent
  openMenu: "メニューを開く",
  chatTab: "チャット",
  boardTab: "掲示板",
  calendarTab: "カレンダー",
  // useMessageAlerts (desktop notification fallback body)
  dmNotifBody: "新しいメッセージが届きました",
};

const en: typeof ja = {
  mediaLoadFailed: "Couldn't load this file",
  fullscreen: "View fullscreen",
  viewFullscreen: "View {name} fullscreen",
  file: "File",
  messageDeleted: "This message was deleted",
  deleteHint: "Delete (Shift+click to skip confirmation)",
  deleteMessageTitle: "Delete message",
  deleteMessageConfirm: "Delete this message? This can't be undone.",
  viewProfile: "View {name}'s profile",
  verifiedAs: "Verified: {did}",
  attachFile: "Attach a file",
  pickFromStorage: "Choose from tc-storage",
  pickGif: "Send a GIF",
  joinRoomPlaceholder: "Join a room to start chatting",
  messagePlaceholder: "Type a message",
  recordVoice: "Record a voice message",
  voiceRecording: "Recording…",
  voiceStopRecording: "Stop recording",
  voiceCancelRecording: "Cancel recording",
  voiceMicDenied: "Couldn't access the microphone. Please allow microphone access in your browser settings.",
  // GifPicker
  gifPickerTitle: "Choose a GIF",
  gifSearchPlaceholder: "Search GIPHY for GIFs",
  gifLoading: "Loading…",
  gifLoadFailed: "Couldn't load GIFs",
  gifNoResults: "No GIFs found",
  gifTrending: "Trending GIFs",
  gifSetupTitle: "GIPHY API key not set",
  gifSetupBody:
    "GIF search needs a free GIPHY API key. Follow the guide below to get one, then paste it in.",
  gifSetupLink: "How to get a GIPHY API key",
  gifApiKeyPlaceholder: "Paste your GIPHY API key",
  gifSaveKey: "Save",
  gifAttribution: "Powered by GIPHY",
  noMessages: "No messages yet",
  globalRoomBadge: "Public",
  globalRoomWarning:
    "The global room is open to everyone — anything you send here is visible to all participants.",
  typingIndicator: "{names} is typing…",
  addReaction: "Add a reaction",
  nameSeparator: ", ",
  openMenu: "Open menu",
  chatTab: "Chat",
  boardTab: "Board",
  calendarTab: "Calendar",
  dmNotifBody: "You have a new message",
};

export const chat = { ja, en };
