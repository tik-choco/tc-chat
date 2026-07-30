// Unsent per-room message drafts. Without this, switching rooms (or an
// accidental reload) silently discards whatever the user was mid-typing —
// there's no autosave anywhere else in the composer path. One localStorage
// key per room (like chatStore.ts's per-room keys) rather than a single JSON
// map (like roomDisplayNameStore.ts), since a draft is a single plain-text
// value per room, not a small record worth reading/patching as a whole.

import { GLOBAL_ROOM_ID } from "./util";

const KEY_PREFIX = "tc-chat:draft:v1:";

/** Max characters kept per draft; longer input is stored truncated. */
export const MAX_DRAFT_LENGTH = 4000;

// The global room is ephemeral (see isEphemeralRoom in chatStore.ts): it
// deliberately persists nothing and does not survive a reload. A draft typed
// into it should get the same treatment — held in memory for the lifetime of
// the page (so switching tabs/rooms and back doesn't lose it) but never
// written to localStorage — rather than special-casing the global room
// inside every read/write below.
function isEphemeralRoom(roomId: string): boolean {
  return roomId === GLOBAL_ROOM_ID;
}

const ephemeralDrafts = new Map<string, string>();

/** Returns this room's saved draft, or "" if none is stored (or storage is unreadable). */
export function loadDraft(roomId: string): string {
  if (isEphemeralRoom(roomId)) return ephemeralDrafts.get(roomId) ?? "";

  try {
    return localStorage.getItem(KEY_PREFIX + roomId) ?? "";
  } catch (error) {
    console.warn(`tc-chat: failed to load draft for room "${roomId}"`, error);
    return "";
  }
}

/** Persists (or, for blank text, clears) this room's draft. */
export function saveDraft(roomId: string, text: string): void {
  // A draft is user-typed text, so it can't be trusted to be small.
  const truncated = text.slice(0, MAX_DRAFT_LENGTH);

  if (!truncated.trim()) {
    clearDraft(roomId);
    return;
  }

  if (isEphemeralRoom(roomId)) {
    ephemeralDrafts.set(roomId, truncated);
    return;
  }

  try {
    localStorage.setItem(KEY_PREFIX + roomId, truncated);
  } catch (error) {
    console.warn(`tc-chat: failed to persist draft for room "${roomId}"`, error);
  }
}

export function clearDraft(roomId: string): void {
  if (isEphemeralRoom(roomId)) {
    ephemeralDrafts.delete(roomId);
    return;
  }

  try {
    localStorage.removeItem(KEY_PREFIX + roomId);
  } catch (error) {
    console.warn(`tc-chat: failed to clear draft for room "${roomId}"`, error);
  }
}
