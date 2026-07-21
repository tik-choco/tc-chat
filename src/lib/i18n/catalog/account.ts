// Account / onboarding / navigation strings (ProfilePanel, PeerProfileModal,
// UsernameGate, Sidebar, VrchatGuide). Author `ja`, then `en: typeof ja`. Reuse
// ../common for shared actions. Filled by the account conversion pass.
const ja = {
  // Shared across profile surfaces
  profileTitle: "プロフィール",
  displayName: "表示名",

  // ProfilePanel
  selectImageFile: "画像ファイルを選択してください",
  imageTooLarge: "画像は 5MB 以下にしてください",
  uploadFailed: "アップロードに失敗しました",
  displayNameRequired: "表示名を入力してください",
  uploadingImage: "画像のアップロード中です",
  unnamed: "（名前未設定）",
  changeImage: "画像を変更",
  chooseImage: "画像を選択",
  namePlaceholder: "名前",
  bio: "自己紹介",
  bioPlaceholder: "ひとことプロフィール",
  vrmNote: "🧑‍🚀 VR用アバター(VRM)が共有プロフィールに登録されています（tc-vrsns2 と共有）",
  profileHint:
    "アイコン画像は mistlib ストレージ（storage_add）にアップロードされ、CID として プロフィールに保存されます。プロフィールは DID で署名された同じ ID として tik-choco の他アプリ（mistl など）と共有できます。",

  // PeerProfileModal
  participant: "参加者",
  selfSuffix: "（あなた）",
  verifiedDidTitle: "署名検証済みの DID",
  noBio: "自己紹介はまだありません",

  // UsernameGate
  gateTagline: "P2P チャット・掲示板・ボイス・画面共有",
  nicknamePlaceholder: "ニックネームを入力",
  getStarted: "はじめる",
  gateFooter: "分散型・DID 署名付き・端末内保存",

  // Sidebar
  roomIdInvalid: "ルームIDは英数字・-・_ のみ、1〜64文字で入力してください",
  settings: "設定",
  openSettings: "設定を開く",
  switchToDark: "ダークモードに切替",
  switchToLight: "ライトモードに切替",
  toggleTheme: "テーマを切り替え",
  editProfile: "プロフィールを編集",
  guest: "ゲスト",
  rooms: "ルーム",
  joinRoom: "ルームに参加",
  roomIdTooltip: "ルームID: {id}",
  copyRoomId: "ルームIDをコピー",
  leaveRoom: "ルームを離れる",
  roomIdPlaceholder: "ルームID (共有キー)",
  generateRoomId: "ランダムなIDを生成",
  roomNamePlaceholder: "表示名 (任意)",
  join: "参加",
  viewPeerProfile: "{name} のプロフィールを表示",

  // RoomNamePanel
  roomNicknameEdit: "このルームでの自分の表示名を変更",
  roomNicknameTitle: "このルームでの表示名",
  roomNicknamePlaceholder: "{name}（プロフィールの表示名）",
  roomNicknameHint:
    "このルームで送信するメッセージ・投稿にこの名前が使われ、ルームの参加者に共有されます。空欄にするとプロフィールの表示名に戻ります。",

  // RoomIdentityPanel — the room's SHARED name/icon (everyone sees the same
  // one), as opposed to RoomNamePanel's per-person nickname override above.
  editRoomIdentity: "ルームの名前とアイコンを編集",
  roomIdentityTitle: "ルームの名前とアイコン",
  roomIdentityNameLabel: "ルーム名（全員に共有）",
  roomIdentityHint:
    "ここで設定した名前とアイコンは、このルームの全員に共有されます。名前を空欄にすると、各自がローカルで付けた名前に戻ります。",

  // VrchatGuide — sentence fragments keep the surrounding <strong>/<code>
  // markup; spaces at the fragment edges are part of the rendered text.
  vrchatGuideTitle: "VRChat で画面共有を見る",
  vrchatIntroLead: "この部屋の画面共有を、視聴側 PC の ",
  vrchatIntroTail: " が RTSP に中継し、 VRChat の動画プレイヤー（AVPro）で再生できます。",
  vrchatStep1Title: "1. この部屋で画面共有を開始",
  vrchatSharingLive: "● 共有中です",
  vrchatStep1Hint: "上の「画面共有」ボタンから開始してください。",
  vrchatStep2Title: "2. 視聴側の PC で mistl を実行",
  vrchatStep2Body: "同じ部屋 ID を指定して中継を起動します。",
  vrchatStep3Title: "3. VRChat の動画プレイヤーに貼り付け",
  vrchatStep3Body: "AVPro プレイヤーの URL 欄にこの RTSP を入力します。",
  vrchatHintLabel: "ヒント：",
  vrchatHintBody:
    "mistl は「その部屋で最初に映像を出したピア」を中継します。 確実に自分の画面を映すには、共有ごとに専用の部屋 ID を使うのが安全です。",
  vrchatLanNote1: "LAN 越し（別 PC の VRChat）で見る場合は、mistl 側の",
  vrchatLanNote2: " のホストを ",
  vrchatLanNote3: " にすると、 表示された ",
  vrchatLanNote4: " を使えます。",
};

