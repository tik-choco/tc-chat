import { useEffect, useRef, useState } from "preact/hooks";
import { createPortal } from "preact/compat";
import type { JSX } from "preact";
import { ChevronLeft, ChevronRight, Download, RefreshCw, Trash2, X } from "lucide-preact";
import { formatBytes, formatTime } from "../lib/util";
import { resolveStorageUrl, invalidateStorageUrl } from "../lib/mediaUrl";
import { useT } from "../lib/i18n";
import type { Reaction } from "../lib/chatStore";
import type { PostEnc } from "../crypto/postCipher";
import { Avatar } from "./Avatar";
import { ReactionBar } from "./ReactionBar";
import { ConfirmDialog } from "./ConfirmDialog";

// Auto-hide the chrome after this long without pointer movement, so the media
// gets the whole screen (mirrors tc-storage's ExpandedPreview).
const IDLE_DELAY_MS = 2500;
// Throttle wheel-driven navigation so one flick advances a single item
// (tc-storage uses ~420ms; a hair under half a second reads well).
const WHEEL_THROTTLE_MS = 400;

/** One maximizable piece of media: a chat/board attachment (resolved from its
 * `cid`) or a live screen share (`stream`, bound to the <video> via a ref). */
export interface LightboxItem {
  /** Stable identity — a message id, or a screen track id. */
  key: string;
  kind: "image" | "video";
  /** Chat media: resolved to a blob URL via resolveStorageUrl(cid, enc). */
  cid?: string;
  /** Content-key envelope when this item's cid is encrypted (see postCipher).
   * Absent = legacy plaintext cid, resolved as-is. */
  enc?: PostEnc;
  /** A live screen share (bound via ref, no URL). */
  stream?: MediaStream;
  fileName?: string;
  size?: number;
  /** Poster identity, already resolved via the profile directory. */
  fromId?: string;
  fromName?: string;
  avatarCid?: string;
  /** Post time (epoch ms), rendered via formatTime. */
  timestamp?: number;
  reactions?: Reaction[];
  /** True when the local user may delete this item. */
  canDelete?: boolean;
}

/**
 * A full-viewport preview overlay modelled on ../tc-storage's ExpandedPreview:
 * a dark, edge-to-edge modal (portaled to <body>) with a top bar
 * (name · index · size · Single/Flow · download · close) over the media, chrome
 * that fades when the pointer goes idle, and — when there's more than one item —
 * previous/next navigation (arrows, ◀ ▶ buttons, wheel, swipe) plus a "Flow"
 * mode that stacks every item in one vertical scroll.
 *
 * The gallery is a list + index: `index` is owned by the parent (the chat/board
 * media set), so navigation just calls `onIndexChange`.
 */
