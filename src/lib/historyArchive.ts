// Export-only local backup of a room's history — deliberately NOT an import
// path. Every post in this app arrives as a signed wire and is verified on
// receipt (see wireSign.ts) before it ever reaches chatStore, so the store's
// whole premise is "everything in here was signed by its claimed author".
// Accepting a hand-supplied JSON file back into it would let unverified,
// arbitrary content masquerade as a peer's post. Doing that safely would mean
// re-verifying every wire in the file AND re-fetching each body from mistlib
// by CID — but bodies are content-addressed and, per postCipher.ts, encrypted
// at rest, so they aren't sitting in localStorage to read back out in the
// first place. That's a much bigger design question than this module answers,
// so it's out of scope on purpose: this file only ever reads chatStore and
// produces a file: it never writes anything back into the store.
import { loadPosts, type PostNode, type PostSurface } from "./chatStore";
import { ROOM_TABS } from "./util";

/** Schema version of the emitted archive; bump when the shape changes. */
export const ARCHIVE_VERSION = 1;

export interface ArchivedPost {
  id: string;
  surface: PostSurface;
  parentId: string | null;
  fromId: string;
  fromName: string;
  timestamp: number;
  kind: string;
  text?: string;
  title?: string;
  fileName?: string;
  mimeType?: string;
  /** Content id of the body/file bytes in mistlib storage — NOT the bytes themselves. */
  cid?: string;
  deleted?: boolean;
  editedAt?: number;
  reactions: { emoji: string; fromName: string }[];
}

export interface RoomArchive {
  version: number;
  roomId: string;
  roomName: string;
  /** When the archive was produced (epoch ms), supplied by the caller. */
  exportedAt: number;
  counts: Record<PostSurface, number>;
  posts: ArchivedPost[];
}

/**
 * One post's exported shape. Media/file bytes are never embedded: a
 * media/file post contributes only its `cid` + `fileName` + `mimeType`, the
 * same reference-only treatment every kind's body gets here. The actual
 * bytes live in mistlib's content-addressed store, are encrypted at rest
 * (postCipher.ts), can run to hundreds of megabytes, and would each need an
 * async storage_get to retrieve — this archive is a readable record of what
 * was said/shared, not a binary backup of the room. Reactions are flattened
 * to `{emoji, fromName}`: a reactor's raw DID isn't meaningful in a
 * human-readable archive, and dropping it keeps the file from doubling as a
 * DID harvest. A tombstoned post's `cid` was already cleared to "" by
 * chatStore's tombstone(), which is falsy and so is naturally left off here
 * too — there is no body left to reference.
 */
function toArchivedPost(post: PostNode): ArchivedPost {
  const archived: ArchivedPost = {
    id: post.id,
    surface: post.surface,
    parentId: post.parentId,
    fromId: post.fromId,
    fromName: post.fromName,
    timestamp: post.timestamp,
    kind: post.kind,
    reactions: post.reactions.map((r) => ({ emoji: r.emoji, fromName: r.fromName })),
  };
  if (post.text !== undefined) archived.text = post.text;
  if (post.title !== undefined) archived.title = post.title;
  if (post.fileName !== undefined) archived.fileName = post.fileName;
  if (post.mimeType !== undefined) archived.mimeType = post.mimeType;
  if (post.cid) archived.cid = post.cid;
  if (post.deleted) archived.deleted = true;
  if (post.editedAt !== undefined) archived.editedAt = post.editedAt;
  return archived;
}

/**
 * Builds a room's archive from what's stored locally. Pure read — writes
 * nothing. Walks every surface (see ROOM_TABS) rather than just chat, since
 * the board/calendar/gallery are just as capped by MAX_POSTS_PER_ROOM and
 * just as lossy once that cap starts evicting their oldest posts. A room
 * with no history at all still returns a valid archive (empty posts, zeroed
 * counts) rather than throwing, so the panel can always offer the button.
 */
export function buildRoomArchive(roomId: string, roomName: string, exportedAt: number): RoomArchive {
  const counts = {} as Record<PostSurface, number>;
  const posts: ArchivedPost[] = [];
  for (const surface of ROOM_TABS) {
    const surfacePosts = loadPosts(surface, roomId);
    counts[surface] = surfacePosts.length;
    for (const post of surfacePosts) posts.push(toArchivedPost(post));
  }
  // Oldest-first across ALL surfaces combined — an archive reads as one
  // timeline, not four separate ones.
  posts.sort((a, b) => a.timestamp - b.timestamp);
  return { version: ARCHIVE_VERSION, roomId, roomName, exportedAt, counts, posts };
}

/** Pretty-printed JSON for the download. */
export function serializeArchive(archive: RoomArchive): string {
  return JSON.stringify(archive, null, 2);
}

const MAX_SLUG_LEN = 60;

/**
 * Lowercases and collapses every run of non-alphanumeric characters
 * (including unicode, whitespace, and path separators — a room name is
 * free-form peer input, so it can contain anything) to a single hyphen, then
 * trims and length-caps the result.
 */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LEN)
    .replace(/-+$/g, "");
}

/** UTC, not local time — the filename must come out the same regardless of
 * which timezone the browser producing it happens to be in. */
function isoDate(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

/**
 * Filesystem-safe download filename, e.g. "tc-chat-my-room-2026-07-30.json".
 * A room name is free-form user/peer input (it can contain slashes, emoji,
 * an all-punctuation string, ...); when sanitizing it leaves nothing usable,
 * the room id — already constrained to [A-Za-z0-9_-] by isValidRoomId —
 * stands in instead.
 */
export function archiveFileName(archive: RoomArchive): string {
  const slug = slugify(archive.roomName) || archive.roomId;
  return `tc-chat-${slug}-${isoDate(archive.exportedAt)}.json`;
}

/** Total posts across every surface, for the "N messages" label. */
export function archiveSize(archive: RoomArchive): number {
  return archive.posts.length;
}
