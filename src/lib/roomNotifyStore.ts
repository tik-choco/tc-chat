// Per-room alerting preferences: whether a room is allowed to raise a
// desktop notification and/or bump the sidebar's unread badge. This is
// DELIBERATELY THE OPPOSITE of muteStore.ts: muting a person drops their
// wires outright (nothing is stored, nothing renders, ever). Silencing a
// room here changes NOTHING about what's received, verified or persisted —
// every post in a silenced room still arrives, still gets verified, still
// gets stored, exactly as if it weren't silenced. This store only gates the
// *alerting* side effects layered on top in useMessageAlerts (badge count,
// desktop Notification). Don't conflate the two.
const KEY = "tc-chat:room-alerts:v1";

/** Per-room alerting preferences. Absent room = both enabled (the default). */
export interface RoomAlertPrefs {
  /** false = no desktop notification for this room. */
  notify: boolean;
  /** false = no unread badge for this room. */
  badge: boolean;
}

export const DEFAULT_ROOM_ALERTS: RoomAlertPrefs = { notify: true, badge: true };

/** Bounds unbounded growth for long-lived installs in many rooms; oldest-inserted evicted first. */
export const MAX_TRACKED_ROOMS = 200;

// Module-level cache, lazily built from localStorage on first use and kept
// in sync by every mutate/cross-tab-invalidate. Only non-default entries are
// ever stored, so this Record IS the cheap structure shouldNotifyRoom/
// shouldBadgeRoom need — a plain property lookup per call, no JSON.parse and
// no secondary index (unlike muteStore's didSet, there's nothing to derive).
let cache: Record<string, RoomAlertPrefs> | null = null;
const listeners = new Set<(all: Record<string, RoomAlertPrefs>) => void>();

function isValidPrefs(value: unknown): value is RoomAlertPrefs {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.notify === "boolean" && typeof v.badge === "boolean";
}

function readFromStorage(): Record<string, RoomAlertPrefs> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    // Don't trust JSON.parse's shape: a non-object value (or an array) is
    // dropped wholesale, and individually malformed entries (hand-edited
    // storage, an older/newer schema) are dropped one at a time rather than
    // allowed to crash every shouldNotifyRoom/shouldBadgeRoom call downstream.
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const result: Record<string, RoomAlertPrefs> = {};
    for (const [roomId, prefs] of Object.entries(parsed as Record<string, unknown>)) {
      if (isValidPrefs(prefs)) result[roomId] = { notify: prefs.notify, badge: prefs.badge };
    }
    return result;
  } catch (error) {
    console.warn("tc-chat: failed to load room alert prefs", error);
    return {};
  }
}

function persist(all: Record<string, RoomAlertPrefs>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch (error) {
    console.warn("tc-chat: failed to persist room alert prefs", error);
  }
}

function ensureLoaded(): Record<string, RoomAlertPrefs> {
  if (!cache) cache = readFromStorage();
  return cache;
}

function notifyListeners() {
  const snapshot = loadRoomAlerts();
  listeners.forEach((listener) => listener(snapshot));
}

if (typeof window !== "undefined") {
  // Cross-tab sync: another tab's toggle, or a wholesale localStorage.clear()
  // (reported as key === null), invalidates our cache rather than patching it
  // in place, since from here we can't tell what changed — a full reload
  // from storage is the only safe reaction.
  window.addEventListener("storage", (event) => {
    if (event.key !== KEY && event.key !== null) return;
    cache = null;
    notifyListeners();
  });
}

/** Every room with a non-default preference: roomId -> prefs. */
export function loadRoomAlerts(): Record<string, RoomAlertPrefs> {
  return { ...ensureLoaded() };
}

/** Effective preferences for `roomId` — `DEFAULT_ROOM_ALERTS` if it has no stored entry. */
export function roomAlertsFor(roomId: string): RoomAlertPrefs {
  const entry = ensureLoaded()[roomId];
  return entry ? { ...entry } : { ...DEFAULT_ROOM_ALERTS };
}

/** Cheap enough to call on every incoming wire (module-level cache, no JSON.parse). */
export function shouldNotifyRoom(roomId: string): boolean {
  return ensureLoaded()[roomId]?.notify ?? DEFAULT_ROOM_ALERTS.notify;
}

/** Cheap enough to call on every incoming wire (module-level cache, no JSON.parse). */
export function shouldBadgeRoom(roomId: string): boolean {
  return ensureLoaded()[roomId]?.badge ?? DEFAULT_ROOM_ALERTS.badge;
}

/**
 * Merges `prefs` over `roomId`'s current effective preferences (defaults
 * standing in for anything unset). A result equal to `DEFAULT_ROOM_ALERTS` is
 * deleted from the map entirely rather than stored explicitly, so the key
 * only ever grows with genuinely non-default rooms — this is what keeps
 * MAX_TRACKED_ROOMS from realistically mattering.
 */
export function setRoomAlerts(
  roomId: string,
  prefs: Partial<RoomAlertPrefs>,
): Record<string, RoomAlertPrefs> {
  const all = ensureLoaded();
  const current = all[roomId] ?? DEFAULT_ROOM_ALERTS;
  const merged: RoomAlertPrefs = {
    notify: prefs.notify ?? current.notify,
    badge: prefs.badge ?? current.badge,
  };

  const next = { ...all };
  delete next[roomId]; // drop first: re-inserting below (if any) moves roomId to the end
  if (merged.notify !== DEFAULT_ROOM_ALERTS.notify || merged.badge !== DEFAULT_ROOM_ALERTS.badge) {
    next[roomId] = merged;
    // Cap by insertion order: for plain string keys that aren't array-index-
    // like (tc-chat roomIds are opaque hashes/topics, never bare integers),
    // Object.keys() reflects insertion order, so the first key is
    // deterministically the oldest-inserted entry once we're over the cap.
    let keys = Object.keys(next);
    while (keys.length > MAX_TRACKED_ROOMS) {
      delete next[keys[0]];
      keys = Object.keys(next);
    }
  }

  cache = next;
  persist(cache);
  notifyListeners();
  return { ...cache };
}

/**
 * Subscribes to room-alert changes (local mutate or cross-tab storage sync).
 * Returns an unsubscribe function. Multiple subscribers are supported.
 */
export function subscribeRoomAlerts(
  listener: (all: Record<string, RoomAlertPrefs>) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test-only: drops the module-level cache so each case starts clean. */
export function __resetRoomAlertCacheForTests(): void {
  cache = null;
}