export function Lightbox(props: {
  items: LightboxItem[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  /** Local node id, for ReactionBar's "mine" highlight. */
  localId?: string | null;
  /** Present when the surface supports reactions; key is LightboxItem.key. */
  onToggleReaction?: (key: string, emoji: string) => void;
  /** Present when the surface supports deletion; fires only after the user confirms. */
  onDelete?: (key: string) => void;
}): JSX.Element | null {
  const { items, index, onIndexChange, onClose, localId, onToggleReaction, onDelete } = props;
  const t = useT();
  const [mode, setMode] = useState<"single" | "flow">("single");
  const [idle, setIdle] = useState(false);
  // Guards the delete confirm dialog, and doubles as the Escape-key gate below
  // (the Lightbox's own Escape handler must not close it while confirming).
  const [confirmDelete, setConfirmDelete] = useState(false);
  // cid → resolved blob URL. resolveStorageUrl caches globally, but we mirror
  // the results into state so a resolve triggers a re-render.
  const [urls, setUrls] = useState<Record<string, string>>({});
  const urlsRef = useRef(urls);
  urlsRef.current = urls;
  // cid → true once a resolve attempt has failed (author offline, content
  // unreachable, decrypt failure, ...). Sticky until a manual retry clears
  // it, so the effect below doesn't auto-retry on every re-render.
  const [errored, setErrored] = useState<Record<string, boolean>>({});
  const erroredRef = useRef(errored);
  erroredRef.current = errored;

  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const flowBodyRef = useRef<HTMLDivElement | null>(null);
  const flowItemRefs = useRef<Record<string, HTMLElement | null>>({});
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const wheelLastAtRef = useRef(0);
  const wheelDeltaRef = useRef(0);

  const canNavigate = items.length > 1;
  const flowEnabled = mode === "flow" && canNavigate;
  const current = items[index] as LightboxItem | undefined;
  const title =
    current?.fileName || (current?.kind === "video" ? t("media.video") : t("media.image"));

  // Clamp to [0, len-1] — no wrap (the ◀ ▶ buttons disable at the ends).
  function goTo(i: number) {
    const clamped = Math.max(0, Math.min(items.length - 1, i));
    if (clamped !== index) onIndexChange(clamped);
  }
  function onPrev() {
    goTo(index - 1);
  }
  function onNext() {
    goTo(index + 1);
  }

  // Resolve the current item's URL plus its immediate neighbours (so nav is
  // instant); in flow mode resolve everything since it's all on screen.
  useEffect(() => {
    let cancelled = false;
    const needed = flowEnabled
      ? items
      : [items[index - 1], items[index], items[index + 1]];
    for (const item of needed) {
      if (!item?.cid) continue;
      const cid = item.cid;
      // Already resolved, or already failed (waiting on a manual retry) —
      // don't re-issue the fetch just because this effect re-ran.
      if (urlsRef.current[cid] || erroredRef.current[cid]) continue;
      resolveStorageUrl(cid, item.enc)
        .then((url) => {
          if (cancelled) return;
          setUrls((prev) => (prev[cid] ? prev : { ...prev, [cid]: url }));
        })
        .catch(() => {
          if (cancelled) return;
          setErrored((prev) => (prev[cid] ? prev : { ...prev, [cid]: true }));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [items, index, flowEnabled]);

  // Retry: drop the failed cache entry and the sticky error flag, then
  // resolve again from scratch — the poster may be back online, or a relay
  // may now have the content.
  function retryItem(item: LightboxItem) {
    if (!item.cid) return;
    const cid = item.cid;
    invalidateStorageUrl(cid);
    setErrored((prev) => {
      if (!(cid in prev)) return prev;
      const next = { ...prev };
      delete next[cid];
      return next;
    });
    resolveStorageUrl(cid, item.enc)
      .then((url) => setUrls((prev) => ({ ...prev, [cid]: url })))
      .catch(() => setErrored((prev) => ({ ...prev, [cid]: true })));
  }

  // Screen shares carry a live MediaStream, not a URL — bind it to the current
  // single-view <video> the same way RemoteScreenStage does. (Streams only ever
  // come as a lone item, so they never appear in flow mode.)
  useEffect(() => {
    if (!flowEnabled && current?.kind === "video" && current.stream && videoRef.current) {
      videoRef.current.srcObject = current.stream;
    }
  }, [flowEnabled, current?.key, current?.stream]);

  // Escape closes; ArrowLeft/ArrowRight navigate in single mode. While the
  // delete ConfirmDialog is open it installs its own Escape listener (to
  // cancel the confirm) — both listeners fire on the same keydown, so this
  // one must no-op instead of also closing the whole Lightbox underneath it.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (confirmDelete) return;
        onClose();
      } else if (canNavigate && !flowEnabled && e.key === "ArrowLeft") {
        goTo(index - 1);
      } else if (canNavigate && !flowEnabled && e.key === "ArrowRight") {
        goTo(index + 1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, canNavigate, flowEnabled, index, items.length, confirmDelete]);

  // Lock body scroll while open; restore on unmount.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  // Fade the chrome after a few idle seconds; any pointer movement wakes it.
  useEffect(() => {
    function wake() {
      setIdle(false);
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(() => setIdle(true), IDLE_DELAY_MS);
    }
    wake();
    window.addEventListener("mousemove", wake);
    window.addEventListener("touchstart", wake);
    return () => {
      window.removeEventListener("mousemove", wake);
      window.removeEventListener("touchstart", wake);
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, []);

  // On entering flow, jump the current item into view.
  useEffect(() => {
    if (!flowEnabled || !current) return;
    flowItemRefs.current[current.key]?.scrollIntoView({ block: "start" });
  }, [flowEnabled, current?.key]);

  // A pending delete confirmation belongs to the item that was current when
  // it opened — drop it on navigation so it doesn't stick to the new item.
  useEffect(() => {
    setConfirmDelete(false);
  }, [current?.key]);

  if (!current) return null;

  // Close only when the empty backdrop is clicked (the modal shell or the body
  // letterbox) — never when the media or a header/nav button is clicked.
  function closeFromEmptySpace(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  // Single-mode navigation gestures. Flow mode scrolls naturally, so both are
  // no-ops there.
  function handleWheel(e: WheelEvent) {
    if (flowEnabled || !canNavigate) return;
    const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (Math.abs(delta) < 4) return;
    e.preventDefault();
    const now = Date.now();
    if (now - wheelLastAtRef.current < WHEEL_THROTTLE_MS) return;
    wheelDeltaRef.current += delta;
    if (Math.abs(wheelDeltaRef.current) < 48) return;
    if (wheelDeltaRef.current > 0) onNext();
    else onPrev();
    wheelDeltaRef.current = 0;
    wheelLastAtRef.current = now;
  }
  function handleTouchStart(e: TouchEvent) {
    if (flowEnabled) {
      touchStartRef.current = null;
      return;
    }
    const t = e.touches[0];
    touchStartRef.current = t ? { x: t.clientX, y: t.clientY } : null;
  }
  function handleTouchEnd(e: TouchEvent) {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (flowEnabled || !canNavigate || !start) return;
    const t = e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    // A mostly-horizontal swipe over a threshold navigates.
    if (Math.abs(dx) < 52 || Math.abs(dx) < Math.abs(dy) * 1.25) return;
    if (dx > 0) onPrev();
    else onNext();
  }

  function renderMediaError(item: LightboxItem) {
    // No dedicated CSS for this new state (out of this change's file scope) —
    // reuse .lightbox-loading for readable-on-dark text color/size, and lay
    // the two lines out inline rather than leaving them unstyled.
    return (
      <div class="lightbox-error" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
        <p class="lightbox-loading lightbox-error-text">{t("common.mediaUnavailable")}</p>
        <button type="button" class="lightbox-btn" onClick={() => retryItem(item)}>
          <RefreshCw size={16} /> {t("common.retry")}
        </button>
      </div>
    );
  }

  function renderSingleMedia(item: LightboxItem) {
    const alt = item.fileName || (item.kind === "video" ? t("media.video") : t("media.image"));
    if (item.cid && errored[item.cid]) return renderMediaError(item);
    if (item.kind === "image") {
      const url = item.cid ? urls[item.cid] : undefined;
      return url ? (
        <img class="lightbox-media" src={url} alt={alt} />
      ) : (
        <p class="lightbox-loading">{t("common.loading")}</p>
      );
    }
    // Video: a live stream binds via ref; a stored clip plays from its URL.
    if (item.stream) {
      return <video ref={videoRef} class="lightbox-media" controls autoPlay playsInline />;
    }
    const url = item.cid ? urls[item.cid] : undefined;
    return url ? (
      <video class="lightbox-media" src={url} controls autoPlay playsInline />
    ) : (
      <p class="lightbox-loading">{t("common.loading")}</p>
    );
  }

  function renderFlowMedia(item: LightboxItem) {
    if (item.cid && errored[item.cid]) return renderMediaError(item);
    const url = item.cid ? urls[item.cid] : undefined;
    const alt = item.fileName || (item.kind === "video" ? t("media.video") : t("media.image"));
    if (!url) return <p class="lightbox-loading">{t("common.loading")}</p>;
    return item.kind === "image" ? (
      <img class="lightbox-media lightbox-flow-media" src={url} alt={alt} />
    ) : (
      <video class="lightbox-media lightbox-flow-media" src={url} controls playsInline />
    );
  }

  const currentUrl = current.cid ? urls[current.cid] : undefined;
  const canDownload = Boolean(current.cid && currentUrl);

  // Portal to <body> so the fixed overlay escapes any ancestor that establishes
  // a containing block / stacking context (message rows animate `transform`,
  // which would otherwise trap the overlay inside the chat column).
  return createPortal(
    <section
      class={`lightbox-modal ${flowEnabled ? "lightbox-modal--flow" : ""} ${
        idle ? "lightbox-modal--idle" : ""
      }`}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={closeFromEmptySpace}
    >
      <header class="lightbox-top">
        <div class="lightbox-meta">
          <span class="lightbox-label">{t("media.preview")}</span>
          <strong class="lightbox-name">{title}</strong>
          <small class="lightbox-size">
            {t("media.counter", { current: index + 1, total: items.length })}
            {current.size !== undefined ? ` · ${formatBytes(current.size)}` : ""}
          </small>
        </div>
        <div class="lightbox-actions">
          {canNavigate && (
            <div class="lightbox-mode-toggle" role="group" aria-label={t("media.displayMode")}>
              <button
                type="button"
                class={mode === "single" ? "selected" : ""}
                aria-pressed={mode === "single"}
                onClick={() => setMode("single")}
              >
                {t("media.singleMode")}
              </button>
              <button
                type="button"
                class={mode === "flow" ? "selected" : ""}
                aria-pressed={mode === "flow"}
                onClick={() => setMode("flow")}
              >
                {t("media.flowMode")}
              </button>
            </div>
          )}
          {current.canDelete && onDelete && (
            <button
              type="button"
              class="lightbox-btn"
              title={t("common.delete")}
              aria-label={t("common.delete")}
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 size={18} />
            </button>
          )}
          {canDownload && (
            <a
              class="lightbox-btn"
              href={currentUrl}
              download={current.fileName || title}
              title={t("media.download")}
              aria-label={t("media.download")}
            >
              <Download size={18} />
            </a>
          )}
          <button
            type="button"
            class="lightbox-btn"
            title={t("media.closeEsc")}
            aria-label={t("common.close")}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
      </header>

      {!flowEnabled && canNavigate && (
        <button
          type="button"
          class="lightbox-nav lightbox-nav--prev"
          onClick={onPrev}
          disabled={index <= 0}
          title={t("media.prev")}
          aria-label={t("media.prev")}
        >
          <ChevronLeft size={26} />
        </button>
      )}

      <div
        ref={flowBodyRef}
        class={`lightbox-body ${flowEnabled ? "lightbox-body--flow" : ""}`}
        onClick={closeFromEmptySpace}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {flowEnabled ? (
          <div class="lightbox-flow-list">
            {items.map((item) => (
              <article
                key={item.key}
                data-key={item.key}
                class={`lightbox-flow-item ${item.key === current.key ? "current" : ""}`}
                ref={(el) => {
                  flowItemRefs.current[item.key] = el as HTMLElement | null;
                }}
              >
                {renderFlowMedia(item)}
              </article>
            ))}
          </div>
        ) : (
          renderSingleMedia(current)
        )}
      </div>

      {!flowEnabled && canNavigate && (
        <button
          type="button"
          class="lightbox-nav lightbox-nav--next"
          onClick={onNext}
          disabled={index >= items.length - 1}
          title={t("media.next")}
          aria-label={t("media.next")}
        >
          <ChevronRight size={26} />
        </button>
      )}

      {/* Poster identity + reactions for the current item. Single mode only
          (flow mode stacks every item, so there's no one "current" bar to
          anchor it to) and only when the caller actually gave us something
          to show — chat's usage passes none of these fields, so this stays
          absent there and the Lightbox renders exactly as it did before. */}
      {!flowEnabled &&
        (current.fromName ||
          current.timestamp !== undefined ||
          (onToggleReaction && current.reactions)) && (
          <footer class="lightbox-bottom">
            <div class="lightbox-bottom-identity">
              {current.fromName && (
                <Avatar
                  id={current.fromId ?? current.fromName}
                  name={current.fromName}
                  avatarCid={current.avatarCid}
                  size={24}
                />
              )}
              {current.fromName && (
                <span class="lightbox-bottom-name">{current.fromName}</span>
              )}
              {current.timestamp !== undefined && (
                <span class="lightbox-bottom-time">{formatTime(current.timestamp)}</span>
              )}
            </div>
            {onToggleReaction && (
              <ReactionBar
                reactions={current.reactions ?? []}
                localId={localId ?? null}
                onToggle={(emoji) => onToggleReaction(current.key, emoji)}
              />
            )}
          </footer>
        )}

      {confirmDelete && onDelete && (
        <ConfirmDialog
          title={t("common.delete")}
          message={t("media.galleryDeleteConfirm")}
          confirmLabel={t("common.deleteConfirm")}
          onConfirm={() => {
            onDelete(current.key);
            setConfirmDelete(false);
          }}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </section>,
    document.body,
  );
}
