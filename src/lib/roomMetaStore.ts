// A room's SHARED name/icon — set by any peer and broadcast to everyone via
// a signed `tc-chat:room-meta` wire (see useRoomMeta.ts), merged last-write-
// wins by `updatedAt` so every peer converges on the same value regardless of
// who set it. Distinct from roomDisplayNameStore.ts (the local user's own,
// never-broadcast nickname) and chatStore.ts's RoomMeta.name (the label the
// local user happened to type when joining) — this is the one name/icon
// everyone in the room agrees on. Keyed by roomId only: there is no
// "creator"/ownership concept in this app (see friendsStore/profileDirectory
// for the same peer-symmetric, last-write-wins pattern), so any peer can set
// it and the newest write simply wins.
export interface RoomMetaRecord {
  name?: string;
  /** mistlib storage CID of the room's icon image. */
  iconCid?: string;
  updatedAt: number;
}

/** roomId -> that room's shared meta. */
export type RoomMetaStore = Record<string, RoomMetaRecord>;

const KEY = "tc-chat:room-meta:v1";
// Bounds a long-lived install's accumulation of rooms it has ever seen shared
// meta for. Least-recently-updated entries are evicted first.
const MAX_ENTRIES = 200;

export function loadRoomMetaStore(): RoomMetaStore {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as RoomMetaStore) : {};
  } catch {
    return {};
  }
}

/**
 * Merges a room's shared meta into the store if it is newer than what we
 * have, returning the next store (a new object when it actually changed, the
 * same reference otherwise so callers can skip needless re-renders).
 */
export function mergeRoomMeta(
  store: RoomMetaStore,
  roomId: string,
  meta: RoomMetaRecord,
): RoomMetaStore {
  const existing = store[roomId];
  if (existing && existing.updatedAt >= meta.updatedAt) return store;

  let next: RoomMetaStore = { ...store, [roomId]: meta };

  const entries = Object.entries(next);
  if (entries.length > MAX_ENTRIES) {
    entries.sort((a, b) => a[1].updatedAt - b[1].updatedAt);
    const toEvict = entries.slice(0, entries.length - MAX_ENTRIES).map(([id]) => id);
    next = { ...next };
    for (const id of toEvict) delete next[id];
  }

  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch (error) {
    console.warn("tc-chat: failed to persist room meta", error);
  }
  return next;
}

export function getRoomMeta(
  store: RoomMetaStore,
  roomId: string | null | undefined,
): RoomMetaRecord | undefined {
  if (!roomId) return undefined;
  return store[roomId];
}
