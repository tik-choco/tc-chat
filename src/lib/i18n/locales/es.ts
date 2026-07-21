import type { Messages } from "../messages";

// Español — full translation (neutral / Latin American, informal "tú" register,
// matching the tone of chat apps like WhatsApp/Discord in Spanish).
export const es: Messages = {
  common: {
    cancel: "Cancelar",
    save: "Guardar",
    delete: "Eliminar",
    deleteConfirm: "Eliminar",
    close: "Cerrar",
    closeMenu: "Cerrar menú",
    send: "Enviar",
    edit: "Editar",
    copy: "Copiar",
    copied: "Copiado",
    loading: "Cargando…",
    globalRoom: "Global",
    verified: "Verificado",
    you: "Tú",
    edited: "(editado)",
    irreversible: "Esta acción no se puede deshacer.",
    retry: "Reintentar",
    mediaUnavailable: "Contenido no disponible (puede que quien lo publicó esté desconectado)",
  },

  settings: {
    title: "Configuración",
    language: "Idioma",
    chatDisplay: "Visualización del chat",
    displayListLabel: "Lista",
    displayListDesc: "Ícono, nombre y texto en una sola fila, estilo feed",
    displayBubbleLabel: "Burbujas",
    displayBubbleDesc: "Diseño de chat con burbujas a la izquierda y la derecha",
    developer: "Desarrollador",
    developerModeLabel: "Modo desarrollador",
    developerModeDesc: "Muestra registros de depuración detallados en tiempo real en la parte inferior de la pantalla",
    help: "Ayuda",
    viewGuide: "Ver la guía de introducción",
    notifications: "Notificaciones",
    notifLabel: "Notificaciones de escritorio",
    notifDesc: "Avisa cuando llega un mensaje directo para ti",
    notifGranted: "Las notificaciones están activadas",
    notifDenied: "Las notificaciones están bloqueadas en la configuración del navegador",
    notifUnsupported: "Este navegador no admite notificaciones",
    mediaCaution: "Antes de transmitir",
    mediaCautionLabel: "Mostrar un aviso antes de transmitir",
    mediaCautionDesc: "Muestra una pantalla de confirmación antes de iniciar la cámara o compartir pantalla",
    giphyApiKey: "Clave de API de GIPHY",
    giphyApiKeyDesc: "Se usa para buscar GIFs en el chat (solo quien los envía necesita configurarla)",
    giphyApiKeyPlaceholder: "Pega tu clave de API de GIPHY",
    giphyApiKeySaved: "Guardado",
  },

  chat: {
    // MessageBubble (media body)
    mediaLoadFailed: "No se pudo cargar este archivo",
    fullscreen: "Ver en pantalla completa",
    viewFullscreen: "Ver {name} en pantalla completa",
    file: "Archivo",
    // MessageBubble (message row)
    messageDeleted: "Este mensaje fue eliminado",
    deleteHint: "Eliminar (Shift+clic para omitir la confirmación)",
    deleteMessageTitle: "Eliminar mensaje",
    deleteMessageConfirm: "¿Eliminar este mensaje? Esta acción no se puede deshacer.",
    viewProfile: "Ver el perfil de {name}",
    verifiedAs: "Verificado: {did}",
    // MessageInput
    attachFile: "Adjuntar un archivo",
    pickFromStorage: "Elegir desde tc-storage",
    pickGif: "Enviar un GIF",
    joinRoomPlaceholder: "Únete a una sala para empezar a chatear",
    messagePlaceholder: "Escribe un mensaje",
    recordVoice: "Grabar un mensaje de voz",
    voiceRecording: "Grabando…",
    voiceStopRecording: "Detener grabación",
    voiceCancelRecording: "Cancelar grabación",
    voiceMicDenied:
      "No se pudo acceder al micrófono. Permite el acceso al micrófono en la configuración de tu navegador.",
    // GifPicker
    gifPickerTitle: "Elige un GIF",
    gifSearchPlaceholder: "Buscar GIFs en GIPHY",
    gifLoading: "Cargando…",
    gifLoadFailed: "No se pudieron cargar los GIFs",
    gifNoResults: "No se encontraron GIFs",
    gifTrending: "GIFs de tendencia",
    gifSetupTitle: "No hay una clave de API de GIPHY configurada",
    gifSetupBody:
      "La búsqueda de GIFs necesita una clave de API de GIPHY gratuita. Sigue la guía a continuación para obtener una y pégala aquí.",
    gifSetupLink: "Cómo obtener una clave de API de GIPHY",
    gifApiKeyPlaceholder: "Pega tu clave de API de GIPHY",
    gifSaveKey: "Guardar",
    gifAttribution: "Con la tecnología de GIPHY",
    // ChatWindow
    noMessages: "Todavía no hay mensajes",
    globalRoomBadge: "Pública",
    globalRoomWarning:
      "La sala global es un espacio abierto al que cualquiera puede unirse. Todo lo que envíes aquí es visible para todos los participantes.",
    typingIndicator: "{names} está escribiendo…",
    // ReactionBar
    addReaction: "Agregar una reacción",
    nameSeparator: ", ",
    // RoomContent
    openMenu: "Abrir menú",
    chatTab: "Chat",
    boardTab: "Foro",
    calendarTab: "Calendario",
    galleryTab: "Galería",
    dmNotifBody: "Tienes un mensaje nuevo",
  },

  board: {
    // Post kinds / filters
    filterAll: "Todos",
    recruit: "Reclutamiento",
    topic: "Debate",

    // Board chrome
    subtitle: "Los hilos pueden anidarse tantas veces como quieras",
    newPost: "Nueva publicación",
    emptyAll: "Todavía no hay publicaciones",
    emptyFiltered: "Todavía no hay publicaciones de este tipo",
    firstPost: "Escribe la primera publicación",

    // Node view
    reply: "Responder",
    replies: "{count} respuestas",
    showReplies: "Mostrar {count} respuestas",
    postDeleted: "Esta publicación fue eliminada",
    verifiedTooltip: "Verificado: {did}",
    deleteHint: "Eliminar (Shift+clic para omitir la confirmación)",
    deletePostTitle: "Eliminar publicación",
    deletePostMessage: "¿Eliminar esta publicación? Esta acción no se puede deshacer.",
    titlePlaceholder: "Título",

    // Thumbnail image (composer + node view)
    thumbAdd: "Agregar miniatura",
    thumbChange: "Cambiar miniatura",
    thumbRemove: "Quitar miniatura",
    thumbAlt: "Imagen en miniatura",
    thumbError: "No se pudo cargar la imagen",

    // Composer
    titleOptionalPlaceholder: "Título (opcional)",
    recruitTitlePlaceholder: "Título de reclutamiento",
    replyPlaceholder: "Escribe una respuesta…",
    recruitBodyPlaceholder: "Describe qué buscas o necesitas",
    bodyPlaceholder: "Escribe algo…",
    rolesPlaceholder: "Roles buscados (separados por comas)",
    tagsPlaceholder: "Etiquetas (separadas por comas)",
    errBody: "Por favor, escribe algo de texto",
    errRecruitBody: "Por favor, describe qué buscas reclutar",
    errRecruitTitle: "Por favor, ingresa un título de reclutamiento",
    submitPost: "Publicar",
    submitRecruit: "Publicar reclutamiento",

    // --- note-article import chip (tc-note handoff via the shared bus) ---
    importArticleChip: "Importar artículo de tc-note: {title}",
    importArticleDismiss: "Descartar",
    // --- end note-article import chip ---

    // --- recruit join / capacity ---
    joinWish: "Interesado/a",
    joinCount: "{count} interesados",
    joinCountCap: "Interesados {count}/{capacity}",
    capacityPlaceholder: "Plazas (opcional)",
    backToList: "Volver a la lista",
    // --- end recruit join / capacity ---
  },

  media: {
    // MediaGalleryView
    galleryEmpty: "Todavía no hay fotos ni videos",
    galleryEmptyHint: "Comparte el primero",
    galleryUpload: "Subir",
    galleryAddFromStorage: "Agregar desde tc-storage",
    galleryDeleteConfirm: "¿Eliminar este archivo multimedia?",
    gallerySharedBy: "Compartido por {name}",
    galleryStoredFileFailed: "No se pudo descifrar el archivo de tc-storage (este navegador no tiene su clave de descifrado)",
    // Lightbox
    image: "Imagen",
    video: "Video",
    preview: "Vista previa",
    counter: "{current} / {total}",
    displayMode: "Modo de vista",
    singleMode: "Individual",
    flowMode: "Flujo",
    download: "Descargar",
    closeEsc: "Cerrar (Esc)",
    prev: "Anterior",
    next: "Siguiente",
    // VoicePanel
    participantFallback: "Participante",
    viewProfile: "Ver el perfil de {name}",
    inCall: "En una llamada",
    participantCount: "{count} en la llamada",
    joinVoice: "Unirse al chat de voz",
    joinCall: "Unirse a la llamada",
    joinCallCount: "Unirse a la llamada ({count})",
    unmute: "Activar micrófono",
    mute: "Silenciar",
    leave: "Salir",
    // ScreenShareView
    shareScreen: "Compartir pantalla",
    stopSharing: "Dejar de compartir",
    vrchatGuide: "Cómo verlo en VRChat",
    startShareFailed: "No se pudo iniciar la pantalla compartida",
    noAudioCaptured: "Compartiendo sin audio - marca \"Compartir audio\" en el selector para incluir sonido",
    // RemoteScreenStage
    maximizeShare: "Ver pantalla compartida en pantalla completa",
    fullscreen: "Ver en pantalla completa",
    screenShareFile: "Pantalla compartida {name}",
    // StoragePicker
    storagePickerTitle: "Elegir desde tc-storage",
    storagePickerEmpty: "No hay archivos en tc-storage para adjuntar",
    // VideoCallPanel / VideoCallStage
    startVideoCall: "Videollamada",
    stopCamera: "Apagar cámara",
    startCameraFailed: "No se pudo iniciar la cámara",
    // MediaCautionDialog
    cautionTitle: "Antes de transmitir",
    cautionBodyCamera: "La imagen de tu cámara se transmitirá a todos los que estén ahora en esta sala.",
    cautionBodyScreen: "El contenido de tu pantalla se transmitirá a todos los que estén ahora en esta sala.",
    cautionDontShowAgain: "No volver a mostrar esto",
    cautionContinue: "Continuar",
    cautionCancel: "Cancelar",
  },

  account: {
    // Shared across profile surfaces
    profileTitle: "Perfil",
    displayName: "Nombre visible",

    // ProfilePanel
    selectImageFile: "Por favor, elige un archivo de imagen",
    imageTooLarge: "La imagen debe pesar 5MB o menos",
    uploadFailed: "Error al subir la imagen",
    displayNameRequired: "Por favor, ingresa un nombre visible",
    uploadingImage: "La imagen todavía se está subiendo",
    unnamed: "(Sin nombre)",
    changeImage: "Cambiar imagen",
    chooseImage: "Elegir imagen",
    namePlaceholder: "Nombre",
    bio: "Biografía",
    bioPlaceholder: "Una breve biografía",
    vrmNote:
      "🧑‍🚀 Tienes un avatar VR (VRM) registrado en tu perfil compartido (compartido con tc-vrsns2)",
    profileHint:
      "Tu imagen de perfil se sube al almacenamiento de mistlib (storage_add) y se guarda en tu perfil como un CID. Tu perfil está firmado con tu DID, por lo que puedes compartir esa misma identidad con otras apps de tik-choco (como mistl).",

    // PeerProfileModal
    participant: "Participante",
    selfSuffix: " (Tú)",
    verifiedDidTitle: "DID verificado con firma",
    noBio: "Todavía no hay biografía",

    // UsernameGate
    gateTagline: "Chat P2P, foros, voz y pantalla compartida",
    nicknamePlaceholder: "Ingresa un apodo",
    getStarted: "Comenzar",
    gateFooter: "Descentralizado · Firmado con DID · Guardado en tu dispositivo",

    // Sidebar
    roomIdInvalid:
      "El ID de sala solo puede contener letras, números, - y _, y debe tener entre 1 y 64 caracteres",
    settings: "Configuración",
    openSettings: "Abrir configuración",
    switchToDark: "Cambiar a modo oscuro",
    switchToLight: "Cambiar a modo claro",
    toggleTheme: "Cambiar tema",
    editProfile: "Editar perfil",
    guest: "Invitado",
    rooms: "Salas",
    joinRoom: "Unirse a una sala",
    roomIdTooltip: "ID de sala: {id}",
    copyRoomId: "Copiar ID de sala",
    leaveRoom: "Salir de la sala",
    roomIdPlaceholder: "ID de sala (clave compartida)",
    roomNamePlaceholder: "Nombre visible (opcional)",
    generateRoomId: "Generar un ID aleatorio",
    join: "Unirse",
    viewPeerProfile: "Ver el perfil de {name}",

    // RoomNamePanel
    roomNicknameEdit: "Cambiar tu nombre en esta sala",
    roomNicknameTitle: "Tu nombre en esta sala",
    roomNicknamePlaceholder: "{name} (nombre del perfil)",
    roomNicknameHint:
      "Este nombre se usa en los mensajes y publicaciones que envíes en esta sala y se comparte con sus miembros. Déjalo vacío para usar el nombre de tu perfil.",

    editRoomIdentity: "Editar nombre e icono de la sala",
    roomIdentityTitle: "Nombre e icono de la sala",
    roomIdentityNameLabel: "Nombre de la sala (compartido con todos)",
    roomIdentityHint:
      "El nombre y el icono que definas aquí se transmiten a todos en esta sala. Deja el nombre vacío para volver a la etiqueta local de cada persona.",

    // VrchatGuide — sentence fragments keep the surrounding <strong>/<code>
    // markup; spaces at the fragment edges are part of the rendered text.
    vrchatGuideTitle: "Ver pantallas compartidas en VRChat",
    vrchatIntroLead: "La pantalla compartida de esta sala se retransmite a RTSP mediante ",
    vrchatIntroTail:
      " en el PC receptor, para que puedas reproducirla en el reproductor de video de VRChat (AVPro).",
    vrchatStep1Title: "1. Inicia una pantalla compartida en esta sala",
    vrchatSharingLive: "● Compartiendo ahora",
    vrchatStep1Hint: "Usa el botón «Compartir pantalla» de arriba para empezar.",
    vrchatStep2Title: "2. Ejecuta mistl en el PC receptor",
    vrchatStep2Body: "Inicia el relay con el mismo ID de sala.",
    vrchatStep3Title: "3. Pégalo en el reproductor de video de VRChat",
    vrchatStep3Body: "Ingresa esta URL de RTSP en el campo de URL del reproductor AVPro.",
    vrchatHintLabel: "Consejo:",
    vrchatHintBody:
      "mistl retransmite al primer participante que publica video en la sala. Para asegurarte de que se muestre tu pantalla, usa un ID de sala exclusivo para cada transmisión.",
    vrchatLanNote1: "Para verlo por LAN (VRChat en otro PC), configura el host de ",
    vrchatLanNote2: " en mistl como ",
    vrchatLanNote3: "; luego usa la ",
    vrchatLanNote4: " que se muestra.",
  },

  devConsole: {
    title: "Consola de desarrollador",
    searchPlaceholder: "Buscar registros",
    clear: "Limpiar",
    copyAll: "Copiar todo",
    empty: "Todavía no hay registros",
    newLogs: "Nuevos registros",
    collapse: "Contraer",
    expand: "Expandir",
  },

  onboarding: {
    dialogLabel: "Guía de introducción",

    step0Title: "¡Bienvenido/a a TC Chat!",
    step0Text1:
      "TC Chat es una app de chat P2P que puedes empezar a usar de inmediato, sin invitación. El chat de texto, el foro, las llamadas de voz y la pantalla compartida conviven en una sola sala.",
    step0Text2:
      "No necesitas crear una cuenta: basta con elegir un nombre visible para empezar a chatear desde este dispositivo.",

    step1Title: "Sobre las salas",
    step1Text:
      "Las conversaciones ocurren dentro de \"salas\". Puedes crear o unirte libremente a salas privadas donde solo se reúnen las personas con quienes compartas el ID de la sala.",
    warningTitle: "La sala global es visible para todo el mundo",
    warningBody:
      "La sala global en la que estás desde el principio es un espacio abierto al que cualquiera puede unirse. Todo lo que envíes ahí —mensajes o archivos— es visible para todos los participantes, así que evita compartir información personal o cualquier cosa que prefieras mantener privada.",
    privateRoomsHint:
      "Si quieres hablar solo con ciertas personas, usa el \"+\" de la barra lateral para elegir un ID de sala y crearla, e invita únicamente a quienes conozcan ese ID.",

    step2Title: "Qué puedes hacer",
    featureChatTitle: "Chat",
    featureChatBody: "Mensajes de texto, envío de imágenes/archivos y reacciones",
    featureBoardTitle: "Foro",
    featureBoardBody: "Publicaciones con hilos: comparte reclutamientos, avisos o temas de charla",
    featureVoiceTitle: "Llamadas de voz",
    featureVoiceBody: "Únete a una llamada de voz sin salir de la sala",
    featureScreenTitle: "Pantalla compartida",
    featureScreenBody: "Transmite tu pantalla; incluso se puede ver desde el reproductor de video de VRChat",

    step3Title: "¡Todo listo!",
    step3Text: "Puedes editar tu perfil (ícono, biografía) tocando tu nombre en la barra lateral.",
    step3Subtle: "Puedes volver a ver esta guía en cualquier momento desde Configuración. ¡Disfruta!",

    back: "Atrás",
    next: "Siguiente",
    finish: "Comenzar",
  },

  friends: {
    title: "Amigos",
    empty: "Todavía no tienes amigos",
    addFriend: "Agregar amigo",
    added: "Agregado",
    remove: "Quitar amigo",
    sendRequest: "Enviar solicitud de amistad",
    requestSent: "Solicitud enviada",
    cancelRequest: "Cancelar solicitud",
    requestsTitle: "Solicitudes de amistad",
    incomingLabel: "Recibidas",
    outgoingLabel: "Enviadas",
    accept: "Aceptar",
    decline: "Rechazar",
    online: "En línea",
  },

  calendar: {
    newEvent: "Nuevo evento",
    titlePlaceholder: "Título del evento",
    startsAtLabel: "Comienza",
    endsAtLabel: "Termina (opcional)",
    locationPlaceholder: "Ubicación (opcional)",
    descriptionPlaceholder: "Descripción (opcional)",
    today: "Hoy",
    noEvents: "Todavía no hay eventos",
    showPast: "Mostrar eventos pasados",
    hidePast: "Ocultar eventos pasados",
    deleteEventTitle: "Eliminar evento",
    deleteEventMessage: "¿Eliminar este evento? Esta acción no se puede deshacer.",
    errTitle: "Por favor, ingresa un título",
    errStartsAt: "Por favor, elige una fecha y hora de inicio",
    personalCalendarTitle: "Calendario personal",
    personalCalendarSubtitle: "Guardado solo en este dispositivo — nadie más puede verlo.",
    roomCalendarSubtitle: "Visible para todos los que están en esta sala.",
  },
};
