import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ChatMessage, ChatDisplay } from "../lib/chatStore";
import type { ProfileDirectory } from "../lib/profileDirectory";
import type { Peer } from "../hooks/usePresence";
import type { TcStorageFileEntry } from "../interop/tcStorageFiles";
import { Hash, Globe, User, AlertTriangle, Pencil } from "lucide-preact";
import { MessageBubble, groupPosAt } from "./MessageBubble";
import { MessageInput } from "./MessageInput";
import { CallControls } from "./CallControls";
import { CallDock } from "./CallDock";
import { RemoteScreenStage } from "./RemoteScreenStage";
import { VideoCallStage } from "./VideoCallStage";
import { MediaCautionDialog } from "./MediaCautionDialog";
import { Lightbox, type LightboxItem } from "./Lightbox";
import type { useVoiceChat } from "../hooks/useVoiceChat";
import type { useScreenShare } from "../hooks/useScreenShare";
import type { useVideoCall } from "../hooks/useVideoCall";
import { loadMediaCaution, saveMediaCaution } from "../lib/chatStore";
import { GLOBAL_ROOM_ID } from "../lib/util";
import { useT } from "../lib/i18n";

export function ChatWindow(props: {
  roomId: string;
  roomName: string;
  /** True when the active room is a friend's auto-derived DM room. */
  isDm: boolean;
  localNodeId: string | null;
  messages: ChatMessage[];
  ready: boolean;
  chatDisplay: ChatDisplay;
  directory: ProfileDirectory;
  peers: Peer[];
  selfName: string;
  /** Names of peers currently typing in this room (empty in the global room). */
  typingNames: string[];
  onTyping: () => void;
  onSendText: (text: string) => void;
  onSendFile: (file: File) => void;
  onSendStoredFile: (entry: TcStorageFileEntry) => void;
  onToggleReaction: (targetId: string, emoji: string) => void;
  onEditMessage: (targetId: string, text: string) => void;
  onDeleteMessage: (targetId: string) => void;
  /** Open a participant's read-only profile card (by DID + a fallback name). */
  onOpenProfile: (did: string, fallbackName: string) => void;
  /** Open the per-room display-name override editor for the current room. */
  onEditSelfRoomName: () => void;
  voice: ReturnType<typeof useVoiceChat>;
  screenShare: ReturnType<typeof useScreenShare>;
  videoCall: ReturnType<typeof useVideoCall>;
}) {
  const {
    roomId,
    roomName,
    isDm,
    localNodeId,
    messages,
    ready,
    chatDisplay,
    directory,
    peers,
    selfName,
    typingNames,
    onTyping,
    onSendText,
    onSendFile,
    onSendStoredFile,
    onToggleReaction,
    onEditMessage,
    onDeleteMessage,
    onOpenProfile,
    onEditSelfRoomName,
    voice,
    screenShare,
    videoCall,
  } = props;
  const t = useT();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Gates both camera and screen-share starts behind MediaCautionDialog (see
  // that component and loadMediaCaution/saveMediaCaution in chatStore.ts).
  // One dialog instance here covers both actions; `pendingAction` records
  // which start to actually run once the user confirms.
  const [pendingAction, setPendingAction] = useState<"camera" | "screen" | null>(null);

  function startVideoCall() {
    // Camera-on implies being in the call: join voice too if not already
    // joined. Stopping the camera later only turns it off -- it does not
    // leave voice (see the videoCall.stop wiring below). Leaving the call
    // (leaveCall, below) is the one that also turns the camera off.
    if (!voice.joined) voice.join();
    videoCall.start();
  }

  // Leaving the call also turns the camera off (camera-on implies being in
  // the call, so leaving while broadcasting camera would orphan the tiles).
  // Screen share intentionally keeps running -- it's independent of the
  // voice call, so you can present without being in it.
  function leaveCall() {
    if (videoCall.on) videoCall.stop();
    voice.leave();
  }

  function requestCaution(kind: "camera" | "screen") {
    if (loadMediaCaution()) {
      setPendingAction(kind);
      return;
    }
    if (kind === "camera") startVideoCall();
    else screenShare.start();
  }

  function confirmCaution(skipFuture: boolean) {
    if (skipFuture) saveMediaCaution(false);
    if (pendingAction === "camera") startVideoCall();
    else if (pendingAction === "screen") screenShare.start();
    setPendingAction(null);
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length]);

  // The room's maximizable media (images/videos), in message order — this is
  // the gallery the Lightbox pages through. Opening is tracked by the target
  // message id (stable across re-renders) rather than a raw index.
  const mediaItems = useMemo<LightboxItem[]>(
    () =>
      messages
        .filter(
          (m) =>
            (m.kind === "media" || m.kind === "file") &&
            (m.mimeType?.startsWith("image/") || m.mimeType?.startsWith("video/")),
        )
        .map((m) => ({
          key: m.id,
          kind: m.mimeType?.startsWith("video/") ? "video" : "image",
          cid: m.cid,
          enc: m.enc,
          fileName: m.fileName,
          size: m.fileSize,
        })),
    [messages],
  );
  const [lightboxKey, setLightboxKey] = useState<string | null>(null);
  const lightboxIndex = mediaItems.findIndex((i) => i.key === lightboxKey);

  return (
    <main class="chat-window">
      <header class="topbar">
        <div class="topbar-title">
          {roomId === GLOBAL_ROOM_ID ? (
            <Globe size={18} class="topbar-hash" />
          ) : isDm ? (
            <User size={18} class="topbar-hash" />
          ) : (
            <Hash size={18} class="topbar-hash" />
          )}
          <h2>{roomName}</h2>
          {roomId === GLOBAL_ROOM_ID && (
            <span class="topbar-public-badge" title={t("chat.globalRoomWarning")}>
              <AlertTriangle size={12} />
              {t("chat.globalRoomBadge")}
            </span>
          )}
        </div>
        <div class="topbar-actions">
          <button
            type="button"
            class="pill-btn pill-btn--ghost room-nickname-btn"
            title={t("account.roomNicknameEdit")}
            aria-label={t("account.roomNicknameEdit")}
            onClick={onEditSelfRoomName}
          >
            <Pencil size={14} />
            <span class="btn-label room-nickname-btn-label">{selfName}</span>
          </button>
          {roomId !== GLOBAL_ROOM_ID && (
            <CallControls
              roomId={roomId}
              joined={voice.joined}
              muted={voice.muted}
              remoteVoiceCount={new Set(voice.remoteTracks.map((t) => t.fromId)).size}
              cameraOn={videoCall.on}
              sharing={screenShare.sharing}
              onJoin={voice.join}
              onLeave={leaveCall}
              onToggleMute={voice.toggleMute}
              onCameraStart={() => requestCaution("camera")}
              onCameraStop={videoCall.stop}
              onShareStart={() => requestCaution("screen")}
              onShareStop={screenShare.stop}
            />
          )}
        </div>
      </header>

      {roomId !== GLOBAL_ROOM_ID && (
        <CallDock
          joined={voice.joined}
          muted={voice.muted}
          remoteTracks={voice.remoteTracks}
          peers={peers}
          selfId={localNodeId ?? ""}
          selfName={selfName}
          cameraError={videoCall.error}
          shareError={screenShare.error}
          shareAudioMissing={screenShare.sharing && !!screenShare.audioMissing}
          onOpenProfile={onOpenProfile}
        />
      )}

      <div class="chat-scroll" ref={scrollRef}>
        <RemoteScreenStage tracks={screenShare.remoteTracks} />
        <VideoCallStage
          tracks={videoCall.remoteTracks}
          peers={peers}
          selfName={selfName}
          localStream={videoCall.localStream}
          onOpenProfile={onOpenProfile}
        />
        {messages.length === 0 && <p class="chat-empty">{t("chat.noMessages")}</p>}
        {messages.map((m, i) => (
          <MessageBubble
            key={m.id}
            message={m}
            isOwn={m.fromId === localNodeId}
            localId={localNodeId}
            display={chatDisplay}
            directory={directory}
            groupPos={groupPosAt(messages, i)}
            onToggleReaction={onToggleReaction}
            onEditMessage={onEditMessage}
            onDeleteMessage={onDeleteMessage}
            onOpenProfile={onOpenProfile}
            onMaximize={setLightboxKey}
          />
        ))}
      </div>

      {typingNames.length > 0 && (
        <p class="typing-indicator">
          {t("chat.typingIndicator", { names: typingNames.join(t("chat.nameSeparator")) })}
        </p>
      )}

      <MessageInput
        disabled={!ready}
        onTyping={onTyping}
        onSendText={onSendText}
        onSendFile={onSendFile}
        onSendStoredFile={onSendStoredFile}
      />

      {lightboxKey && lightboxIndex >= 0 && (
        <Lightbox
          items={mediaItems}
          index={lightboxIndex}
          onIndexChange={(i) => setLightboxKey(mediaItems[i].key)}
          onClose={() => setLightboxKey(null)}
        />
      )}

      {pendingAction && (
        <MediaCautionDialog
          kind={pendingAction}
          onConfirm={confirmCaution}
          onCancel={() => setPendingAction(null)}
        />
      )}
    </main>
  );
}
