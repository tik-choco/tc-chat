// Locally-muted peers, identified by their did:key. Deliberately GLOBAL and
// NOT room-scoped — unlike profileDirectory.ts (which is namespaced per room
// so a nickname learned in one room doesn't leak into another's view), a
// mute is a boundary against a *person*, not a per-room preference: it must
// follow that DID into every room and DM they're seen in, or muting someone
// in one room would do nothing to stop them posting in the next.
const KEY = "tc-chat:muted-peers:v1";

/** A single locally-muted peer. */
export interface MutedPeer {
  did: string;
  /** Display name at the time of muting, so the settings list is readable. */
  name: string;
  mutedAt: number;
}

/** Bounds unbounded growth for long-lived installs; oldest `mutedAt` evicted first. */
export const MAX_MUTED_PEERS = 500;

// Module-level cache, lazily built from localStorage on first use and kept
// in sync by every mutate/cross-tab-invalidate. `didSet` mirrors `cache`'s
// dids for O(1) isMuted() lookups — isMuted runs on every incoming wire, so
// that path must never JSON.parse or Array#find.
let cache: MutedPeer[] | null = null;
let didSet: Set<string> = new Set();
const listeners = new Set<(mutes: MutedPeer[]) => void>();

function isValidMutedPeer(value: unknown): value is MutedPeer {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.did === "string" &&
    v.did.trim().length > 0 &&
    typeof v.name === "string" &&
    typeof v.mutedAt === "number" &&
    Number.isFinite(v.mutedAt)
  );
}

function readFromStorage(): MutedPeer[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    // Don't trust JSON.parse's shape: a non-array value or malformed elements
    // (e.g. hand-edited storage, an older/newer schema) are dropped rather
    // than allowed to crash every isMuted() call downstream.
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidMutedPeer).sort((a, b) => b.mutedAt - a.mutedAt);
  } catch (error) {
    console.warn("tc-chat: failed to load muted peers", error);
    return [];
  }
}

function persist(list: MutedPeer[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch (error) {
    console.warn("tc-chat: failed to persist muted peers", error);
  }
}

function ensureLoaded(): MutedPeer[] {
  if (!cache) {
    cache = readFromStorage();
    didSet = new Set(cache.map((m) => m.did));
  }
  return cache;
}

function notify() {
  const snapshot = loadMutes();
  listeners.forEach((listener) => listener(snapshot));
}

if (typeof window !== "undefined") {
  // Cross-tab sync: another tab's mute/unmute, or a wholesale
  // localStorage.clear() (reported as key === null), invalidates our cache
  // rather than patching it in place, since from here we can't tell what
  // changed — a full reload from storage is the only safe reaction.
  window.addEventListener("storage", (event) => {
    if (event.key !== KEY && event.key !== null) return;
    cache = null;
    notify();
  });
}

/** Returns all muted peers, newest `mutedAt` first. */
export function loadMutes(): MutedPeer[] {
  return [...ensureLoaded()];
}

/** Whether `did` is currently muted. A blank/whitespace-only `did` returns false. */
export function isMuted(did: string): boolean {
  const trimmed = did?.trim();
  if (!trimmed) return false;
  ensureLoaded();
  return didSet.has(trimmed);
}

/**
 * Mutes `did`. Idempotent per did: re-muting an already-muted peer refreshes
 * `name`/`mutedAt` in place rather than adding a duplicate entry. A
 * blank/whitespace-only `did` is rejected and returns the current list
 * unchanged.
 */
export function mutePeer(did: string, name: string): MutedPeer[] {
  const trimmedDid = did.trim();
  const list = ensureLoaded();
  if (!trimmedDid) return [...list];

  const idx = list.findIndex((m) => m.did === trimmedDid);
  const entry: MutedPeer = { did: trimmedDid, name, mutedAt: Date.now() };
  const merged = idx >= 0 ? list.map((m, i) => (i === idx ? entry : m)) : [...list, entry];

  // Re-sort newest-first and cap: since this list is global (not per-room),
  // a very active install is the only thing that can push it past the cap,
  // so trim the oldest tail rather than refusing new mutes outright.
  cache = merged.sort((a, b) => b.mutedAt - a.mutedAt).slice(0, MAX_MUTED_PEERS);
  didSet = new Set(cache.map((m) => m.did));
  persist(cache);
  notify();
  return [...cache];
}

/** Unmutes `did`. A no-op (same membership) if it wasn't muted. */
export function unmutePeer(did: string): MutedPeer[] {
  const trimmedDid = did.trim();
  const list = ensureLoaded();
  if (!trimmedDid || !list.some((m) => m.did === trimmedDid)) return [...list];

  cache = list.filter((m) => m.did !== trimmedDid);
  didSet = new Set(cache.map((m) => m.did));
  persist(cache);
  notify();
  return [...cache];
}

/**
 * Subscribes to mute-list changes (local mutate or cross-tab storage sync).
 * Returns an unsubscribe function. Multiple subscribers are supported.
 */
export function subscribeMutes(listener: (mutes: MutedPeer[]) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test-only: drops the module-level cache so each case starts clean. */
export function __resetMuteCacheForTests(): void {
  cache = null;
  didSet = new Set();
}
