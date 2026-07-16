import type { Messages } from "../messages";

// Français — full translation (informal "tu" register, matching the tone of
// chat apps like WhatsApp/Discord in French).
export const fr: Messages = {
  common: {
    cancel: "Annuler",
    save: "Enregistrer",
    delete: "Supprimer",
    deleteConfirm: "Supprimer",
    close: "Fermer",
    closeMenu: "Fermer le menu",
    send: "Envoyer",
    edit: "Modifier",
    copy: "Copier",
    copied: "Copié",
    loading: "Chargement…",
    globalRoom: "Global",
    verified: "Vérifié",
    you: "Toi",
    edited: "(modifié)",
    irreversible: "Cette action est irréversible.",
  },

  settings: {
    title: "Paramètres",
    language: "Langue",
    chatDisplay: "Affichage du chat",
    displayListLabel: "Liste",
    displayListDesc: "Icône, nom et texte sur une seule ligne (façon fil d'actualité)",
    displayBubbleLabel: "Bulles",
    displayBubbleDesc: "Affichage en bulles de chat réparties à gauche et à droite",
    developer: "Développeur",
    developerModeLabel: "Mode développeur",
    developerModeDesc: "Affiche des journaux de débogage détaillés en temps réel en bas de l'écran",
    help: "Aide",
    viewGuide: "Voir le guide de démarrage",
    notifications: "Notifications",
    notifLabel: "Notifications de bureau",
    notifDesc: "Prévient quand un message direct arrive pour toi",
    notifGranted: "Les notifications sont activées",
    notifDenied: "Les notifications sont bloquées dans les réglages du navigateur",
    notifUnsupported: "Ce navigateur ne prend pas en charge les notifications",
    mediaCaution: "Avant de diffuser",
    mediaCautionLabel: "Afficher un avertissement avant de diffuser",
    mediaCautionDesc: "Affiche un écran de confirmation avant de démarrer la caméra ou le partage d'écran",
    giphyApiKey: "Clé API GIPHY",
    giphyApiKeyDesc: "Utilisée pour la recherche de GIF dans le chat (seul l'expéditeur doit la configurer)",
    giphyApiKeyPlaceholder: "Colle ta clé API GIPHY",
    giphyApiKeySaved: "Enregistré",
  },

  chat: {
    // MessageBubble (media body)
    mediaLoadFailed: "Impossible de charger ce fichier",
    fullscreen: "Afficher en plein écran",
    viewFullscreen: "Afficher {name} en plein écran",
    file: "Fichier",
    // MessageBubble (message row)
    messageDeleted: "Ce message a été supprimé",
    deleteHint: "Supprimer (Maj+clic pour ignorer la confirmation)",
    deleteMessageTitle: "Supprimer le message",
    deleteMessageConfirm: "Supprimer ce message ? Cette action est irréversible.",
    viewProfile: "Voir le profil de {name}",
    verifiedAs: "Vérifié : {did}",
    // MessageInput
    attachFile: "Joindre un fichier",
    pickFromStorage: "Choisir depuis tc-storage",
    pickGif: "Envoyer un GIF",
    joinRoomPlaceholder: "Rejoins un salon pour commencer à discuter",
    messagePlaceholder: "Écris un message",
    recordVoice: "Enregistrer un message vocal",
    voiceRecording: "Enregistrement…",
    voiceStopRecording: "Arrêter l'enregistrement",
    voiceCancelRecording: "Annuler l'enregistrement",
    voiceMicDenied:
      "Impossible d'accéder au microphone. Autorise l'accès au microphone dans les paramètres de ton navigateur.",
    // GifPicker
    gifPickerTitle: "Choisir un GIF",
    gifSearchPlaceholder: "Rechercher des GIF sur GIPHY",
    gifLoading: "Chargement…",
    gifLoadFailed: "Impossible de charger les GIF",
    gifNoResults: "Aucun GIF trouvé",
    gifTrending: "GIF tendances",
    gifSetupTitle: "Aucune clé API GIPHY configurée",
    gifSetupBody:
      "La recherche de GIF nécessite une clé API GIPHY gratuite. Suis le guide ci-dessous pour en obtenir une, puis colle-la ici.",
    gifSetupLink: "Comment obtenir une clé API GIPHY",
    gifApiKeyPlaceholder: "Colle ta clé API GIPHY",
    gifSaveKey: "Enregistrer",
    gifAttribution: "Propulsé par GIPHY",
    // ChatWindow
    noMessages: "Aucun message pour le moment",
    globalRoomBadge: "Public",
    globalRoomWarning:
      "Le salon global est un espace ouvert que tout le monde peut rejoindre. Tout ce que tu y envoies est visible par tous les participants.",
    typingIndicator: "{names} est en train d'écrire…",
    // ReactionBar
    addReaction: "Ajouter une réaction",
    nameSeparator: ", ",
    // RoomContent
    openMenu: "Ouvrir le menu",
    chatTab: "Chat",
    boardTab: "Forum",
    calendarTab: "Calendrier",
    galleryTab: "Galerie",
    dmNotifBody: "Tu as un nouveau message",
  },

  board: {
    // Post kinds / filters
    filterAll: "Tous",
    recruit: "Recrutement",
    topic: "Discussion",

    // Board chrome (ProjectBoard)
    subtitle: "Les fils de discussion peuvent s'imbriquer autant que tu veux",
    newPost: "Nouvelle publication",
    emptyAll: "Aucune publication pour le moment",
    emptyFiltered: "Aucune publication de ce type pour le moment",
    firstPost: "Écrire la première publication",

    // Node view (BoardNodeView)
    reply: "Répondre",
    replies: "{count} réponses",
    showReplies: "Afficher {count} réponses",
    postDeleted: "Cette publication a été supprimée",
    verifiedTooltip: "Vérifié : {did}",
    deleteHint: "Supprimer (Maj+clic pour ignorer la confirmation)",
    deletePostTitle: "Supprimer la publication",
    deletePostMessage: "Supprimer cette publication ? Cette action est irréversible.",
    titlePlaceholder: "Titre",

    // Thumbnail image (composer + node view)
    thumbAdd: "Ajouter une miniature",
    thumbChange: "Changer la miniature",
    thumbRemove: "Supprimer la miniature",
    thumbAlt: "Image miniature",
    thumbError: "Impossible de charger l'image",

    // Composer (NodeComposer)
    titleOptionalPlaceholder: "Titre (facultatif)",
    recruitTitlePlaceholder: "Titre de l'annonce",
    replyPlaceholder: "Écris une réponse…",
    recruitBodyPlaceholder: "Décris ce que tu recherches",
    bodyPlaceholder: "Écris quelque chose…",
    rolesPlaceholder: "Rôles recherchés (séparés par des virgules)",
    tagsPlaceholder: "Tags (séparés par des virgules)",
    errBody: "Merci de saisir du texte",
    errRecruitBody: "Merci de décrire ce que tu recherches",
    errRecruitTitle: "Merci de saisir un titre pour l'annonce",
    submitPost: "Publier",
    submitRecruit: "Publier l'annonce",

    // --- note-article import chip (tc-note handoff via the shared bus) ---
    importArticleChip: "Importer l'article tc-note : {title}",
    importArticleDismiss: "Ignorer",
    // --- end note-article import chip ---

    // --- recruit join / capacity ---
    joinWish: "Intéressé",
    joinCount: "{count} intéressés",
    joinCountCap: "Intéressés {count}/{capacity}",
    capacityPlaceholder: "Places (facultatif)",
    backToList: "Retour à la liste",
    // --- end recruit join / capacity ---
  },

  media: {
    // MediaGalleryView
    galleryEmpty: "Aucune photo ni vidéo pour le moment",
    galleryEmptyHint: "Partage la première",
    galleryUpload: "Envoyer",
    galleryAddFromStorage: "Ajouter depuis tc-storage",
    galleryDeleteConfirm: "Supprimer ce média ?",
    gallerySharedBy: "Partagé par {name}",
    galleryStoredFileFailed: "Impossible de déchiffrer le fichier tc-storage (ce navigateur n'a pas la clé de partage)",
    // Lightbox
    image: "Image",
    video: "Vidéo",
    preview: "Aperçu",
    counter: "{current} / {total}",
    displayMode: "Mode d'affichage",
    singleMode: "Individuel",
    flowMode: "Flux",
    download: "Télécharger",
    closeEsc: "Fermer (Esc)",
    prev: "Précédent",
    next: "Suivant",
    // VoicePanel
    participantFallback: "Participant",
    viewProfile: "Voir le profil de {name}",
    inCall: "En appel",
    participantCount: "{count} en appel",
    joinVoice: "Rejoindre le chat vocal",
    joinCall: "Rejoindre l'appel",
    joinCallCount: "Rejoindre l'appel ({count})",
    unmute: "Réactiver le micro",
    mute: "Couper le micro",
    leave: "Quitter",
    // ScreenShareView
    shareScreen: "Partager l'écran",
    stopSharing: "Arrêter le partage",
    vrchatGuide: "Comment regarder dans VRChat",
    startShareFailed: "Impossible de démarrer le partage d'écran",
    noAudioCaptured: "Partage sans audio - cochez \"Partager l'audio\" dans le sélecteur pour inclure le son",
    // RemoteScreenStage
    maximizeShare: "Afficher le partage d'écran en plein écran",
    fullscreen: "Afficher en plein écran",
    screenShareFile: "Partage d'écran {name}",
    // StoragePicker
    storagePickerTitle: "Choisir depuis tc-storage",
    storagePickerEmpty: "Aucun fichier à joindre dans tc-storage",
    // VideoCallPanel / VideoCallStage
    startVideoCall: "Appel vidéo",
    stopCamera: "Couper la caméra",
    startCameraFailed: "Impossible de démarrer la caméra",
    // MediaCautionDialog
    cautionTitle: "Avant de diffuser",
    cautionBodyCamera: "L'image de ta caméra sera diffusée à tout le monde actuellement dans ce salon.",
    cautionBodyScreen: "Le contenu de ton écran sera diffusé à tout le monde actuellement dans ce salon.",
    cautionDontShowAgain: "Ne plus afficher ce message",
    cautionContinue: "Continuer",
    cautionCancel: "Annuler",
  },

  account: {
    // Shared across profile surfaces
    profileTitle: "Profil",
    displayName: "Nom affiché",

    // ProfilePanel
    selectImageFile: "Merci de choisir un fichier image",
    imageTooLarge: "L'image ne doit pas dépasser 5MB",
    uploadFailed: "Échec de l'envoi",
    displayNameRequired: "Merci de saisir un nom affiché",
    uploadingImage: "L'image est en cours d'envoi",
    unnamed: "(Nom non défini)",
    changeImage: "Changer l'image",
    chooseImage: "Choisir une image",
    namePlaceholder: "Nom",
    bio: "Bio",
    bioPlaceholder: "Une courte bio",
    vrmNote:
      "🧑‍🚀 Un avatar VR (VRM) est enregistré sur ton profil partagé (partagé avec tc-vrsns2)",
    profileHint:
      "Ton image de profil est envoyée dans le stockage mistlib (storage_add) et enregistrée sur ton profil sous forme de CID. Ton profil est signé par ton DID, ce qui permet de partager la même identité avec d'autres applications tik-choco (comme mistl).",

    // PeerProfileModal
    participant: "Participant",
    selfSuffix: " (Toi)",
    verifiedDidTitle: "DID vérifié par signature",
    noBio: "Aucune bio pour le moment",

    // UsernameGate
    gateTagline: "Chat P2P, forums, voix et partage d'écran",
    nicknamePlaceholder: "Saisis un pseudo",
    getStarted: "Commencer",
    gateFooter: "Décentralisé · Signé par DID · Stocké sur ton appareil",

    // Sidebar
    roomIdInvalid:
      "L'ID du salon ne peut contenir que des lettres, des chiffres, - et _, et doit faire de 1 à 64 caractères",
    settings: "Paramètres",
    openSettings: "Ouvrir les paramètres",
    switchToDark: "Passer en mode sombre",
    switchToLight: "Passer en mode clair",
    toggleTheme: "Changer de thème",
    editProfile: "Modifier le profil",
    guest: "Invité",
    rooms: "Salons",
    joinRoom: "Rejoindre un salon",
    roomIdTooltip: "ID du salon : {id}",
    copyRoomId: "Copier l'ID du salon",
    leaveRoom: "Quitter le salon",
    roomIdPlaceholder: "ID du salon (clé partagée)",
    roomNamePlaceholder: "Nom affiché (facultatif)",
    generateRoomId: "Générer un ID aléatoire",
    join: "Rejoindre",
    online: "En ligne ({count})",
    noOtherPeers: "Il n'y a personne d'autre ici",
    viewPeerProfile: "Voir le profil de {name}",

    // RoomNamePanel
    roomNicknameEdit: "Modifier ton nom d'affichage dans ce salon",
    roomNicknameTitle: "Ton nom dans ce salon",
    roomNicknamePlaceholder: "{name} (nom du profil)",
    roomNicknameHint:
      "Ce nom est utilisé pour les messages et publications que tu envoies dans ce salon et est partagé avec ses membres. Laisse-le vide pour utiliser le nom de ton profil.",

    // VrchatGuide — sentence fragments keep the surrounding <strong>/<code>
    // markup; spaces at the fragment edges are part of the rendered text.
    vrchatGuideTitle: "Regarder les partages d'écran dans VRChat",
    vrchatIntroLead: "Le partage d'écran de ce salon est relayé vers RTSP par ",
    vrchatIntroTail:
      " sur le PC de visionnage, ce qui permet de le lire dans le lecteur vidéo de VRChat (AVPro).",
    vrchatStep1Title: "1. Démarre un partage d'écran dans ce salon",
    vrchatSharingLive: "● Partage en cours",
    vrchatStep1Hint: "Utilise le bouton « Partager l'écran » ci-dessus pour commencer.",
    vrchatStep2Title: "2. Lance mistl sur le PC de visionnage",
    vrchatStep2Body: "Démarre le relais avec le même ID de salon.",
    vrchatStep3Title: "3. Colle-le dans le lecteur vidéo de VRChat",
    vrchatStep3Body: "Saisis cette URL RTSP dans le champ URL du lecteur AVPro.",
    vrchatHintLabel: "Astuce :",
    vrchatHintBody:
      "mistl relaie le premier pair à diffuser une vidéo dans le salon. Pour t'assurer que c'est bien ton écran qui s'affiche, utilise un ID de salon dédié pour chaque partage.",
    vrchatLanNote1: "Pour regarder via le LAN (VRChat sur un autre PC), règle l'hôte de ",
    vrchatLanNote2: " dans mistl sur ",
    vrchatLanNote3: ", puis utilise l'URL ",
    vrchatLanNote4: " affichée.",
  },

  devConsole: {
    title: "Console développeur",
    searchPlaceholder: "Rechercher dans les journaux",
    clear: "Effacer",
    copyAll: "Tout copier",
    empty: "Aucun journal pour l'instant",
    newLogs: "Nouveaux journaux",
    collapse: "Réduire",
    expand: "Développer",
  },

  onboarding: {
    dialogLabel: "Guide de démarrage",

    step0Title: "Bienvenue sur TC Chat !",
    step0Text1:
      "TC Chat est une appli de chat P2P que tu peux utiliser tout de suite, sans invitation. Chat texte, forum, appels vocaux et partage d'écran cohabitent dans un même salon.",
    step0Text2:
      "Aucun compte n'est nécessaire : choisis simplement un nom affiché pour commencer à discuter depuis cet appareil.",

    step1Title: "À propos des salons",
    step1Text:
      "Les conversations se déroulent dans des « salons ». Tu peux librement créer ou rejoindre des salons privés où seules les personnes avec qui tu partages l'ID du salon peuvent se retrouver.",
    warningTitle: "Le salon global est visible par tout le monde",
    warningBody:
      "Le salon global auquel tu appartiens dès le départ est un espace ouvert que n'importe qui peut rejoindre. Tout ce que tu y envoies — messages ou fichiers — est visible par tous les participants : évite donc de partager des informations personnelles ou tout ce que tu préférerais garder privé.",
    privateRoomsHint:
      "Pour ne parler qu'avec certaines personnes, utilise le « + » de la barre latérale pour choisir un ID de salon et le créer, puis invite uniquement les personnes qui connaissent cet ID.",

    step2Title: "Ce que tu peux faire",
    featureChatTitle: "Chat",
    featureChatBody: "Messages texte, envoi d'images/fichiers et réactions",
    featureBoardTitle: "Forum",
    featureBoardBody: "Publications en fils de discussion : recrutements, annonces ou sujets de discussion",
    featureVoiceTitle: "Appels vocaux",
    featureVoiceBody: "Rejoins un appel vocal sans quitter le salon",
    featureScreenTitle: "Partage d'écran",
    featureScreenBody: "Diffuse ton écran — peut même être regardé depuis le lecteur vidéo de VRChat",

    step3Title: "Tout est prêt !",
    step3Text: "Tu peux modifier ton profil (icône, bio) en touchant ton nom dans la barre latérale.",
    step3Subtle: "Tu peux revoir ce guide à tout moment depuis les Paramètres. Amuse-toi bien !",

    back: "Retour",
    next: "Suivant",
    finish: "Commencer",
  },

  friends: {
    title: "Amis",
    empty: "Pas encore d'amis",
    addFriend: "Ajouter en ami",
    added: "Ajouté",
    remove: "Retirer cet ami",
    sendRequest: "Envoyer une demande d'ami",
    requestSent: "Demande envoyée",
    cancelRequest: "Annuler la demande",
    requestsTitle: "Demandes d'ami",
    incomingLabel: "Reçues",
    outgoingLabel: "Envoyées",
    accept: "Accepter",
    decline: "Refuser",
    online: "En ligne",
  },

  calendar: {
    newEvent: "Nouvel événement",
    titlePlaceholder: "Titre de l'événement",
    startsAtLabel: "Début",
    endsAtLabel: "Fin (facultatif)",
    locationPlaceholder: "Lieu (facultatif)",
    descriptionPlaceholder: "Description (facultative)",
    today: "Aujourd'hui",
    noEvents: "Aucun événement pour le moment",
    showPast: "Afficher les événements passés",
    hidePast: "Masquer les événements passés",
    deleteEventTitle: "Supprimer l'événement",
    deleteEventMessage: "Supprimer cet événement ? Cette action est irréversible.",
    errTitle: "Merci de saisir un titre",
    errStartsAt: "Merci de choisir une date/heure de début",
    personalCalendarTitle: "Calendrier personnel",
    personalCalendarSubtitle: "Enregistré uniquement sur cet appareil — invisible pour les autres.",
    roomCalendarSubtitle: "Visible par tous les participants actuels de ce salon.",
  },
};
