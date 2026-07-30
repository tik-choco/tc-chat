import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Fragment } from "preact";
import type { ChatMessage, ChatDisplay } from "../lib/chatStore";
import { identityFor, type ProfileDirectory } from "../lib/profileDirectory";
import type { Peer } from "../hooks/usePresence";
import type { TcStorageFileEntry } from "../interop/tcStorageFiles";
import { Hash, Globe, User, UserPlus, AlertTriangle, Pencil, CornerUpLeft, X } from "lucide-preact";
import { Avatar } from "./Avatar";
import { MessageBubble, groupPosAt, replySnippet } from "./MessageBubble";
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
import { useT, type TFunc } from "../lib/i18n";

// How long a jumped-to message stays visually flashed (see chat.css's
// .msg-row--flash / .bubble-row--flash) before returning to normal.
const JUMP_FLASH_MS = 1500;

/** Local-calendar-day equality — never raw ms/86400000 arithmetic, since two
 * timestamps 24h apart can still fall on the same or different local dates
 * depending on time-of-day (and this must track the viewer's own timezone/DST,
 * not UTC). */
function isSameLocalDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

/**
 * Whether a date-divider belongs immediately before `messages[i]` — always
 * before the first message, and again whenever its local calendar date
 * differs from the message right before it. Exported standalone (pure, no
 * hooks) so it's directly testable without rendering all of ChatWindow's
 * call/voice/video hook-shaped props.
 */
export function needsDateDivider(messages: ChatMessage[], i: number): boolean {
  if (i === 0) return true;
  return !isSameLocalDay(messages[i - 1].timestamp, messages[i].timestamp);
}

/** Today/Yesterday get dedicated strings; anything older falls back to the
 * browser's own locale-aware date format (no i18n key needed there). */
export function dateDividerLabel(timestamp: number, t: TFunc): string {
  const now = Date.now();
  if (isSameLocalDay(timestamp, now)) return t("chat.dateToday");
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameLocalDay(timestamp, yesterday.getTime())) return t("chat.dateYesterday");
  return new Date(timestamp).toLocaleDateString();
}

