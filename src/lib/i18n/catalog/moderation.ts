// Peer mute/block strings — the mute button + notice in PeerProfileModal, and
// the muted-people list in SettingsPanel. Muting is local-only and global
// (not per-room): see muteStore.ts. Author `ja`, then `en: typeof ja`.
const ja = {
  muteAction: "ミュート",
  unmuteAction: "ミュート解除",
  mutedBadge: "ミュート中",
  mutedNotice: "この相手をミュートしています。新しい投稿や通知は届きません。",
  settingsTitle: "ミュートしたユーザー",
  settingsDesc:
    "ミュートすると、新しい投稿やリアクションを受信しなくなり、既存の投稿も非表示になります。解除するといつでも元に戻ります。",
  settingsEmpty: "ミュートしているユーザーはいません",
  settingsCount: "{count}人をミュート中",
  confirmTitle: "ミュートしますか？",
  confirmBody: "「{name}」をミュートします。新しい投稿を受信しなくなり、既存の投稿も非表示になります。",
  confirmMute: "ミュートする",
};

const en: typeof ja = {
  muteAction: "Mute",
  unmuteAction: "Unmute",
  mutedBadge: "Muted",
  mutedNotice: "You've muted this person. Their new posts and notifications won't reach you.",
  settingsTitle: "Muted people",
  settingsDesc:
    "Muting stops their new posts and reactions from reaching you and hides their existing posts. Unmuting brings everything back at any time.",
  settingsEmpty: "You haven't muted anyone",
  settingsCount: "{count} muted",
  confirmTitle: "Mute this person?",
  confirmBody: 'This mutes "{name}". You\'ll stop receiving their new posts, and their existing posts will be hidden.',
  confirmMute: "Mute",
};

export const moderation = { ja, en };
