// First-run onboarding wizard strings (components/Onboarding.tsx). Author `ja`,
// then `en: typeof ja`. Reuse ../common for shared actions (close, etc.).
const ja = {
  dialogLabel: "はじめてのご利用ガイド",

  // Step 0 — welcome
  step0Title: "TC Chat へようこそ！",
  step0Text1:
    "TC Chat は、招待なしですぐに使える P2P チャットアプリです。テキストチャット・掲示板・ボイス通話・画面共有を、ひとつのルームの中で楽しめます。",
  step0Text2: "アカウント登録は不要です。表示名を決めるだけで、この端末からすぐに会話をはじめられます。",

  // Step 1 — rooms + the global-room caution
  step1Title: "ルームについて",
  step1Text:
    "会話は「ルーム」という単位で行います。ルームIDを共有した相手同士だけで集まる、プライベートなルームを自由に作成・参加できます。",
  warningTitle: "グローバルルームは全員に公開されています",
  warningBody:
    "はじめから参加しているグローバルルームは、誰でも参加できる公開スペースです。送信したメッセージやファイルは参加者全員に見えるため、個人情報や見られたくない内容は送信しないでください。",
  privateRoomsHint:
    "特定の相手とだけ話したいときは、サイドバーの「＋」からルームIDを決めて作成し、そのIDを知っている人だけを誘ってください。",

  // Step 2 — feature tour
  step2Title: "できること",
  featureChatTitle: "チャット",
  featureChatBody: "テキストメッセージ、画像・ファイルの送信、リアクションでのやりとり",
  featureBoardTitle: "掲示板",
  featureBoardBody: "スレッド形式の投稿。募集やお知らせ、雑談トピックをまとめて共有",
  featureVoiceTitle: "ボイス通話",
  featureVoiceBody: "ルームに参加したまま、そのままボイスチャットに合流",
  featureScreenTitle: "画面共有",
  featureScreenBody: "自分の画面を配信。VRChat の動画プレイヤーで視聴することもできます",

  // Step 3 — done
  step3Title: "準備完了です！",
  step3Text: "プロフィール（アイコン・自己紹介）は、サイドバーの自分の名前をタップすると編集できます。",
  step3Subtle: "この案内は設定画面からいつでも見返せます。それでは、楽しんでください！",

  // Footer nav
  back: "戻る",
  next: "次へ",
  finish: "はじめる",
};

const en: typeof ja = {
  dialogLabel: "Getting started guide",

  step0Title: "Welcome to TC Chat!",
  step0Text1:
    "TC Chat is a P2P chat app you can start using right away, no invitation needed. Text chat, a board, voice calls and screen sharing all live inside a single room.",
  step0Text2:
    "No account required — just pick a display name and you can start chatting from this device right away.",

  step1Title: "About rooms",
  step1Text:
    "Conversations happen inside \"rooms.\" You can freely create or join private rooms where only the people you share the room ID with can gather.",
  warningTitle: "The global room is visible to everyone",
  warningBody:
    "The global room you're in from the start is an open space anyone can join. Anything you send there — messages or files — is visible to every participant, so avoid sharing personal information or anything you'd rather keep private.",
  privateRoomsHint:
    "To talk with only specific people, use the \"+\" in the sidebar to pick a room ID and create a room, then invite only the people who know that ID.",

  step2Title: "What you can do",
  featureChatTitle: "Chat",
  featureChatBody: "Text messages, image/file sharing, and reactions",
  featureBoardTitle: "Board",
  featureBoardBody: "Threaded posts — share recruitment calls, announcements, or casual topics",
  featureVoiceTitle: "Voice calls",
  featureVoiceBody: "Join a voice chat without leaving the room",
  featureScreenTitle: "Screen sharing",
  featureScreenBody: "Broadcast your screen — can even be watched from VRChat's video player",

  step3Title: "You're all set!",
  step3Text: "You can edit your profile (icon, bio) by tapping your name in the sidebar.",
  step3Subtle: "You can revisit this guide any time from Settings. Enjoy!",

  back: "Back",
  next: "Next",
  finish: "Get started",
};

export const onboarding = { ja, en };
