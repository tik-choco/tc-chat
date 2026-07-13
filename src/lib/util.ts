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

/** The four surfaces of a room, in the order the tab bar shows them. */
export const ROOM_TABS = ["chat", "board", "calendar", "gallery"] as const;
export type RoomTab = (typeof ROOM_TABS)[number];

/**
 * Everything the URL needs to say "what's on screen": the room, which of its
 * tabs, and — on the board — which thread is open.
 */
export type AppLocation = {
  roomId: string;
  tab: RoomTab;
  /** Open board thread (a root node id); only shown in the hash on "board". */
  threadId: string | null;
};

/**
 * The on-screen location is mirrored into the URL hash — `#/<roomId>` for
 * chat (the historical form, so old links keep working), `#/<roomId>/<tab>`
 * for the other tabs, plus `/<threadId>` when a board thread is open — so the
 * address bar always deep-links / bookmarks exactly what's visible. Kept in
 * the hash rather than the real path so it needs no server rewrite and works
 * identically from the installed PWA.
 */
export function hashForLocation(loc: AppLocation): string {
  let hash = `#/${encodeURIComponent(loc.roomId)}`;
  if (loc.tab !== "chat") hash += `/${loc.tab}`;
  if (loc.tab === "board" && loc.threadId) hash += `/${encodeURIComponent(loc.threadId)}`;
  return hash;
}

/**
 * Inverse of {@link hashForLocation}. Returns null for an empty hash (caller
 * decides the fallback — e.g. the last-visited view) or a garbled room
 * segment; an unknown tab segment degrades to "chat". Splitting before
 * decoding is safe because room/thread ids are percent-encoded on the way in,
 * so a literal "/" can only be a separator.
 */
export function locationFromHash(hash: string): AppLocation | null {
  const raw = hash.replace(/^#\/?/, "").trim();
  if (!raw) return null;
  const [roomSeg = "", tabSeg = "", threadSeg = ""] = raw.split("/");
  let roomId: string;
  try {
    roomId = decodeURIComponent(roomSeg);
  } catch {
    return null;
  }
  if (!roomId) return null;
  const tab = (ROOM_TABS as readonly string[]).includes(tabSeg) ? (tabSeg as RoomTab) : "chat";
  let threadId: string | null = null;
  if (tab === "board" && threadSeg) {
    try {
      threadId = decodeURIComponent(threadSeg);
    } catch {
      threadId = null;
    }
  }
  return { roomId, tab, threadId };
}

/** Hash for a room's chat tab — the shape notification deep links use. */
export function hashForRoomId(roomId: string): string {
  return hashForLocation({ roomId, tab: "chat", threadId: null });
}

/** Just the room from a hash; an empty/garbled hash falls back to global. */
export function roomIdFromHash(hash: string): string {
  return locationFromHash(hash)?.roomId ?? GLOBAL_ROOM_ID;
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
