// Relay-cache policy: which post bodies this peer proactively fetches and
// pins so it can serve them to the swarm when the author is offline.
//
// mistlib already does the heavy lifting: any node automatically answers
// QUERY/WANT for blocks it holds, and storage_get on a miss fetches from
// peers and retains the block locally. What mistlib does NOT do is decide to
// keep anything — unpinned blocks are LRU-evicted under capacity pressure and
// there is no list API. This module is that missing policy: it tracks which
// CIDs we pinned per post (localStorage index, fail-soft like chatStore),
// enforces a byte budget (oldest pins released first), and releases pins when
// posts leave the local index (delete/eviction) via sweepRoom.
//
// Bodies are ciphertext at rest (see postCipher) — pinning them makes this
// peer a relay for opaque blobs; only wire-holders can read them.

import { storage_pin, storage_unpin } from "./mistClient";
import { GLOBAL_ROOM_ID, ROOM_TABS } from "./util";
import { loadPosts } from "./chatStore";

/** Only these rooms get proactive fetch+pin. Currently the built-in global room. */
export function shouldRelayRoom(roomId: string): boolean {
  return roomId === GLOBAL_ROOM_ID;
}

/** Media/file bodies larger than this are not auto-fetched on receipt (still lazy-loaded on view). */
export const AUTO_FETCH_MAX_BYTES = 8 * 1024 * 1024;

/** Total bytes this peer will keep pinned as a relay, across all rooms combined. */
export const RELAY_PIN_BUDGET_BYTES = 256 * 1024 * 1024;

const INDEX_KEY = "tc-chat:relay-pins:v1";

/** One CID pinned as (part of) a post's body. */
interface PinnedCid {
  cid: string;
  bytes: number;
}

/**
 * Everything pinned for one post. `at` is the epoch ms the post was *first*
 * pinned — it drives oldest-first eviction and deliberately does not move
 * when a later body (e.g. a thumbnail) is added to the same post, so a post
 * can't dodge eviction just by growing.
 */
interface PostPinEntry {
  at: number;
  cids: PinnedCid[];
}

/**
 * The on-disk shape: roomId -> postId -> pinned bodies for that post. A flat
 * two-level map (rather than one keyed by `${roomId}::${postId}`) so
 * sweepRoom can enumerate a single room's posts without scanning every key.
 */
interface RelayPinIndex {
  posts: Record<string, Record<string, PostPinEntry>>;
}

function emptyIndex(): RelayPinIndex {
  return { posts: {} };
}

function loadIndex(): RelayPinIndex {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return emptyIndex();
    const parsed = JSON.parse(raw) as RelayPinIndex;
    if (!parsed || typeof parsed !== "object" || !parsed.posts) return emptyIndex();
    return parsed;
  } catch (error) {
    console.warn("tc-chat: failed to load relay pin index", error);
    return emptyIndex();
  }
}

function saveIndex(index: RelayPinIndex): void {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
  } catch (error) {
    console.warn("tc-chat: failed to persist relay pin index", error);
  }
}

function totalBytes(index: RelayPinIndex): number {
  let sum = 0;
  for (const posts of Object.values(index.posts)) {
    for (const entry of Object.values(posts)) {
      for (const c of entry.cids) sum += c.bytes;
    }
  }
  return sum;
}

/** Unpins every given CID, fail-soft. Never throws. */
async function unpinAll(cids: string[]): Promise<void> {
  await Promise.all(
    cids.map(async (cid) => {
      try {
        await storage_unpin(cid);
      } catch (error) {
        console.warn(`tc-chat: failed to unpin relay CID "${cid}"`, error);
      }
    }),
  );
}

/** Removes a post's entry from the index in place, returning its CIDs (or [] if absent). */
function takePostEntry(index: RelayPinIndex, roomId: string, postId: string): string[] {
  const roomPosts = index.posts[roomId];
  const entry = roomPosts?.[postId];
  if (!entry) return [];
  const cids = entry.cids.map((c) => c.cid);
  delete roomPosts[postId];
  if (Object.keys(roomPosts).length === 0) delete index.posts[roomId];
  return cids;
}

/** Evicts oldest-first posts (unpinning their CIDs) until under budget, mutating `index`. */
async function evictOverBudget(index: RelayPinIndex): Promise<void> {
  while (totalBytes(index) > RELAY_PIN_BUDGET_BYTES) {
    let oldest: { roomId: string; postId: string; at: number } | null = null;
    for (const [roomId, posts] of Object.entries(index.posts)) {
      for (const [postId, entry] of Object.entries(posts)) {
        if (!oldest || entry.at < oldest.at) oldest = { roomId, postId, at: entry.at };
      }
    }
    if (!oldest) break; // nothing left to evict; budget can't be satisfied further
    const cids = takePostEntry(index, oldest.roomId, oldest.postId);
    await unpinAll(cids);
  }
}

/**
 * Records that `cid` (byteLength bytes) is a body of `postId` in `roomId` and
 * pins it, releasing oldest pins if the relay budget is exceeded. Fire-and-forget
 * safe; never throws.
 */
export async function noteBody(
  roomId: string,
  postId: string,
  cid: string,
  byteLength: number,
): Promise<void> {
  const index = loadIndex();
  const existing = index.posts[roomId]?.[postId];
  if (existing?.cids.some((c) => c.cid === cid)) {
    // Idempotent: this exact body of this post is already pinned+recorded.
    return;
  }

  try {
    await storage_pin(cid);
  } catch (error) {
    console.warn(`tc-chat: failed to pin relay CID "${cid}"`, error);
  }

  const roomPosts = (index.posts[roomId] ??= {});
  const entry = (roomPosts[postId] ??= { at: Date.now(), cids: [] });
  entry.cids.push({ cid, bytes: byteLength });

  await evictOverBudget(index);
  saveIndex(index);
}

/** Unpins every CID recorded for a post (author deleted it, or it left the local index). */
export async function releasePost(roomId: string, postId: string): Promise<void> {
  const index = loadIndex();
  const cids = takePostEntry(index, roomId, postId);
  if (cids.length === 0) return;
  await unpinAll(cids);
  saveIndex(index);
}

/**
 * Reconciles the pin index for a room against the posts still present in the
 * local per-surface indices (chatStore.loadPosts), releasing pins for posts
 * that were evicted or tombstoned. Cheap; call on room mount.
 */
export async function sweepRoom(roomId: string): Promise<void> {
  const index = loadIndex();
  const indexedPostIds = Object.keys(index.posts[roomId] ?? {});
  if (indexedPostIds.length === 0) return;

  const liveIds = new Set<string>();
  for (const surface of ROOM_TABS) {
    for (const post of loadPosts(surface, roomId)) {
      if (!post.deleted) liveIds.add(post.id);
    }
  }

  for (const postId of indexedPostIds) {
    if (!liveIds.has(postId)) {
      await releasePost(roomId, postId);
    }
  }
}

/** Snapshot of what this peer currently pins as a relay, for a future settings UI. */
export function getRelayStats(): { pinnedBytes: number; pinnedPosts: number } {
  const index = loadIndex();
  let pinnedPosts = 0;
  for (const posts of Object.values(index.posts)) {
    pinnedPosts += Object.keys(posts).length;
  }
  return { pinnedBytes: totalBytes(index), pinnedPosts };
}
