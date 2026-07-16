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
// install can't grow this key without limit. Least-recently-updated entries
// (by `updatedAt`), across the WHOLE store, are evicted first.
const MAX_ENTRIES = 500;

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

  const nextRoom: ProfileDirectory = { ...store[roomId], [did]: profile };
  let next: DirectoryStore = { ...store, [roomId]: nextRoom };

  // Enforce MAX_ENTRIES total (roomId, did) pairs across the whole store.
  const triples: Array<{ roomId: string; did: string; updatedAt: number }> = [];
  for (const [rId, room] of Object.entries(next)) {
    for (const [d, p] of Object.entries(room)) {
      triples.push({ roomId: rId, did: d, updatedAt: p.updatedAt });
    }
  }
  if (triples.length > MAX_ENTRIES) {
    triples.sort((a, b) => a.updatedAt - b.updatedAt);
    const toEvict = triples.slice(0, triples.length - MAX_ENTRIES);
    const rebuilt: DirectoryStore = {};
    for (const [rId, room] of Object.entries(next)) {
      rebuilt[rId] = { ...room };
    }
    for (const { roomId: rId, did: d } of toEvict) {
      delete rebuilt[rId][d];
    }
    for (const rId of Object.keys(rebuilt)) {
      if (Object.keys(rebuilt[rId]).length === 0) delete rebuilt[rId];
    }
    next = rebuilt;
  }

  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch (error) {
    console.warn("tc-chat: failed to persist profile directory", error);
  }
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
