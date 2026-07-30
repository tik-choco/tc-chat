import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Fragment } from "preact";
import type { JSX } from "preact";
import {
  Menu,
  NotebookPen,
  Paperclip,
  Pencil,
  Trash2,
  Maximize2,
  Lock,
  X,
} from "lucide-preact";
import type { PersonalNote } from "../lib/personalNotesStore";
import type { PersonalNotesError } from "../hooks/usePersonalNotes";
import { resolveStorageUrl, invalidateStorageUrl } from "../lib/mediaUrl";
import { formatBytes, formatTime } from "../lib/util";
import { useT } from "../lib/i18n";
import { MarkdownView } from "./MarkdownView";
import { ConfirmDialog } from "./ConfirmDialog";
import { Lightbox, type LightboxItem } from "./Lightbox";
import { needsDateDivider, dateDividerLabel } from "./ChatWindow";

/**
 * Renders one note's pinned, encrypted attachment. Same resolve/retry shape as
 * MessageBubble's MediaContent, minus the "the author may be back online"
 * reasoning: a personal attachment is never fetched from a peer, so a failure
 * here means the local block store lost it (or the key no longer opens it),
 * and the retry is only worth offering for a transient read.
 */
function NoteAttachment(props: { note: PersonalNote; onMaximize: (id: string) => void }) {
  const { note, onMaximize } = props;
  const t = useT();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const cid = note.cid;

  useEffect(() => {
    if (!cid) return;
    let cancelled = false;
    setUrl(null);
    setError(false);
    resolveStorageUrl(cid, note.enc)
      .then((u) => !cancelled && setUrl(u))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [cid, note.enc]);

  function retry() {
    if (!cid) return;
    invalidateStorageUrl(cid);
    setError(false);
    setUrl(null);
    resolveStorageUrl(cid, note.enc)
      .then(setUrl)
      .catch(() => setError(true));
  }

  if (!cid) return null;
  if (error) {
    return (
      <button type="button" class="note-attach-error" onClick={retry} title={t("common.retry")}>
        {t("personal.attachmentFailed")}
      </button>
    );
  }
  if (!url) return <p class="note-attach-loading">{t("personal.loading")}</p>;

  const isImage = note.mimeType?.startsWith("image/");
  const isVideo = note.mimeType?.startsWith("video/");
  const alt = note.fileName ?? (isVideo ? "video" : "image");

  if (isImage) {
    return (
      <button
        type="button"
        class="note-media-zoom"
        aria-label={t("chat.viewFullscreen", { name: alt })}
        title={t("chat.fullscreen")}
        onClick={() => onMaximize(note.id)}
      >
        <img class="note-image" src={url} alt={alt} />
      </button>
    );
  }
  if (isVideo) {
    return (
      <div class="note-media-frame">
        <video class="note-video" src={url} controls playsInline />
        <button
          type="button"
          class="media-maximize-btn"
          aria-label={t("chat.viewFullscreen", { name: alt })}
          title={t("chat.fullscreen")}
          onClick={() => onMaximize(note.id)}
        >
          <Maximize2 size={15} />
        </button>
      </div>
    );
  }
  if (note.mimeType?.startsWith("audio/")) {
    return <audio class="note-audio" controls src={url} />;
  }
  return (
    <a class="note-file" href={url} download={note.fileName}>
      <Paperclip size={14} /> {note.fileName ?? t("chat.file")}
      {note.fileSize !== undefined && <span> ({formatBytes(note.fileSize)})</span>}
    </a>
  );
}

/** One note card: body (or inline editor), attachment, timestamp and actions. */
function NoteCard(props: {
  note: PersonalNote;
  onEdit: (id: string, text: string) => void;
  onRequestDelete: (id: string) => void;
  onMaximize: (id: string) => void;
}) {
  const { note, onEdit, onRequestDelete, onMaximize } = props;
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.text ?? "");

  function beginEdit() {
    setDraft(note.text ?? "");
    setEditing(true);
  }

  function commit() {
    onEdit(note.id, draft);
    setEditing(false);
  }

  return (
    <article class="note-card">
      {editing ? (
        <div class="note-edit">
          <textarea
            class="note-edit-input"
            value={draft}
            rows={3}
            autofocus
            onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
            // Enter commits, Shift+Enter adds a line — the same contract the
            // chat composer uses, so editing doesn't feel like a different app.
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                commit();
              } else if (e.key === "Escape") {
                setEditing(false);
              }
            }}
          />
          <div class="note-edit-actions">
            <button type="button" class="btn-ghost" onClick={() => setEditing(false)}>
              {t("common.cancel")}
            </button>
            <button type="button" class="send-btn" onClick={commit}>
              {t("common.save")}
            </button>
          </div>
        </div>
      ) : (
        <>
          {note.cid && <NoteAttachment note={note} onMaximize={onMaximize} />}
          {note.text && (
            <div class="note-body">
              <MarkdownView text={note.text} />
            </div>
          )}
        </>
      )}

      <footer class="note-meta">
        <time class="note-time">{formatTime(note.createdAt)}</time>
        {note.editedAt && <span class="note-edited">{t("personal.edited")}</span>}
        <span class="note-actions">
          <button
            type="button"
            class="note-action"
            title={t("personal.editNote")}
            aria-label={t("personal.editNote")}
            onClick={beginEdit}
          >
            <Pencil size={14} />
          </button>
          <button
            type="button"
            class="note-action note-action--danger"
            title={t("personal.deleteNote")}
            aria-label={t("personal.deleteNote")}
            onClick={() => onRequestDelete(note.id)}
          >
            <Trash2 size={14} />
          </button>
        </span>
      </footer>
    </article>
  );
}

