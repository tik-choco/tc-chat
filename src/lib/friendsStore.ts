// Local persistence for friends. A "friend" is a DID you've deliberately
// pinned from someone you've met in a room (see profileDirectory.ts) plus the
// deterministic DM room id computed once at entry-creation time — see
// computeDmRoomId. Entries progress through a friend-request lifecycle before
// becoming a full friend (see FriendStatus).

export type FriendStatus = "pending-out" | "pending-in" | "accepted";

export interface Friend {
  did: string;
  name: string;
  addedAt: number;
  /** Deterministic DM swarm room id, computed once at entry creation. */
  roomId: string;
  status: FriendStatus;
}

const FRIENDS_KEY = "tc-chat:friends";

/** Legacy entries persisted before FriendStatus existed; treat them as already accepted. */
function migrate(raw: unknown): Friend[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Array<Partial<Friend>>).map((f) => ({
    did: f.did as string,
    name: f.name as string,
    addedAt: f.addedAt as number,
    roomId: f.roomId as string,
    status: f.status ?? "accepted",
  }));
}

export function loadFriends(): Friend[] {
  try {
    const raw = localStorage.getItem(FRIENDS_KEY);
    return raw ? migrate(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

function saveFriends(friends: Friend[]): void {
  localStorage.setItem(FRIENDS_KEY, JSON.stringify(friends));
}

/**
 * Records a friend request. A request in the opposite direction of an
 * existing pending entry means both sides now want the friendship, so it
 * promotes straight to "accepted" instead of waiting for a separate accept
 * call. Anything already accepted, or a duplicate in the same direction, is
 * left untouched.
 */
export function upsertRequest(
  did: string,
  name: string,
  roomId: string,
  direction: "in" | "out",
): Friend[] {
  const friends = loadFriends();
  const existing = friends.find((f) => f.did === did);
  const incomingStatus: FriendStatus = direction === "out" ? "pending-out" : "pending-in";

  let next: Friend[];
  if (!existing) {
    next = [...friends, { did, name, addedAt: Date.now(), roomId, status: incomingStatus }];
  } else if (
    (existing.status === "pending-out" && direction === "in") ||
    (existing.status === "pending-in" && direction === "out")
  ) {
    next = friends.map((f) => (f.did === did ? { ...f, status: "accepted" as FriendStatus } : f));
  } else {
    next = friends;
  }
  saveFriends(next);
  return next;
}

/** Marks an entry accepted (from any pending status). Idempotent; no-op if the did is absent. */
export function acceptFriend(did: string): Friend[] {
  const friends = loadFriends();
  if (!friends.some((f) => f.did === did)) return friends;
  const next = friends.map((f) => (f.did === did ? { ...f, status: "accepted" as FriendStatus } : f));
  saveFriends(next);
  return next;
}

/** Removes the entry (used for remove friend, decline, and cancel). */
export function removeFriend(did: string): Friend[] {
  const next = loadFriends().filter((f) => f.did !== did);
  saveFriends(next);
  return next;
}

/**
 * Deterministic DM swarm topic for a pair of DIDs — sorting the pair first
 * means both sides independently compute the identical string with no
 * out-of-band exchange beyond already knowing each other's DID. Prefixed so
 * it reads distinctly from a manually-chosen room id.
 */
export async function computeDmRoomId(selfDid: string, peerDid: string): Promise<string> {
  const sorted = [selfDid, peerDid].sort().join(":");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sorted));
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `dm-${hex.slice(0, 32)}`;
}
