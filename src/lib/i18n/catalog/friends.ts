// Friends sidebar section (Sidebar.tsx) — a merged friends+DM list, where
// clicking a friend opens their DM and unread/online state show inline — and
// the "Add friend" action on PeerProfileModal.tsx. Author `ja`, then
// `en: typeof ja`. Reuse ../common for shared actions (close, etc.).
const ja = {
  title: "フレンド",
  empty: "まだフレンドがいません",
  addFriend: "フレンドに追加",
  added: "追加済み",
  remove: "フレンドを解除",
  sendRequest: "フレンドリクエストを送る",
  requestSent: "リクエスト送信済み",
  cancelRequest: "リクエストを取り消す",
  requestsTitle: "フレンドリクエスト",
  incomingLabel: "受信",
  outgoingLabel: "送信済み",
  accept: "承認",
  decline: "拒否",
  online: "オンライン",
};

const en: typeof ja = {
  title: "Friends",
  empty: "No friends yet",
  addFriend: "Add friend",
  added: "Added",
  remove: "Remove friend",
  sendRequest: "Send friend request",
  requestSent: "Request sent",
  cancelRequest: "Cancel request",
  requestsTitle: "Friend requests",
  incomingLabel: "Received",
  outgoingLabel: "Sent",
  accept: "Accept",
  decline: "Decline",
  online: "Online",
};

export const friends = { ja, en };