export function ChatWindow(props: {
  roomId: string;
  roomName: string;
  /** The room's SHARED icon (mistlib storage CID), synced to everyone via useRoomMeta. */
  roomIconCid?: string;
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
  /** `replyToId` is the quoted message's id — a reply is an ordinary
   * `tc-chat:post` wire with `parentId` set (see useChatRoom.sendText), so
   * omitting it keeps every existing caller (e.g. sendInviteDm) working
   * unchanged. ChatWindow itself supplies this from its own reply-bar state;
   * it does not come from MessageInput (which stays reply-agnostic). */
  onSendText: (text: string, replyToId?: string | null) => void;
  onSendFile: (file: File) => void;
  onSendStoredFile: (entry: TcStorageFileEntry) => void;
  onToggleReaction: (targetId: string, emoji: string) => void;
  onEditMessage: (targetId: string, text: string) => void;
  onDeleteMessage: (targetId: string) => void;
  /** Open a participant's read-only profile card (by DID + a fallback name). */
  onOpenProfile: (did: string, fallbackName: string) => void;
  /** Open the per-room display-name override editor for the current room. */
  onEditSelfRoomName: () => void;
  /** Open the SHARED room name/icon editor — omitted for rooms that can't have one (global, DMs). */
  onEditRoomIdentity?: () => void;
  /** Open this room's invite share sheet — omitted where an invite makes no sense (global, DMs). */
  onInvite?: () => void;
  voice: ReturnType<typeof useVoiceChat>;
  screenShare: ReturnType<typeof useScreenShare>;
  videoCall: ReturnType<typeof useVideoCall>;
}) {
  const {
    roomId,
    roomName,
    roomIconCid,
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
    onEditRoomIdentity,
    onInvite,
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

  // The message currently being replied to (its id) — lives here, not in
  // MessageInput, so MessageInput stays reply-agnostic and unchanged; sending
  // closes over this and clears it afterward. Switching rooms also clears it,
  // since a reply target from the old room's message list makes no sense here.
  const [replyToId, setReplyToId] = useState<string | null>(null);
  // The message id currently flashed after a jump-to-message click (see
  // jumpToMessage below); cleared automatically after JUMP_FLASH_MS.
  const [flashId, setFlashId] = useState<string | null>(null);
  const flashTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    setReplyToId(null);
    setFlashId(null);
  }, [roomId]);

  useEffect(
    () => () => {
      if (flashTimeoutRef.current !== null) window.clearTimeout(flashTimeoutRef.current);
    },
    [],
  );

  // ChatWindow (not MessageBubble) holds every message in the room, so it's
  // the one place that can resolve a reply's quoted parent without a lookup
  // living inside MessageBubble itself.
  const messagesById = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const replyTarget = replyToId ? messagesById.get(replyToId) : undefined;

  function handleSendText(text: string) {
    onSendText(text, replyToId);
    setReplyToId(null);
  }

  function jumpToMessage(id: string) {
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-message-id="${id}"]`);
    // Not currently rendered (e.g. aged out past the 500-post cap) — nothing
    // to scroll to; the quote header itself already degraded to the
    // "original not available" text in that case.
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    setFlashId(id);
    if (flashTimeoutRef.current !== null) window.clearTimeout(flashTimeoutRef.current);
    flashTimeoutRef.current = window.setTimeout(() => setFlashId(null), JUMP_FLASH_MS);
  }

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
          ) : roomIconCid ? (
            <Avatar id={roomId} name={roomName} avatarCid={roomIconCid} size={34} />
          ) : (
            <Hash size={18} class="topbar-hash" />
          )}
          <h2>{roomName}</h2>
          {onEditRoomIdentity && (
            <button
              type="button"
              class="topbar-edit-room"
              title={t("account.editRoomIdentity")}
              aria-label={t("account.editRoomIdentity")}
              onClick={onEditRoomIdentity}
            >
              <Pencil size={13} />
            </button>
          )}
          {roomId === GLOBAL_ROOM_ID && (
            <span class="topbar-public-badge" title={t("chat.globalRoomWarning")}>
              <AlertTriangle size={12} />
              {t("chat.globalRoomBadge")}
            </span>
          )}
        </div>
        <div class="topbar-actions">
          {onInvite && (
            <button
              type="button"
              class="pill-btn pill-btn--ghost"
              title={t("invite.inviteAction")}
              aria-label={t("invite.inviteAction")}
              onClick={onInvite}
            >
              <UserPlus size={14} />
              <span class="btn-label">{t("invite.title")}</span>
            </button>
          )}
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
          <Fragment key={m.id}>
            {needsDateDivider(messages, i) && (
              <div class="date-divider" role="separator">
                <span class="date-divider-label">{dateDividerLabel(m.timestamp, t)}</span>
              </div>
            )}
            <MessageBubble
              message={m}
              isOwn={m.fromId === localNodeId}
              localId={localNodeId}
              display={chatDisplay}
              directory={directory}
              groupPos={groupPosAt(messages, i)}
              parentMessage={m.parentId ? messagesById.get(m.parentId) : undefined}
              flash={flashId === m.id}
              onToggleReaction={onToggleReaction}
              onReply={setReplyToId}
              onEditMessage={onEditMessage}
              onDeleteMessage={onDeleteMessage}
              onOpenProfile={onOpenProfile}
              onMaximize={setLightboxKey}
              onJumpToMessage={jumpToMessage}
            />
          </Fragment>
        ))}
      </div>

      {typingNames.length > 0 && (
        <p class="typing-indicator">
          {t("chat.typingIndicator", { names: typingNames.join(t("chat.nameSeparator")) })}
        </p>
      )}

      {replyTarget && (
        <div class="reply-bar">
          <CornerUpLeft size={14} class="reply-bar-icon" aria-hidden="true" />
          <div class="reply-bar-info">
            <span class="reply-bar-label">
              {t("chat.replyingTo", {
                name: identityFor(directory, replyTarget.fromId, replyTarget.fromName).name,
              })}
            </span>
            <span class="reply-bar-snippet">{replySnippet(replyTarget, t)}</span>
          </div>
          <button
            type="button"
            class="reply-bar-cancel"
            aria-label={t("chat.replyCancel")}
            title={t("chat.replyCancel")}
            onClick={() => setReplyToId(null)}
          >
            <X size={14} />
          </button>
        </div>
      )}

      <MessageInput
        roomId={roomId}
        disabled={!ready}
        onTyping={onTyping}
        onSendText={handleSendText}
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