const en: typeof ja = {
  // Shared across profile surfaces
  profileTitle: "Profile",
  displayName: "Display name",

  // ProfilePanel
  selectImageFile: "Please choose an image file",
  imageTooLarge: "Images must be 5MB or smaller",
  uploadFailed: "Upload failed",
  displayNameRequired: "Please enter a display name",
  uploadingImage: "Image is still uploading",
  unnamed: "(No name set)",
  changeImage: "Change image",
  chooseImage: "Choose image",
  namePlaceholder: "Name",
  bio: "Bio",
  bioPlaceholder: "A short bio",
  vrmNote: "🧑‍🚀 A VR avatar (VRM) is registered on your shared profile (shared with tc-vrsns2)",
  profileHint:
    "Your icon image is uploaded to mistlib storage (storage_add) and saved on your profile as a CID. Your profile is signed with your DID, so the same identity can be shared with other tik-choco apps (such as mistl).",

  // PeerProfileModal
  participant: "Participant",
  selfSuffix: " (You)",
  verifiedDidTitle: "Signature-verified DID",
  noBio: "No bio yet",

  // UsernameGate
  gateTagline: "P2P chat, boards, voice & screen sharing",
  nicknamePlaceholder: "Enter a nickname",
  getStarted: "Get started",
  gateFooter: "Decentralized · DID-signed · stored on your device",

  // Sidebar
  roomIdInvalid: "Room IDs may only use letters, numbers, - and _, and must be 1–64 characters",
  settings: "Settings",
  openSettings: "Open settings",
  switchToDark: "Switch to dark mode",
  switchToLight: "Switch to light mode",
  toggleTheme: "Toggle theme",
  editProfile: "Edit profile",
  guest: "Guest",
  rooms: "Rooms",
  joinRoom: "Join a room",
  roomIdTooltip: "Room ID: {id}",
  copyRoomId: "Copy room ID",
  leaveRoom: "Leave room",
  roomIdPlaceholder: "Room ID (shared key)",
  generateRoomId: "Generate a random ID",
  roomNamePlaceholder: "Display name (optional)",
  join: "Join",
  viewPeerProfile: "View {name}'s profile",

  // RoomNamePanel
  roomNicknameEdit: "Change your display name in this room",
  roomNicknameTitle: "Your name in this room",
  roomNicknamePlaceholder: "{name} (profile display name)",
  roomNicknameHint:
    "This name is used for messages and posts you send in this room and is shared with its members. Leave it empty to fall back to your profile display name.",

  // RoomIdentityPanel
  editRoomIdentity: "Edit room name & icon",
  roomIdentityTitle: "Room name & icon",
  roomIdentityNameLabel: "Room name (shared with everyone)",
  roomIdentityHint:
    "The name and icon you set here are broadcast to everyone in this room. Leave the name blank to fall back to each person's own local label.",

  // VrchatGuide
  vrchatGuideTitle: "Watch screen shares in VRChat",
  vrchatIntroLead: "This room's screen share is relayed to RTSP by ",
  vrchatIntroTail: " on the viewing PC, so it can play in VRChat's video player (AVPro).",
  vrchatStep1Title: "1. Start a screen share in this room",
  vrchatSharingLive: "● Sharing now",
  vrchatStep1Hint: "Use the Screen Share button above to start.",
  vrchatStep2Title: "2. Run mistl on the viewing PC",
  vrchatStep2Body: "Start the relay with the same room ID.",
  vrchatStep3Title: "3. Paste into VRChat's video player",
  vrchatStep3Body: "Enter this RTSP URL in the AVPro player's URL field.",
  vrchatHintLabel: "Tip:",
  vrchatHintBody:
    "mistl relays the first peer that publishes video in the room. To make sure your screen is the one shown, use a dedicated room ID for each share.",
  vrchatLanNote1: "To watch over the LAN (VRChat on another PC), set the host in mistl's ",
  vrchatLanNote2: " to ",
  vrchatLanNote3: ", then use the displayed ",
  vrchatLanNote4: ".",
};

export const account = { ja, en };
