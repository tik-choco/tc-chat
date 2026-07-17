import { useEffect, useRef, useState } from "preact/hooks";
import { Paperclip, BadgeCheck, Pencil, Trash2, Maximize2 } from "lucide-preact";
import type { ChatMessage } from "../lib/chatStore";
import { resolveStorageUrl, invalidateStorageUrl } from "../lib/mediaUrl";
import { formatBytes, formatTime, shortDid } from "../lib/util";
import { identityFor, type ProfileDirectory } from "../lib/profileDirectory";
import { useT } from "../lib/i18n";
import { extractHttpUrls } from "../lib/linkPreview";
import { Avatar } from "./Avatar";
import { ReactionBar } from "./ReactionBar";
import { ConfirmDialog } from "./ConfirmDialog";
import { LinkPreviewCard } from "./LinkPreviewCard";
import { MarkdownView } from "./MarkdownView";

function MediaContent(props: { message: ChatMessage; onMaximize: (messageId: string) => void }) {
  const { message, onMaximize } = props;
  const t = useT();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    setError(false);
    resolveStorageUrl(message.cid, message.enc)
      .then((u) => !cancelled && setUrl(u))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [message.cid, message.enc]);

  // Retry: drop the (failed) cache entry and resolve again from scratch —
  // the author may be back online, or a relay may now have the content.
  function retry() {
    invalidateStorageUrl(message.cid);
    setError(false);
    setUrl(null);
    resolveStorageUrl(message.cid, message.enc)
      .then(setUrl)
      .catch(() => setError(true));
  }

  if (error) {
    return (
      // A <button> so the failure is tappable/clickable to retry (was a
      // plain <p>) — .media-error only styles text (margin/size/opacity),
      // so the native button chrome is reset inline rather than adding a
      // CSS rule (out of this change's file scope).
      <button
        type="button"
        class="media-error"
        onClick={retry}
        title={t("common.retry")}
        style={{ border: "none", background: "transparent", padding: 0, color: "inherit", cursor: "pointer", textAlign: "left" }}
      >
        {t("chat.mediaLoadFailed")}
      </button>
    );
  }
  if (!url) return <p class="media-loading">{t("common.loading")}</p>;

  const isImage = message.mimeType?.startsWith("image/");
  const isVideo = message.mimeType?.startsWith("video/");

  // Images/videos open in the shared gallery Lightbox, whose item list + index
  // are owned by ChatWindow — clicking here just asks it to open at this post.
  if (isImage || isVideo) {
    const alt = message.fileName ?? (isVideo ? "video" : "image");
    return isImage ? (
      // Images have no controls, so the whole thumbnail is the zoom target
      // (also keyboard-focusable via the button).
      <button
        type="button"
        class="bubble-media-zoom"
        aria-label={t("chat.viewFullscreen", { name: alt })}
        title={t("chat.fullscreen")}
        onClick={() => onMaximize(message.id)}
      >
        <img class="bubble-image" src={url} alt={alt} />
      </button>
    ) : (
      // Video keeps its own inline controls; a small overlay button maximizes it
      // so control clicks don't also open the lightbox.
      <div class="bubble-media-frame">
        <video class="bubble-video" src={url} controls playsInline />
        <button
          type="button"
          class="media-maximize-btn"
          aria-label={t("chat.viewFullscreen", { name: alt })}
          title={t("chat.fullscreen")}
          onClick={() => onMaximize(message.id)}
        >
          <Maximize2 size={15} />
        </button>
      </div>
    );
  }
  if (message.mimeType?.startsWith("audio/")) {
    return <audio class="bubble-audio" controls src={url} />;
  }
  return (
    <a class="bubble-file" href={url} download={message.fileName}>
      <Paperclip size={14} /> {message.fileName ?? t("chat.file")}
      {message.fileSize !== undefined && <span> ({formatBytes(message.fileSize)})</span>}
    </a>
  );
}

export type ChatDisplay = "list" | "bubble";

/** Position of a message within a consecutive-message-from-same-sender run,
 * used in bubble mode to decide whether to show the avatar/name header. */
export type BubbleGroupPos = "single" | "first" | "middle" | "last";

const GROUP_WINDOW_MS = 5 * 60_000;