export function PersonalChat(props: {
  notes: PersonalNote[];
  ready: boolean;
  error: PersonalNotesError | null;
  onDismissError: () => void;
  /** Mobile only: opens the off-canvas sidebar drawer (mirrors RoomContent). */
  onOpenSidebar: () => void;
  onAddText: (text: string) => void;
  onAddAttachment: (file: File) => void;
  onEditNote: (id: string, text: string) => void;
  onRemoveNote: (id: string) => void;
}) {
  const {
    notes,
    ready,
    error,
    onDismissError,
    onOpenSidebar,
    onAddText,
    onAddAttachment,
    onEditNote,
    onRemoveNote,
  } = props;
  const t = useT();
  const [draft, setDraft] = useState("");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Notes are appended, so the newest sits at the bottom — keep it in view the
  // way a chat log does. Depending on the count (not the array identity) means
  // an in-place edit doesn't yank the user back down.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [notes.length]);

  // needsDateDivider/dateDividerLabel are shared with the chat log, and both
  // read `.timestamp` — notes store the same instant as `createdAt`.
  const dividerInput = useMemo(
    () => notes.map((n) => ({ timestamp: n.createdAt })),
    [notes],
  );

  const mediaItems: LightboxItem[] = useMemo(
    () =>
      notes
        .filter(
          (n) =>
            n.cid &&
            (n.mimeType?.startsWith("image/") || n.mimeType?.startsWith("video/")),
        )
        .map((n) => ({
          key: n.id,
          kind: n.mimeType?.startsWith("video/") ? ("video" as const) : ("image" as const),
          cid: n.cid,
          enc: n.enc,
          fileName: n.fileName,
          size: n.fileSize,
          timestamp: n.createdAt,
        })),
    [notes],
  );
  const lightboxIndex = lightboxId ? mediaItems.findIndex((m) => m.key === lightboxId) : -1;

  function submit(e: JSX.TargetedEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!draft.trim() || !ready) return;
    onAddText(draft);
    setDraft("");
  }

  function pickFile(e: JSX.TargetedEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const file = input.files?.[0];
    if (file) onAddAttachment(file);
    // Reset so picking the same file twice in a row still fires a change event.
    input.value = "";
  }

  const errorMessage =
    error === "load"
      ? t("personal.errLoad")
      : error === "attach"
        ? t("personal.errAttach")
        : error === "save"
          ? t("personal.errSave")
          : null;

  return (
    <div class="room-content personal-chat">
      <header class="personal-header">
        <button
          type="button"
          class="room-tabs-menu"
          aria-label={t("chat.openMenu")}
          onClick={onOpenSidebar}
        >
          <Menu size={22} />
        </button>
        <span class="personal-header-mark">
          <NotebookPen size={18} />
        </span>
        <span class="personal-header-text">
          <span class="personal-title">{t("personal.title")}</span>
          <span class="personal-subtitle">
            <Lock size={11} aria-hidden="true" /> {t("personal.subtitle")}
          </span>
        </span>
      </header>

      {errorMessage && (
        <div class="personal-error" role="alert">
          <span>{errorMessage}</span>
          <button
            type="button"
            class="personal-error-close"
            aria-label={t("common.close")}
            onClick={onDismissError}
          >
            <X size={14} />
          </button>
        </div>
      )}

      <div class="personal-scroll" ref={scrollRef}>
        {notes.length === 0 ? (
          <div class="personal-empty">
            <p class="personal-empty-title">{t("personal.empty")}</p>
            <p class="personal-empty-note">{t("personal.privacyNote")}</p>
          </div>
        ) : (
          notes.map((note, i) => (
            <Fragment key={note.id}>
              {needsDateDivider(dividerInput, i) && (
                <div class="date-divider" role="separator">
                  <span class="date-divider-label">
                    {dateDividerLabel(note.createdAt, t)}
                  </span>
                </div>
              )}
              <NoteCard
                note={note}
                onEdit={onEditNote}
                onRequestDelete={setPendingDelete}
                onMaximize={setLightboxId}
              />
            </Fragment>
          ))
        )}
      </div>

      <form class="personal-composer" onSubmit={submit}>
        {/* .file-input is display:none (chat.css); a hidden input is still
            clickable programmatically, which is how the paperclip opens it. */}
        <input
          ref={fileRef}
          type="file"
          class="file-input"
          onChange={pickFile}
          aria-hidden="true"
          tabIndex={-1}
        />
        <button
          type="button"
          class="icon-btn"
          title={t("personal.attach")}
          aria-label={t("personal.attach")}
          disabled={!ready}
          onClick={() => fileRef.current?.click()}
        >
          <Paperclip size={18} />
        </button>
        <textarea
          class="personal-input"
          rows={1}
          value={draft}
          disabled={!ready}
          placeholder={t("personal.composerPlaceholder")}
          onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (draft.trim() && ready) {
                onAddText(draft);
                setDraft("");
              }
            }
          }}
        />
        <button type="submit" class="send-btn" disabled={!ready || !draft.trim()}>
          {t("personal.send")}
        </button>
      </form>

      {pendingDelete && (
        <ConfirmDialog
          title={t("personal.deleteConfirmTitle")}
          message={t("personal.deleteConfirmBody")}
          tone="danger"
          onConfirm={() => {
            onRemoveNote(pendingDelete);
            setPendingDelete(null);
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {lightboxId && lightboxIndex >= 0 && (
        <Lightbox
          items={mediaItems}
          index={lightboxIndex}
          onIndexChange={(i) => setLightboxId(mediaItems[i].key)}
          onClose={() => setLightboxId(null)}
        />
      )}
    </div>
  );
}
