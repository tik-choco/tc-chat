// Cross-room message search. Every peer's history already lives in
// localStorage (see chatStore.loadPosts) — there is no server to query and no
// index to maintain, so this is a pure read-side scan over what's already on
// disk. Deliberately introduces no new storage and no new wire type.

import { loadPosts, type PostNode, type PostSurface } from "./chatStore";

/** A room the caller wants searched, with the label to echo back on hits (so
 * SearchPanel doesn't need its own room-name lookup). */
export interface SearchScopeRoom {
  id: string;
  /** The room's on-screen name, echoed back on each hit so the caller needn't re-resolve it. */
  name: string;
}

export interface SearchHit {
  post: PostNode;
  roomId: string;
  roomName: string;
  surface: PostSurface;
  /** Plain text around the first match, already truncated. Never markup. */
  snippet: string;
}

/** Every surface search covers, in tab order. */
export const SEARCH_SURFACES: readonly PostSurface[] = ["chat", "board", "calendar", "gallery"];

const DEFAULT_LIMIT = 100;
// Rough target length for a snippet's visible window, excluding the leading/
// trailing "…" added when the text was cut on that side.
const SNIPPET_TARGET_LEN = 80;

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Builds a plain-text snippet of `value` centred on the first occurrence of
 * `query` (already lowercased), collapsing whitespace first so a snippet never
 * carries the newlines/indentation of the original post body. Prefixes/
 * suffixes "…" whenever the window doesn't reach that edge of the text.
 */
function buildSnippet(value: string, query: string): string {
  const collapsed = collapseWhitespace(value);
  const lower = collapsed.toLowerCase();
  const idx = lower.indexOf(query);
  if (idx === -1) {
    // Callers only reach here after confirming a match on this same field, so
    // this is belt-and-suspenders against a future refactor breaking that
    // invariant — degrade to a head-truncated snippet rather than throw.
    return collapsed.length > SNIPPET_TARGET_LEN
      ? collapsed.slice(0, SNIPPET_TARGET_LEN) + "…"
      : collapsed;
  }
  const before = Math.floor((SNIPPET_TARGET_LEN - query.length) / 2);
  let start = Math.max(0, idx - before);
  const end = Math.min(collapsed.length, start + SNIPPET_TARGET_LEN);
  // Re-clamp the start once the end is known, so a match near the tail still
  // fills the window from the left instead of trailing off short.
  start = Math.max(0, end - SNIPPET_TARGET_LEN);
  let snippet = collapsed.slice(start, end);
  if (start > 0) snippet = "…" + snippet;
  if (end < collapsed.length) snippet += "…";
  return snippet;
}

/**
 * The raw value of the first of text/title/fileName (in that priority order —
 * a chat/board body outranks a filename) whose lowercase form contains
 * `query`. Returns null when none match, which the caller treats as "this
 * post isn't a hit".
 */
function firstMatchingField(post: PostNode, query: string): string | null {
  for (const value of [post.text, post.title, post.fileName]) {
    if (typeof value === "string" && value.toLowerCase().includes(query)) return value;
  }
  return null;
}

/**
 * Searches every given room's locally-known history for `query`, across the
 * requested surfaces (default: all four). A pure read over loadPosts — no
 * storage is written and no wire is sent. Blank queries short-circuit before
 * touching storage at all. A room/surface pair that fails to load (loadPosts
 * already fails soft, but this is one more layer) contributes zero hits
 * rather than aborting the rest of the search.
 */
export function searchPosts(
  query: string,
  rooms: SearchScopeRoom[],
  opts?: { surfaces?: readonly PostSurface[]; limit?: number },
): SearchHit[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const q = trimmed.toLowerCase();
  const surfaces = opts?.surfaces ?? SEARCH_SURFACES;
  const limit = opts?.limit ?? DEFAULT_LIMIT;

  const hits: SearchHit[] = [];
  for (const room of rooms) {
    for (const surface of surfaces) {
      let posts: PostNode[];
      try {
        posts = loadPosts(surface, room.id);
      } catch {
        continue;
      }
      for (const post of posts) {
        // A tombstone has no body left to find.
        if (post.deleted) continue;
        const matched = firstMatchingField(post, q);
        if (matched === null) continue;
        hits.push({
          post,
          roomId: room.id,
          roomName: room.name,
          surface,
          snippet: buildSnippet(matched, q),
        });
      }
    }
  }

  // Cap AFTER sorting so the newest matches survive a long history, not
  // whichever room/surface happened to be scanned first.
  hits.sort((a, b) => b.post.timestamp - a.post.timestamp);
  return hits.slice(0, limit);
}
