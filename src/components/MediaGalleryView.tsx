import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import { Images, Upload, Archive, Trash2 } from "lucide-preact";
import type { PostNode } from "../lib/chatStore";
import { identityFor, type ProfileDirectory } from "../lib/profileDirectory";
import { loadTcStorageFiles, type TcStorageFileEntry } from "../interop/tcStorageFiles";
import { resolveStorageUrl } from "../lib/mediaUrl";
import { formatTime } from "../lib/util";
import { useT } from "../lib/i18n";
import { Avatar } from "./Avatar";
import { ReactionBar } from "./ReactionBar";
import { ConfirmDialog } from "./ConfirmDialog";
import { StoragePicker } from "./StoragePicker";
import { Lightbox, type LightboxItem } from "./Lightbox";

/** A tile is gallery-worthy when it's still live (not tombstoned) and its body
 * is an image or a video — the same predicate ChatWindow uses to build its
 * Lightbox item list (see ChatWindow.tsx's `mediaItems`), minus the kind
 * check since every post on this surface is already media/file. */
function isGalleryMedia(item: PostNode): boolean {
  return !item.deleted && (item.mimeType?.startsWith("image/") || item.mimeType?.startsWith("video/")) === true;
}

function GalleryTile(props: {
  item: PostNode;
  isOwn: boolean;
  localId: string | null;
  directory: ProfileDirectory;
  onOpen: () => void;
  onToggleReaction: (emoji: string) => void;
  onDelete: () => void;
}) {
  const { item, isOwn, localId, directory, onOpen, onToggleReaction, onDelete } = props;
  const t = useT();
  const [url, setUrl] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    let cancelled = false;
    resolveStorageUrl(item.cid, item.mimeType)
      .then((u) => !cancelled && setUrl(u))
      .catch(() => {
        // Leave the placeholder up; the tile just never resolves.
      });
    return () => {
      cancelled = true;
    };
  }, [item.cid, item.mimeType]);

  const { name, avatarCid } = identityFor(directory, item.fromId, item.fromName);
  const isVideo = item.mimeType?.startsWith("video/");
  const alt = item.fileName ?? (isVideo ? t("media.video") : t("media.image"));

  return (
    <article class="gallery-tile">
      <button
        type="button"
        class="gallery-tile-media"
        onClick={onOpen}
        aria-label={t("chat.viewFullscreen", { name: alt })}
        title={t("chat.fullscreen")}
      >
        {url ? (
          isVideo ? (
            <video class="gallery-tile-thumb" src={url} preload="metadata" muted playsInline />
          ) : (
            <img class="gallery-tile-thumb" src={url} alt={alt} />
          )
        ) : (
          <span class="gallery-tile-placeholder">{t("common.loading")}</span>
        )}
      </button>
      <div class="gallery-tile-meta">
        <Avatar id={item.fromId} name={name} avatarCid={avatarCid} size={22} />
        <span class="gallery-tile-name">{t("media.gallerySharedBy", { name })}</span>
        <span class="gallery-tile-time">{formatTime(item.timestamp)}</span>
        {isOwn && (
          <button
            type="button"
            class="gallery-tile-delete"
            aria-label={t("common.delete")}
            title={t("common.delete")}
            onClick={() => setConfirmingDelete(true)}
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
      <ReactionBar reactions={item.reactions ?? []} localId={localId} onToggle={onToggleReaction} />
      {confirmingDelete && (
        <ConfirmDialog
          title={t("common.delete")}
          message={t("media.galleryDeleteConfirm")}
          confirmLabel={t("common.deleteConfirm")}
          onConfirm={() => {
            onDelete();
            setConfirmingDelete(false);
          }}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </article>
  );
}

/** The room-shared media gallery: an image/video grid over the "gallery"
 * surface of the shared post engine (see useMediaGallery), riding the same
 * signed post-stream plumbing as chat, the board, and the calendar. */
export function MediaGalleryView(props: {
  roomName: string;
  localNodeId: string | null;
  items: PostNode[];
  ready: boolean;
  directory: ProfileDirectory;
  onAddFiles: (files: File[]) => void;
  /** May reject: a tc-storage file can't be posted when none of the local
   * keys open its encrypted envelope (see tcStorageContent.ts). */
  onAddStoredFile: (entry: TcStorageFileEntry) => void | Promise<void>;
  onToggleReaction: (targetId: string, emoji: string) => void;
  onDelete: (targetId: string) => void;
}) {
  const {
    roomName,
    localNodeId,
    items,
    ready,
    directory,
    onAddFiles,
    onAddStoredFile,
    onToggleReaction,
    onDelete,
  } = props;
  const t = useT();
  const [showStoragePicker, setShowStoragePicker] = useState(false);
  const [storedFileError, setStoredFileError] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const media = useMemo(
    () => items.filter(isGalleryMedia).sort((a, b) => a.timestamp - b.timestamp),
    [items],
  );

  // The Lightbox pages through this same media list; opening is tracked by
  // the target post's id (stable across re-renders) rather than a raw index —
  // the same pattern ChatWindow uses for its own mediaItems/Lightbox pairing.
  const lightboxItems = useMemo<LightboxItem[]>(
    () =>
      media.map((m) => ({
        key: m.id,
        kind: m.mimeType?.startsWith("video/") ? "video" : "image",
        cid: m.cid,
        fileName: m.fileName,
        size: m.fileSize,
      })),
    [media],
  );
  const [lightboxKey, setLightboxKey] = useState<string | null>(null);
  const lightboxIndex = lightboxItems.findIndex((i) => i.key === lightboxKey);

  // Read fresh each render so a file saved in tc-storage in another tab shows
  // up next time the picker is opened, without a background poll (mirrors
  // MessageInput's storageEntries), narrowed to image/video only.
  const storageEntries = loadTcStorageFiles().filter(
    (e) => e.mimeType.startsWith("image/") || e.mimeType.startsWith("video/"),
  );

  function handleFilePick(e: JSX.TargetedEvent<HTMLInputElement>) {
    const files = Array.from((e.target as HTMLInputElement).files ?? []);
    if (files.length > 0) onAddFiles(files);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleStoredFileSelect(entry: TcStorageFileEntry) {
    setStoredFileError(false);
    Promise.resolve(onAddStoredFile(entry)).catch(() => setStoredFileError(true));
    setShowStoragePicker(false);
  }

  return (
    <div class="board gallery">
      <header class="board-header">
        <div class="board-header-titles">
          <h2>
            <Images size={18} class="topbar-hash" /> {roomName}
          </h2>
        </div>
        <div class="gallery-header-actions">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,video/*"
            class="file-input"
            onChange={handleFilePick}
            disabled={!ready}
          />
          <button
            type="button"
            class="send-btn"
            disabled={!ready}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={16} /> {t("media.galleryUpload")}
          </button>
          <button
            type="button"
            class="pill-btn"
            disabled={!ready}
            onClick={() => setShowStoragePicker((v) => !v)}
          >
            <Archive size={16} /> {t("media.galleryAddFromStorage")}
          </button>
        </div>
      </header>

      {storedFileError && (
        <p class="gallery-status gallery-status--error">{t("media.galleryStoredFileFailed")}</p>
      )}

      {showStoragePicker && (
        <StoragePicker
          entries={storageEntries}
          onSelect={handleStoredFileSelect}
          onCancel={() => setShowStoragePicker(false)}
        />
      )}

      <div class="board-scroll gallery-scroll">
        {!ready ? (
          <p class="gallery-status">{t("common.loading")}</p>
        ) : media.length === 0 ? (
          <div class="board-empty gallery-empty">
            <Images size={32} class="gallery-empty-icon" />
            <p>{t("media.galleryEmpty")}</p>
            <p class="gallery-empty-hint">{t("media.galleryEmptyHint")}</p>
          </div>
        ) : (
          <div class="gallery-grid">
            {media.map((item) => (
              <GalleryTile
                key={item.id}
                item={item}
                isOwn={item.fromId === localNodeId}
                localId={localNodeId}
                directory={directory}
                onOpen={() => setLightboxKey(item.id)}
                onToggleReaction={(emoji) => onToggleReaction(item.id, emoji)}
                onDelete={() => onDelete(item.id)}
              />
            ))}
          </div>
        )}
      </div>

      {lightboxIndex >= 0 && (
        <Lightbox
          items={lightboxItems}
          index={lightboxIndex}
          onIndexChange={(i) => setLightboxKey(lightboxItems[i]?.key ?? null)}
          onClose={() => setLightboxKey(null)}
        />
      )}
    </div>
  );
}
