import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Search, X } from "lucide-preact";
import type { PostSurface } from "../lib/chatStore";
import { searchPosts, type SearchHit, type SearchScopeRoom } from "../lib/postSearch";
import { useT } from "../lib/i18n";

// Maps each surface to the i18n key for its tab label — kept here rather than
// in postSearch.ts, since it's presentation, not search logic. These are the
// room tab bar's own keys (see RoomContent), so a hit is labelled with exactly
// the word on the tab it navigates to.
const SURFACE_LABEL_KEY: Record<PostSurface, string> = {
  chat: "chat.chatTab",
  board: "chat.boardTab",
  calendar: "chat.calendarTab",
  gallery: "chat.galleryTab",
};

/** Locale-aware date + time, so a hit from last week reads unambiguously next
 * to one from a minute ago (unlike the HH:mm-only formatTime used in-thread,
 * where "today" is implicit). */
function formatHitTimestamp(ts: number): string {
  return new Date(ts).toLocaleString();
}

/**
 * Cross-room, cross-surface message search — a modal over the rooms the
 * caller already knows about (usually every joined room). Purely a local
 * scan over each room's already-persisted history (see postSearch.ts): no
 * network round-trip, so results recompute synchronously as the user types.
 */
export function SearchPanel(props: {
  rooms: SearchScopeRoom[];
  onJump: (roomId: string, surface: PostSurface, postId: string) => void;
  onClose: () => void;
}) {
  const { rooms, onJump, onClose } = props;
  const t = useT();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Search is a synchronous localStorage scan, not a network call — no
  // debounce/loading state needed, just recompute on every keystroke.
  const hits = useMemo<SearchHit[]>(() => searchPosts(query, rooms), [query, rooms]);

  function handleJump(hit: SearchHit) {
    onJump(hit.roomId, hit.surface, hit.post.id);
    onClose();
  }

  return (
    <div class="modal-overlay" onClick={onClose}>
      <div class="modal search-panel" onClick={(e) => e.stopPropagation()}>
        <header class="modal-header">
          <h2>{t("search.title")}</h2>
          <button type="button" class="modal-close" aria-label={t("common.close")} onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div class="search-input-row">
          <Search size={16} class="search-input-icon" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            class="search-input"
            placeholder={t("search.placeholder")}
            value={query}
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          />
        </div>

        {query.trim() === "" ? (
          <p class="search-state">{t("search.empty")}</p>
        ) : hits.length === 0 ? (
          <p class="search-state">{t("search.noResults")}</p>
        ) : (
          <>
            <p class="search-results-count">{t("search.resultsCount", { count: hits.length })}</p>
            <ul class="search-results">
              {hits.map((hit) => (
                <li key={`${hit.roomId}:${hit.surface}:${hit.post.id}`}>
                  <button
                    type="button"
                    class="search-result"
                    title={t("search.openAction")}
                    onClick={() => handleJump(hit)}
                  >
                    <div class="search-result-meta">
                      <span class="search-result-room">{hit.roomName}</span>
                      <span class="search-result-surface">{t(SURFACE_LABEL_KEY[hit.surface])}</span>
                      <span class="search-result-author">{hit.post.fromName}</span>
                      <span class="search-result-time">{formatHitTimestamp(hit.post.timestamp)}</span>
                    </div>
                    <p class="search-result-snippet">{hit.snippet}</p>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
