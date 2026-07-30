// A small, best-effort directory of peers' public profiles (display name +
// avatar CID), learned from signed `tc-chat:profile` broadcasts and keyed by
// the owner's DID. Persisted so names/avatars survive reloads and are known
// before the owner re-announces. Only public, self-signed fields live here —
// never private keys.
//
// Room-scoped: each room gets its OWN slice of the directory (a peer's
// nickname in room A must never leak into room B's view of them — see the
// per-room display-name-override feature). The store is keyed by roomId,
// then by did.
export interface DirectoryProfile {
  displayName?: string;
  avatarCid?: string;
  /** Short self-introduction, shown when viewing a peer's profile detail. */
  bio?: string;
  /** Monotonic version (sender's broadcast time); newer wins on merge. */
  updatedAt: number;
}

/** ONE ROOM's view: did -> profile. Same shape every existing consumer already expects. */
export type ProfileDirectory = Record<string, DirectoryProfile>;

/** All rooms: roomId -> that room's directory. The persisted unit. */
export type DirectoryStore = Record<string, ProfileDirectory>;

/** Stable ref for unknown rooms, so callers can rely on reference equality when nothing changed. */
export const EMPTY_DIRECTORY: ProfileDirectory = Object.freeze({});

const KEY = "tc-chat:profile-directory:v2";
// The directory accumulates every peer ever seen across every room, for the
// app's whole lifetime, with no natural cap — bound it so a long-lived
// install can't grow this key without limit.
//
// This is a TWO-level bound, not a single global entry count: a naive global
// cap (evict the globally oldest (roomId, did) pair) lets one busy room's
// churn evict a quiet room's entries entirely, silently blanking every
// peer's display name/avatar in that quiet room (see CLAUDE.md's "Room-scoped
// identity" gotcha). Instead:
//   - MAX_ENTRIES_PER_ROOM bounds each room independently, evicting that
//     room's own oldest `updatedAt` entries first — a busy room can only ever
//     evict itself.
//   - MAX_ROOMS bounds how many rooms are retained at all, evicting whole
//     rooms — least-recently-active first (by that room's newest
//     `updatedAt`), not the room with the fewest entries — so the key still
//     can't grow without limit.
const MAX_ENTRIES_PER_ROOM = 200;
const MAX_ROOMS = 50;

export function loadDirectoryStore(): DirectoryStore {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as DirectoryStore) : {};
  } catch {
    return {};
  }
}

/**
 * Merges one peer's profile into a room's slice of the store if it is newer
 * than what we have, returning the next store (a new object when it actually
 * changed, the same reference otherwise so callers can skip needless
 * re-renders).
 */
export function mergeProfile(
  store: DirectoryStore,
  roomId: string,
  did: string,
  profile: DirectoryProfile,
): DirectoryStore {
  const existing = store[roomId]?.[did];
  if (existing && existing.updatedAt >= profile.updatedAt) return store;

  const nextRoom = evictRoomEntries({ ...store[roomId], [did]: profile }, did);
  const next = pruneEmptyRooms(evictRooms({ ...store, [roomId]: nextRoom }, roomId));

  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch (error) {
    console.warn("tc-chat: failed to persist profile directory", error);
  }
  return next;
}

/**
 * Per-room bound: once a room exceeds MAX_ENTRIES_PER_ROOM, evicts that
 * room's own oldest-`updatedAt` entries first — never another room's, since
 * this only ever sees the one room's dict. `keepDid` (the entry just merged)
 * is always spared, so a fresh write can never evict itself.
 */
function evictRoomEntries(room: ProfileDirectory, keepDid: string): ProfileDirectory {
  const entries = Object.entries(room);
  if (entries.length <= MAX_ENTRIES_PER_ROOM) return room;

  entries.sort(([, a], [, b]) => a.updatedAt - b.updatedAt);
  const next = { ...room };
  let toDrop = entries.length - MAX_ENTRIES_PER_ROOM;
  for (const [d] of entries) {
    if (toDrop <= 0) break;
    if (d === keepDid) continue;
    delete next[d];
    toDrop--;
  }
  return next;
}

/**
 * Cross-room bound: once more than MAX_ROOMS rooms are tracked, evicts whole
 * rooms — least-recently-active first (that room's newest `updatedAt`, not
 * its entry count) — rather than a global per-entry count, so a busy room's
 * churn can never blank out a quiet room's names (the CLAUDE.md gotcha this
 * two-level scheme replaces). `keepRoomId` (the room just merged into) is
 * always spared.
 */
function evictRooms(store: DirectoryStore, keepRoomId: string): DirectoryStore {
  const roomIds = Object.keys(store);
  if (roomIds.length <= MAX_ROOMS) return store;

  const byLastActive = roomIds
    .filter((rId) => rId !== keepRoomId)
    .map((rId) => ({
      roomId: rId,
      lastActive: Math.max(...Object.values(store[rId]).map((p) => p.updatedAt)),
    }))
    .sort((a, b) => a.lastActive - b.lastActive);

  const next = { ...store };
  let toDrop = roomIds.length - MAX_ROOMS;
  for (const { roomId: rId } of byLastActive) {
    if (toDrop <= 0) break;
    delete next[rId];
    toDrop--;
  }
  return next;
}

/**
 * Drops any room left with zero entries. Neither eviction pass above should
 * produce one (evictRoomEntries always spares the just-merged did; evictRooms
 * drops whole rooms outright) — this is a defensive backstop against a store
 * that already had a stray empty room (e.g. hand-edited storage) rather than
 * something either pass relies on.
 */
function pruneEmptyRooms(store: DirectoryStore): DirectoryStore {
  const empty = Object.keys(store).filter((rId) => Object.keys(store[rId]).length === 0);
  if (empty.length === 0) return store;
  const next = { ...store };
  for (const rId of empty) delete next[rId];
  return next;
}

/** A single room's slice of the store, or EMPTY_DIRECTORY when unknown/absent. */
export function roomDirectory(
  store: DirectoryStore,
  roomId: string | null | undefined,
): ProfileDirectory {
  if (!roomId) return EMPTY_DIRECTORY;
  return store[roomId] ?? EMPTY_DIRECTORY;
}

/** Resolves a DID to a display name + avatar, falling back to a signed name. */
export function identityFor(
  directory: ProfileDirectory,
  did: string,
  fallbackName: string,
): { name: string; avatarCid?: string } {
  const p = directory[did];
  return {
    name: p?.displayName?.trim() || fallbackName,
    avatarCid: p?.avatarCid || undefined,
  };
}
