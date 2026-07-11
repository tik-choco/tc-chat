export function newId(): string {
  return crypto.randomUUID();
}

export function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const GLOBAL_ROOM_ID = "global";

/**
 * The active channel is mirrored into the URL hash as `#/<roomId>` so the
 * address bar (the "path") always shows — and can deep-link / bookmark — the
 * channel currently on screen. Kept in the hash rather than the real path so it
 * needs no server rewrite and works identically from the installed PWA.
 */
export function hashForRoomId(roomId: string): string {
  return `#/${encodeURIComponent(roomId)}`;
}

/** Inverse of {@link hashForRoomId}; an empty/garbled hash falls back to global. */
export function roomIdFromHash(hash: string): string {
  const raw = hash.replace(/^#\/?/, "").trim();
  if (!raw) return GLOBAL_ROOM_ID;
  try {
    return decodeURIComponent(raw);
  } catch {
    return GLOBAL_ROOM_ID;
  }
}

/** Shortened did:key for compact, non-intrusive "verified" UI badges. */
export function shortDid(did: string): string {
  return did.length <= 20 ? did : `${did.slice(0, 12)}…${did.slice(-6)}`;
}

/**
 * A deterministic hue (0–359) derived from any stable id (a DID, a node id).
 * Lets every participant get a consistent avatar/accent color across the UI
 * without any coordination, even before we know their full profile.
 */
export function hueFromId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}

/** First visible (grapheme-ish) character of a name, upper-cased, for avatars. */
export function initialOf(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  return Array.from(trimmed)[0].toUpperCase();
}
