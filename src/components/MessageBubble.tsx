import { useEffect, useRef, useState } from "preact/hooks";
import { Paperclip, BadgeCheck, Pencil, Trash2, Maximize2, Reply, CornerUpLeft } from "lucide-preact";
import type { ChatMessage } from "../lib/chatStore";
import { resolveStorageUrl, invalidateStorageUrl } from "../lib/mediaUrl";
import { formatBytes, formatTime, shortDid } from "../lib/util";
import { identityFor, type ProfileDirectory } from "../lib/profileDirectory";
import { useT, type TFunc } from "../lib/i18n";
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

const REPLY_SNIPPET_MAX_CHARS = 60;

/**
 * Plain-text, truncated preview of a message for a quote/reply header. Always
 * plain text — never routed through MarkdownView — because a quote only needs
 * to identify the message, and nesting peer-supplied markdown inside a quote
 * invites layout abuse (see MarkdownView's own XSS-mitigation rationale).
 */
export function replySnippet(message: ChatMessage, t: TFunc): string {
  if (message.deleted) return t("chat.messageDeleted");
  if (message.kind === "text") {
    const flat = (message.text ?? "").replace(/\s+/g, " ").trim();
    return flat.length > REPLY_SNIPPET_MAX_CHARS
      ? flat.slice(0, REPLY_SNIPPET_MAX_CHARS) + "…"
      : flat;
  }
  // media/file kinds have no text body worth quoting — name the attachment.
  return message.fileName ?? t("chat.file");
}

export type ChatDisplay = "list" | "bubble";

/** Position of a message within a consecutive-message-from-same-sender run,
 * used in bubble mode to decide whether to show the avatar/name header. */
export type BubbleGroupPos = "single" | "first" | "middle" | "last";

const GROUP_WINDOW_MS = 5 * 60_000;

// Two messages "join" into the same consecutive-message group when they're
// from the same sender, neither is a deleted tombstone (a delete always
// breaks the visual run), the later one isn't a reply (a reply carries its
// own quoted header, so it must never collapse into a headerless "middle"/
// "last" row), and they land within 5 minutes of each other.
function joins(a: ChatMessage | undefined, b: ChatMessage | undefined): boolean {
  return (
    !!a &&
    !!b &&
    !a.deleted &&
    !b.deleted &&
    !b.parentId &&
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
  /** The message this one replies to, already resolved by ChatWindow (it holds
   * the full room list, so this component never looks its own parent up).
   * Only meaningful when `message.parentId` is set; undefined there means the
   * original isn't available locally (aged out of the post cap, or never
   * received) — rendered as a "not available" placeholder, never blank. */
  parentMessage?: ChatMessage;
  onToggleReaction: (targetId: string, emoji: string) => void;
  /** Start composing a reply to this message (ChatWindow owns the reply-target state). */
  onReply: (targetId: string) => void;
  onEditMessage: (targetId: string, text: string) => void;
  onDeleteMessage: (targetId: string) => void;
  /** Open the sender's read-only profile card (fromId is their DID). */
  onOpenProfile: (did: string, fallbackName: string) => void;
  /** Maximize this post's media in the room's shared gallery Lightbox. */
  onMaximize: (messageId: string) => void;
  /** Scroll+flash the quoted original into view; omitted quote headers still render (just inert on click). */
  onJumpToMessage?: (id: string) => void;
  /** True for a brief window right after `onJumpToMessage` lands here — drives the flash highlight (see chat.css). */
  flash?: boolean;
}) {
  const {
    message,
    isOwn,
    localId,
    display,
    directory,
    groupPos = "single",
    parentMessage,
    onToggleReaction,
    onReply,
    onEditMessage,
    onDeleteMessage,
    onOpenProfile,
    onMaximize,
    onJumpToMessage,
    flash = false,
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
      <div
        class={`msg-row msg-row--deleted${flash ? " msg-row--flash" : ""}`}
        data-message-id={message.id}
      >
        <p class="msg-deleted">{t("chat.messageDeleted")}</p>
      </div>
    ) : (
      <div
        class={`bubble-row bubble-row--${groupPos}${isOwn ? " bubble-row--own" : ""}${flash ? " bubble-row--flash" : ""}`}
        data-message-id={message.id}
      >
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
  // Reply is available on any message (own or not) — it only ever sets
  // `parentId` on a brand new post of one's own, so it needs no author check.
  // Edit/delete stay own-message-only: edit only for plain text (media/file
  // bodies aren't editable — see usePostStream.editPost), delete for any kind.
  const actions = (
    <span class="msg-actions">
      <button
        type="button"
        class="msg-action-btn"
        aria-label={t("chat.replyAction")}
        title={t("chat.replyAction")}
        onClick={() => onReply(message.id)}
      >
        <Reply size={13} />
      </button>
      {isOwn && (
        <>
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
        </>
      )}
    </span>
  );
  // Quoted header shown above a reply's own content. `parentMessage` is
  // resolved by ChatWindow (it holds every message; this component never
  // looks its own parent up) — undefined means the original isn't available
  // locally, which degrades to a fixed placeholder rather than a blank/crash.
  const quotedHeader = message.parentId != null && (
    <button
      type="button"
      class="reply-quote"
      onClick={() => onJumpToMessage?.(message.parentId!)}
      aria-label={t("chat.replyJump")}
      title={t("chat.replyJump")}
    >
      <CornerUpLeft size={12} class="reply-quote-icon" aria-hidden="true" />
      {parentMessage ? (
        <span class="reply-quote-body">
          <span class="reply-quote-name">
            {identityFor(directory, parentMessage.fromId, parentMessage.fromName).name}
          </span>
          <span class="reply-quote-snippet">{replySnippet(parentMessage, t)}</span>
        </span>
      ) : (
        <span class="reply-quote-body reply-quote-missing">{t("chat.replyOriginalMissing")}</span>
      )}
    </button>
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
      <div
        class={`msg-row ${isOwn ? "msg-row--own" : ""}${flash ? " msg-row--flash" : ""}`}
        data-message-id={message.id}
      >
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
          {quotedHeader}
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
    <div
      class={`bubble-row bubble-row--${groupPos}${isOwn ? " bubble-row--own" : ""}${flash ? " bubble-row--flash" : ""}`}
      data-message-id={message.id}
    >
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
        {quotedHeader}
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
