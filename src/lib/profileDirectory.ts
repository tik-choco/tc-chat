// A small, best-effort directory of peers' public profiles (display name +
// avatar CID), learned from signed `tc-chat:profile` broadcasts and keyed by
// the owner's DID. Persisted so names/avatars survive reloads and are known
// before the owner re-announces. Only public, self-signed fields live here —
// never private keys.
export interface DirectoryProfile {
  displayName?: string;
  avatarCid?: string;
  /** Short self-introduction, shown when viewing a peer's profile detail. */
  bio?: string;
  /** Monotonic version (sender's broadcast time); newer wins on merge. */
  updatedAt: number;
}

export type ProfileDirectory = Record<string, DirectoryProfile>;

const KEY = "tc-chat:profile-directory:v1";
// The directory accumulates every peer ever seen across every room, for the
// app's whole lifetime, with no natural cap — bound it so a long-lived
// install can't grow this key without limit. Least-recently-updated entries
// (by `updatedAt`) are evicted first.
const MAX_ENTRIES = 500;

export function loadDirectory(): ProfileDirectory {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ProfileDirectory) : {};
  } catch {
    return {};
  }
}

/**
 * Merges one profile into the directory if it is newer than what we have,
 * returning the next directory (a new object when it actually changed, the same
 * reference otherwise so callers can skip needless re-renders).
 */
export function mergeProfile(
  directory: ProfileDirectory,
  did: string,
  profile: DirectoryProfile,
): ProfileDirectory {
  const existing = directory[did];
  if (existing && existing.updatedAt >= profile.updatedAt) return directory;
  let next = { ...directory, [did]: profile };
  const entries = Object.entries(next);
  if (entries.length > MAX_ENTRIES) {
    entries.sort((a, b) => b[1].updatedAt - a[1].updatedAt);
    next = Object.fromEntries(entries.slice(0, MAX_ENTRIES));
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch (error) {
    console.warn("tc-chat: failed to persist profile directory", error);
  }
  return next;
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
