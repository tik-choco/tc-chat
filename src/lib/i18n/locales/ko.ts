import type { Messages } from "../messages";

// 한국어 — full translation of the Japanese source strings.
export const ko: Messages = {
  common: {
    cancel: "취소",
    save: "저장",
    delete: "삭제",
    deleteConfirm: "삭제하기",
    close: "닫기",
    closeMenu: "메뉴 닫기",
    send: "보내기",
    edit: "편집",
    copy: "복사",
    copied: "복사했어요",
    loading: "불러오는 중…",
    globalRoom: "글로벌",
    verified: "인증됨",
    you: "나",
    edited: "(수정됨)",
    irreversible: "이 작업은 되돌릴 수 없습니다.",
    retry: "다시 시도",
    mediaUnavailable: "콘텐츠를 사용할 수 없어요 (작성자가 오프라인일 수 있어요)",
  },

  settings: {
    title: "설정",
    language: "언어",
    chatDisplay: "채팅 표시 방식",
    displayListLabel: "리스트",
    displayListDesc: "아이콘, 이름, 내용을 한 줄로 표시해요 (피드 스타일)",
    displayBubbleLabel: "말풍선",
    displayBubbleDesc: "좌우로 나뉘는 말풍선 형태로 표시해요",
    developer: "개발자",
    developerModeLabel: "개발자 모드",
    developerModeDesc: "화면 하단에 상세한 디버그 로그를 실시간으로 표시해요",
    help: "도움말",
    viewGuide: "사용 가이드 보기",
    notifications: "알림",
    notifLabel: "데스크톱 알림",
    notifDesc: "나에게 온 다이렉트 메시지를 알려드려요",
    notifGranted: "알림이 켜져 있어요",
    notifDenied: "브라우저 설정에서 알림이 차단되어 있어요",
    notifUnsupported: "이 브라우저는 알림을 지원하지 않아요",
    mediaCaution: "방송 전 안내",
    mediaCautionLabel: "방송 전 안내 화면 표시",
    mediaCautionDesc: "카메라나 화면 공유를 시작하기 전에 확인 화면을 표시해요",
    giphyApiKey: "GIPHY API 키",
    giphyApiKeyDesc: "채팅의 GIF 검색에 사용돼요 (보내는 사람만 설정하면 돼요)",
    giphyApiKeyPlaceholder: "GIPHY API 키를 붙여넣으세요",
    giphyApiKeySaved: "저장했어요",
  },

  chat: {
    // MessageBubble (media body)
    mediaLoadFailed: "파일을 불러오지 못했어요",
    fullscreen: "전체 화면으로 보기",
    viewFullscreen: "{name} 전체 화면으로 보기",
    file: "파일",
    // MessageBubble (message row)
    messageDeleted: "삭제된 메시지입니다",
    deleteHint: "삭제 (Shift+클릭 시 확인 없이 삭제)",
    deleteMessageTitle: "메시지 삭제",
    deleteMessageConfirm: "이 메시지를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.",
    viewProfile: "{name}님의 프로필 보기",
    verifiedAs: "인증됨: {did}",
    // MessageInput
    attachFile: "파일 첨부",
    pickFromStorage: "tc-storage에서 선택",
    pickGif: "GIF 보내기",
    joinRoomPlaceholder: "채팅을 시작하려면 방에 참가하세요",
    messagePlaceholder: "메시지를 입력하세요",
    recordVoice: "음성 메시지 녹음",
    voiceRecording: "녹음 중…",
    voiceStopRecording: "녹음 중지",
    voiceCancelRecording: "녹음 취소",
    voiceMicDenied: "마이크에 접근할 수 없어요. 브라우저 설정에서 마이크 사용을 허용해주세요.",
    // GifPicker
    gifPickerTitle: "GIF 선택",
    gifSearchPlaceholder: "GIPHY에서 GIF 검색",
    gifLoading: "불러오는 중…",
    gifLoadFailed: "GIF를 불러오지 못했어요",
    gifNoResults: "GIF를 찾을 수 없어요",
    gifTrending: "인기 GIF",
    gifSetupTitle: "GIPHY API 키가 설정되지 않았어요",
    gifSetupBody: "GIF 검색에는 무료 GIPHY API 키가 필요해요. 아래 가이드를 따라 키를 발급받고 붙여넣어 주세요.",
    gifSetupLink: "GIPHY API 키 발급 방법",
    gifApiKeyPlaceholder: "GIPHY API 키를 붙여넣으세요",
    gifSaveKey: "저장",
    gifAttribution: "Powered by GIPHY",
    // ChatWindow
    noMessages: "아직 메시지가 없어요",
    globalRoomBadge: "공개",
    globalRoomWarning: "글로벌 방은 누구나 참가할 수 있는 공개 공간이에요. 보낸 내용은 모든 참가자에게 보여요.",
    typingIndicator: "{names}님이 입력 중이에요…",
    // ReactionBar
    addReaction: "리액션 추가",
    nameSeparator: ", ",
    // RoomContent
    openMenu: "메뉴 열기",
    chatTab: "채팅",
    boardTab: "게시판",
    calendarTab: "캘린더",
    galleryTab: "갤러리",
    dmNotifBody: "새 메시지가 도착했어요",
  },

  board: {
    // Post kinds / filters
    filterAll: "전체",
    recruit: "모집",
    topic: "토론",

    // Board chrome (ProjectBoard)
    subtitle: "스레드는 얼마든지 깊게 이어갈 수 있어요",
    newPost: "새 글쓰기",
    emptyAll: "아직 게시글이 없어요",
    emptyFiltered: "이 종류의 게시글이 아직 없어요",
    firstPost: "첫 게시글 작성하기",

    // Node view (BoardNodeView)
    reply: "답글",
    replies: "답글 {count}개",
    showReplies: "답글 {count}개 보기",
    postDeleted: "삭제된 게시글입니다",
    verifiedTooltip: "인증됨: {did}",
    deleteHint: "삭제 (Shift+클릭 시 확인 없이 삭제)",
    deletePostTitle: "게시글 삭제",
    deletePostMessage: "이 게시글을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.",
    titlePlaceholder: "제목",

    // Thumbnail image (composer + node view)
    thumbAdd: "썸네일 이미지 추가",
    thumbChange: "썸네일 변경",
    thumbRemove: "썸네일 삭제",
    thumbAlt: "썸네일 이미지",
    thumbError: "이미지를 불러오지 못했어요",

    // Composer (NodeComposer)
    titleOptionalPlaceholder: "제목 (선택)",
    recruitTitlePlaceholder: "모집 제목",
    replyPlaceholder: "답글을 입력하세요…",
    recruitBodyPlaceholder: "모집 개요와 상세 내용을 입력하세요",
    bodyPlaceholder: "내용을 입력하세요…",
    rolesPlaceholder: "모집 역할 (쉼표로 구분)",
    tagsPlaceholder: "태그 (쉼표로 구분)",
    errBody: "내용을 입력해주세요",
    errRecruitBody: "모집 내용을 입력해주세요",
    errRecruitTitle: "모집 제목을 입력해주세요",
    submitPost: "게시하기",
    submitRecruit: "모집 게시하기",

    // --- note-article import chip (tc-note handoff via the shared bus) ---
    importArticleChip: "tc-note 기사 가져오기: {title}",
    importArticleDismiss: "무시하기",
    // --- end note-article import chip ---

    // --- recruit join / capacity ---
    joinWish: "참가 희망",
    joinCount: "참가 희망 {count}명",
    joinCountCap: "참가 희망 {count}/{capacity}명",
    capacityPlaceholder: "모집 인원 (선택)",
    backToList: "목록으로 돌아가기",
    // --- end recruit join / capacity ---
  },

  media: {
    // MediaGalleryView
    galleryEmpty: "아직 사진이나 동영상이 없어요",
    galleryEmptyHint: "첫 번째 미디어를 공유해보세요",
    galleryUpload: "업로드",
    galleryAddFromStorage: "tc-storage에서 추가",
    galleryDeleteConfirm: "이 미디어를 삭제하시겠습니까?",
    gallerySharedBy: "{name}님이 공유함",
    galleryStoredFileFailed: "tc-storage 파일을 복호화할 수 없습니다 (이 브라우저에 공유 키가 없습니다)",
    // Lightbox
    image: "이미지",
    video: "동영상",
    preview: "미리보기",
    counter: "{current} / {total}",
    displayMode: "보기 모드",
    singleMode: "한 장씩",
    flowMode: "연속 보기",
    download: "다운로드",
    closeEsc: "닫기 (Esc)",
    prev: "이전",
    next: "다음",
    // VoicePanel
    participantFallback: "참가자",
    viewProfile: "{name}님의 프로필 보기",
    inCall: "통화 참가 중",
    participantCount: "{count}명",
    joinVoice: "음성 채팅 참가",
    joinCall: "통화 참가",
    joinCallCount: "통화 참가 ({count}명)",
    unmute: "음소거 해제",
    mute: "음소거",
    leave: "나가기",
    // ScreenShareView
    shareScreen: "화면 공유",
    stopSharing: "공유 중지",
    vrchatGuide: "VRChat에서 보는 방법",
    startShareFailed: "화면 공유를 시작하지 못했어요",
    noAudioCaptured: "오디오 없이 공유 중 - 선택 창에서 \"오디오 공유\"를 체크하면 소리도 함께 전달돼요",
    // RemoteScreenStage
    maximizeShare: "화면 공유 전체 화면으로 보기",
    fullscreen: "전체 화면으로 보기",
    screenShareFile: "화면 공유 {name}",
    // StoragePicker
    storagePickerTitle: "tc-storage에서 선택",
    storagePickerEmpty: "tc-storage에 첨부할 수 있는 파일이 없어요",
    // VideoCallPanel / VideoCallStage
    startVideoCall: "화상 통화",
    stopCamera: "카메라 끄기",
    startCameraFailed: "카메라를 시작하지 못했어요",
    // MediaCautionDialog
    cautionTitle: "방송 전 확인",
    cautionBodyCamera: "카메라 화면이 지금 이 방에 있는 모든 사람에게 방송돼요.",
    cautionBodyScreen: "화면 내용이 지금 이 방에 있는 모든 사람에게 방송돼요.",
    cautionDontShowAgain: "다시 보지 않기",
    cautionContinue: "계속",
    cautionCancel: "취소",
  },

  account: {
    // Shared across profile surfaces
    profileTitle: "프로필",
    displayName: "표시 이름",

    // ProfilePanel
    selectImageFile: "이미지 파일을 선택해주세요",
    imageTooLarge: "이미지는 5MB 이하로 선택해주세요",
    uploadFailed: "업로드에 실패했어요",
    displayNameRequired: "표시 이름을 입력해주세요",
    uploadingImage: "이미지를 업로드하는 중이에요",
    unnamed: "(이름 미설정)",
    changeImage: "이미지 변경",
    chooseImage: "이미지 선택",
    namePlaceholder: "이름",
    bio: "자기소개",
    bioPlaceholder: "한 줄 자기소개",
    vrmNote: "🧑‍🚀 VR 아바타(VRM)가 공유 프로필에 등록되어 있어요 (tc-vrsns2와 공유)",
    profileHint:
      "프로필 이미지는 mistlib 스토리지(storage_add)에 업로드되어 CID로 프로필에 저장됩니다. 프로필은 DID로 서명된 동일한 ID이므로 tik-choco의 다른 앱(mistl 등)과 공유할 수 있습니다.",

    // PeerProfileModal
    participant: "참가자",
    selfSuffix: " (나)",
    verifiedDidTitle: "서명 검증된 DID",
    noBio: "아직 자기소개가 없어요",

    // UsernameGate
    gateTagline: "P2P 채팅 · 게시판 · 음성 · 화면 공유",
    nicknamePlaceholder: "닉네임을 입력하세요",
    getStarted: "시작하기",
    gateFooter: "탈중앙화 · DID 서명 · 기기 내 저장",

    // Sidebar
    roomIdInvalid: "방 ID는 영문, 숫자, -, _ 만 사용할 수 있으며 1~64자로 입력해주세요",
    settings: "설정",
    openSettings: "설정 열기",
    switchToDark: "다크 모드로 전환",
    switchToLight: "라이트 모드로 전환",
    toggleTheme: "테마 전환",
    editProfile: "프로필 편집",
    guest: "게스트",
    rooms: "방",
    joinRoom: "방 참가",
    roomIdTooltip: "방 ID: {id}",
    copyRoomId: "방 ID 복사",
    leaveRoom: "방 나가기",
    roomIdPlaceholder: "방 ID (공유 키)",
    roomNamePlaceholder: "표시 이름 (선택)",
    generateRoomId: "무작위 ID 생성",
    join: "참가",
    online: "온라인 ({count})",
    noOtherPeers: "아직 다른 참가자가 없어요",
    viewPeerProfile: "{name}님의 프로필 보기",

    // RoomNamePanel
    roomNicknameEdit: "이 룸에서의 표시 이름 변경",
    roomNicknameTitle: "이 룸에서의 이름",
    roomNicknamePlaceholder: "{name} (프로필 표시 이름)",
    roomNicknameHint:
      "이 룸에서 보내는 메시지와 게시물에 이 이름이 사용되며 룸 참가자에게 공유됩니다. 비워 두면 프로필 표시 이름을 사용합니다.",

    // VrchatGuide — sentence fragments keep the surrounding <strong>/<code>
    // markup; spaces at the fragment edges are part of the rendered text.
    vrchatGuideTitle: "VRChat에서 화면 공유 보기",
    vrchatIntroLead: "이 방의 화면 공유는 시청 측 PC에서 실행되는 ",
    vrchatIntroTail: "이(가) RTSP로 중계하므로, VRChat의 동영상 플레이어(AVPro)에서 재생할 수 있어요.",
    vrchatStep1Title: "1. 이 방에서 화면 공유 시작",
    vrchatSharingLive: "● 공유 중이에요",
    vrchatStep1Hint: "위의 '화면 공유' 버튼으로 시작하세요.",
    vrchatStep2Title: "2. 시청 측 PC에서 mistl 실행",
    vrchatStep2Body: "같은 방 ID를 지정해서 중계를 시작하세요.",
    vrchatStep3Title: "3. VRChat의 동영상 플레이어에 붙여넣기",
    vrchatStep3Body: "AVPro 플레이어의 URL 입력란에 이 RTSP 주소를 입력하세요.",
    vrchatHintLabel: "팁:",
    vrchatHintBody:
      "mistl은 '그 방에서 가장 먼저 영상을 송출한 피어'를 중계해요. 확실히 내 화면이 나오게 하려면 공유마다 전용 방 ID를 사용하는 게 안전해요.",
    vrchatLanNote1: "LAN을 통해 (다른 PC의 VRChat에서) 보려면 mistl의 ",
    vrchatLanNote2: " 설정을 ",
    vrchatLanNote3: "(으)로 바꾸면 화면에 표시된 ",
    vrchatLanNote4: "을(를) 사용할 수 있어요.",
  },

  devConsole: {
    title: "개발자 콘솔",
    searchPlaceholder: "로그 검색",
    clear: "지우기",
    copyAll: "전체 복사",
    empty: "아직 로그가 없어요",
    newLogs: "새 로그",
    collapse: "접기",
    expand: "펼치기",
  },

  onboarding: {
    dialogLabel: "시작 가이드",

    step0Title: "TC Chat에 오신 것을 환영해요!",
    step0Text1:
      "TC Chat은 초대 없이 바로 사용할 수 있는 P2P 채팅 앱이에요. 텍스트 채팅, 게시판, 음성 통화, 화면 공유를 하나의 방 안에서 모두 즐길 수 있어요.",
    step0Text2: "계정 등록이 필요 없어요. 표시 이름만 정하면 이 기기에서 바로 대화를 시작할 수 있어요.",

    step1Title: "방에 대하여",
    step1Text: "대화는 '방' 단위로 이루어져요. 방 ID를 공유한 사람들끼리만 모이는 비공개 방을 자유롭게 만들고 참가할 수 있어요.",
    warningTitle: "글로벌 방은 모두에게 공개돼요",
    warningBody:
      "처음부터 참가되어 있는 글로벌 방은 누구나 참가할 수 있는 공개 공간이에요. 보낸 메시지나 파일은 모든 참가자에게 보이니, 개인정보나 남에게 보이고 싶지 않은 내용은 보내지 마세요.",
    privateRoomsHint: "특정 상대와만 이야기하고 싶다면, 사이드바의 '+'에서 방 ID를 정해 방을 만들고, 그 ID를 아는 사람만 초대하세요.",

    step2Title: "할 수 있는 것",
    featureChatTitle: "채팅",
    featureChatBody: "텍스트 메시지, 이미지·파일 전송, 리액션으로 소통",
    featureBoardTitle: "게시판",
    featureBoardBody: "스레드 형태의 게시글 - 모집, 공지, 잡담 주제를 모아서 공유",
    featureVoiceTitle: "음성 통화",
    featureVoiceBody: "방에 참가한 채로 그대로 음성 채팅에 합류",
    featureScreenTitle: "화면 공유",
    featureScreenBody: "내 화면을 송출 - VRChat의 동영상 플레이어로도 시청할 수 있어요",

    step3Title: "준비가 끝났어요!",
    step3Text: "사이드바에서 내 이름을 탭하면 프로필(아이콘, 자기소개)을 편집할 수 있어요.",
    step3Subtle: "이 안내는 설정 화면에서 언제든 다시 볼 수 있어요. 즐거운 시간 되세요!",

    back: "이전",
    next: "다음",
    finish: "시작하기",
  },

  friends: {
    title: "친구",
    empty: "아직 친구가 없어요",
    addFriend: "친구 추가",
    added: "추가됨",
    remove: "친구 해제",
    sendRequest: "친구 요청 보내기",
    requestSent: "요청 전송됨",
    cancelRequest: "요청 취소",
    requestsTitle: "친구 요청",
    incomingLabel: "받은 요청",
    outgoingLabel: "보낸 요청",
    accept: "수락",
    decline: "거절",
    online: "온라인",
  },

  calendar: {
    newEvent: "새 일정",
    titlePlaceholder: "일정 제목",
    startsAtLabel: "시작 일시",
    endsAtLabel: "종료 일시 (선택)",
    locationPlaceholder: "장소 (선택)",
    descriptionPlaceholder: "설명 (선택)",
    today: "오늘",
    noEvents: "아직 일정이 없어요",
    showPast: "지난 일정 보기",
    hidePast: "지난 일정 숨기기",
    deleteEventTitle: "일정 삭제",
    deleteEventMessage: "이 일정을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.",
    errTitle: "제목을 입력해주세요",
    errStartsAt: "시작 일시를 선택해주세요",
    personalCalendarTitle: "개인 캘린더",
    personalCalendarSubtitle: "이 기기에만 저장되며, 다른 사람에게는 보이지 않아요.",
    roomCalendarSubtitle: "이 방에 참가한 모든 사람에게 보이는 일정표예요.",
  },
};
