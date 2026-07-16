// Per-room overrides of the local user's own display name. Purely local
// (never broadcast as-is over the wire and never written into the shared/
// global profile record — see profileStore.ts's `tc-shared-profile-cid-v1`,
// which is a cross-app interop contract with the sibling tc-vrsns2 app and is
// out of scope here). A caller resolves the EFFECTIVE name for a room (this
// override, falling back to the global profile name) and feeds that into
// useProfileDirectory to broadcast/self-merge.
const KEY = "tc-chat:room-display-names:v1";

/** roomId -> per-room display-name override. Only non-empty, trimmed names are stored. */
export type RoomDisplayNames = Record<string, string>;

export function loadRoomDisplayNames(): RoomDisplayNames {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as RoomDisplayNames) : {};
  } catch {
    return {};
  }
}

/**
 * Sets (or clears, when `name` is empty/whitespace-only) a room's display-name
 * override, returning the next map (a new object when it actually changed,
 * the same reference otherwise so callers can skip needless re-renders).
 */
export function saveRoomDisplayName(
  map: RoomDisplayNames,
  roomId: string,
  name: string,
): RoomDisplayNames {
  const trimmed = name.trim().slice(0, 60);

  if (!trimmed) {
    if (!(roomId in map)) return map;
    const next = { ...map };
    delete next[roomId];
    persist(next);
    return next;
  }

  if (map[roomId] === trimmed) return map;

  const next = { ...map, [roomId]: trimmed };
  persist(next);
  return next;
}

function persist(map: RoomDisplayNames) {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch (error) {
    console.warn("tc-chat: failed to persist room display names", error);
  }
}