// Two messages "join" into the same consecutive-message group when they're
// from the same sender, neither is a deleted tombstone (a delete always
// breaks the visual run), and they land within 5 minutes of each other.
function joins(a: ChatMessage | undefined, b: ChatMessage | undefined): boolean {
  return (
    !!a &&
    !!b &&
    !a.deleted &&
    !b.deleted &&
    a.fromId === b.fromId &&
    Math.abs(b.timestamp - a.timestamp) <= GROUP_WINDOW_MS
  );
}

export function groupPosAt(messages: ChatMessage[], i: number): BubbleGroupPos {
  const withPrev = joins(messages[i - 1], messages[i]);
  const withNext = joins(messages[i], messages[i + 1]);
  if (withPrev && withNext) return "middle";
  if (withPrev) return "last";
  if (withNext) return "first";
  return "single";
}

export function MessageBubble(props: {
  message: ChatMessage;
  isOwn: boolean;
  localId: string | null;
  display: ChatDisplay;
  /** DID→profile directory, so the sender's shared name + avatar are shown. */
  directory: ProfileDirectory;
  /** Bubble-mode grouping position within a consecutive run from the same
   * sender; controls avatar/name header visibility. Defaults to "single". */
  groupPos?: BubbleGroupPos;
  onToggleReaction: (targetId: string, emoji: string) => void;
  onEditMessage: (targetId: string, text: string) => void;
  onDeleteMessage: (targetId: string) => void;
  /** Open the sender's read-only profile card (fromId is their DID). */
  onOpenProfile: (did: string, fallbackName: string) => void;
  /** Maximize this post's media in the room's shared gallery Lightbox. */
  onMaximize: (messageId: string) => void;
}) {
  const {
    message,
    isOwn,
    localId,
    display,
    directory,
    groupPos = "single",
    onToggleReaction,
    onEditMessage,
    onDeleteMessage,
    onOpenProfile,
    onMaximize,
  } = props;
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const editRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (editing) editRef.current?.focus();
  }, [editing]);

  const { name, avatarCid } = identityFor(directory, message.fromId, message.fromName);
  const openProfile = () => onOpenProfile(message.fromId, name);

  // Tombstone: the author removed this message. Keep the row (thread flow),
  // drop everything interactive.
  if (message.deleted) {
    return display === "list" ? (
      <div class="msg-row msg-row--deleted">
        <p class="msg-deleted">{t("chat.messageDeleted")}</p>
      </div>
    ) : (
      <div class={`bubble-row bubble-row--${groupPos}${isOwn ? " bubble-row--own" : ""}`}>
        {!isOwn && <span class="bubble-avatar-gap" aria-hidden="true" />}
        <p class="msg-deleted msg-deleted--bubble">{t("chat.messageDeleted")}</p>
      </div>
    );
  }

  function startEdit() {
    setDraft(message.text ?? "");
    setEditing(true);
  }

  function saveEdit() {
    const text = draft.trim();
    if (text && text !== message.text) onEditMessage(message.id, text);
    setEditing(false);
  }

  // Shift-click deletes immediately (power-user shortcut); a plain click opens
  // the in-app confirmation modal.
  function requestDelete(e: MouseEvent) {
    if (e.shiftKey) onDeleteMessage(message.id);
    else setConfirmingDelete(true);
  }

  const reactions = (
    <ReactionBar
      reactions={message.reactions ?? []}
      localId={localId}
      onToggle={(emoji) => onToggleReaction(message.id, emoji)}
    />
  );
  // Own messages get quiet hover controls: edit only for plain text (media/file
  // bodies aren't editable — see usePostStream.editPost), delete for any kind.
  const actions = isOwn && (
    <span class="msg-actions">
      {message.kind === "text" && (
        <button
          type="button"
          class="msg-action-btn"
          aria-label={t("common.edit")}
          title={t("common.edit")}
          onClick={startEdit}
        >
          <Pencil size={13} />
        </button>
      )}
      <button
        type="button"
        class="msg-action-btn msg-action-btn--danger"
        aria-label={t("common.delete")}
        title={t("chat.deleteHint")}
        onClick={requestDelete}
      >
        <Trash2 size={13} />
      </button>
      {confirmingDelete && (
        <ConfirmDialog
          title={t("chat.deleteMessageTitle")}
          message={t("chat.deleteMessageConfirm")}
          confirmLabel={t("common.deleteConfirm")}
          onConfirm={() => {
            onDeleteMessage(message.id);
            setConfirmingDelete(false);
          }}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </span>
  );
  const editedMark = message.editedAt !== undefined && (
    <span class="msg-edited">{t("common.edited")}</span>
  );
  const firstUrl =
    message.kind === "text" ? extractHttpUrls(message.text ?? "")[0] : undefined;
  const body = editing ? (
    <div class="msg-edit">
      <textarea
        ref={editRef}
        class="msg-edit-input"
        rows={2}
        value={draft}
        onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
        onKeyDown={(e) => {
          // IME composition (e.g. Japanese) commits kana→kanji conversion via
          // Enter — that keystroke must not also save the edit.
          if (e.isComposing || e.keyCode === 229) return;
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            saveEdit();
          } else if (e.key === "Escape") {
            setEditing(false);
          }
        }}
      />
      <div class="msg-edit-actions">
        <button type="button" class="msg-edit-btn msg-edit-btn--save" onClick={saveEdit}>
          {t("common.save")}
        </button>
        <button type="button" class="msg-edit-btn" onClick={() => setEditing(false)}>
          {t("common.cancel")}
        </button>
      </div>
    </div>
  ) : message.kind === "text" ? (
    <>
      <div class={`${display === "list" ? "msg-text" : "bubble-text"} md-body`}>
        <MarkdownView text={message.text ?? ""} />
      </div>
      {/* Only the first URL gets a card — a wall of cards for a multi-link
          message would overwhelm the bubble. */}
      {firstUrl && <LinkPreviewCard url={firstUrl} />}
    </>
  ) : (
    <MediaContent message={message} onMaximize={onMaximize} />
  );

  // List style: avatar + name + text row for every message (own included).
  if (display === "list") {
    return (
      <div class={`msg-row ${isOwn ? "msg-row--own" : ""}`}>
        <button
          type="button"
          class="avatar-btn"
          aria-label={t("chat.viewProfile", { name })}
          onClick={openProfile}
        >
          <Avatar id={message.fromId} name={name} avatarCid={avatarCid} size={38} />
        </button>
        <div class="msg-body">
          <div class="msg-head">
            <button type="button" class="name-btn" onClick={openProfile}>
              <span class="msg-name">{name}</span>
            </button>
            <span class="msg-time">{formatTime(message.timestamp)}</span>
            {editedMark}
            <span class="bubble-verified" title={t("chat.verifiedAs", { did: shortDid(message.fromId) })}>
              <BadgeCheck size={13} />
            </span>
            {actions}
          </div>
          {body}
          {reactions}
        </div>
      </div>
    );
  }

  // Bubble style: left/right chat bubbles, grouped by consecutive-sender runs.
  const showHead = groupPos === "first" || groupPos === "single";
  const isMediaBody =
    !editing &&
    message.kind !== "text" &&
    (message.mimeType?.startsWith("image/") || message.mimeType?.startsWith("video/"));
  return (
    <div class={`bubble-row bubble-row--${groupPos}${isOwn ? " bubble-row--own" : ""}`}>
      {!isOwn &&
        (showHead ? (
          <button
            type="button"
            class="avatar-btn"
            aria-label={t("chat.viewProfile", { name })}
            onClick={openProfile}
          >
            <Avatar id={message.fromId} name={name} avatarCid={avatarCid} size={32} />
          </button>
        ) : (
          <span class="bubble-avatar-gap" aria-hidden="true" />
        ))}
      <div class="bubble-col">
        {!isOwn && showHead && (
          <button type="button" class="name-btn bubble-name-btn" onClick={openProfile}>
            <span class="bubble-name">{name}</span>
          </button>
        )}
        <div class="bubble-line">
          <div class={`bubble ${isOwn ? "bubble--own" : "bubble--other"}${isMediaBody ? " bubble--media" : ""}`}>
            {body}
          </div>
          <div class="bubble-meta">
            {editedMark}
            <span class="bubble-verified" title={t("chat.verifiedAs", { did: shortDid(message.fromId) })}>
              <BadgeCheck size={12} />
            </span>
            <span class="bubble-time">{formatTime(message.timestamp)}</span>
          </div>
        </div>
        <div class="bubble-under">
          {reactions}
          {actions}
        </div>
      </div>
    </div>
  );
}
