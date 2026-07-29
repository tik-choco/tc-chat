// Room invite strings (RoomInvitePanel, JoinRoomBanner, the invite entry points
// in Sidebar/ChatWindow). Author `ja`, then `en: typeof ja`.
const ja = {
  // RoomInvitePanel
  title: "ルームに招待",
  subtitle: "「{room}」への招待",
  linkLabel: "招待リンク",
  copyLink: "リンクをコピー",
  share: "共有",
  qrLabel: "QRコードで招待",
  qrHint: "スマートフォンのカメラで読み取ると、このルームが開きます。",
  qrAlt: "「{room}」の招待リンクのQRコード",
  roomIdLabel: "ルームID",
  friendsTitle: "フレンドに送る",
  friendsEmpty: "フレンドがまだいません",
  send: "送る",
  sending: "送信中…",
  sent: "送信済み",
  sendFailed: "送信に失敗しました",
  // The DM body itself — `\n` separates the invitation line from the link so
  // the link autolinks on its own line (see markdown.ts).
  dmBody: "「{room}」に招待します\n{url}",
  hint: "このリンク（またはルームID）を知っている人は誰でもこのルームに参加できます。信頼できる相手にだけ共有してください。",
  inviteAction: "このルームに招待",

  // JoinRoomBanner — shown when the room on screen isn't in the room list yet.
  bannerInvited: "「{room}」に招待されています",
  bannerUnjoined: "このルームはルーム一覧に追加されていません",
  bannerJoin: "ルームに追加",
  bannerDismiss: "閉じる",
};

const en: typeof ja = {
  // RoomInvitePanel
  title: "Invite to room",
  subtitle: 'Invite to "{room}"',
  linkLabel: "Invite link",
  copyLink: "Copy link",
  share: "Share",
  qrLabel: "Invite by QR code",
  qrHint: "Scan it with a phone camera to open this room.",
  qrAlt: 'QR code for the "{room}" invite link',
  roomIdLabel: "Room ID",
  friendsTitle: "Send to a friend",
  friendsEmpty: "No friends yet",
  send: "Send",
  sending: "Sending…",
  sent: "Sent",
  sendFailed: "Couldn't send the invite",
  dmBody: 'You\'re invited to "{room}"\n{url}',
  hint: "Anyone with this link (or the room ID) can join this room. Only share it with people you trust.",
  inviteAction: "Invite to this room",

  // JoinRoomBanner
  bannerInvited: 'You\'ve been invited to "{room}"',
  bannerUnjoined: "This room isn't in your room list yet",
  bannerJoin: "Add room",
  bannerDismiss: "Dismiss",
};

export const invite = { ja, en };
