// Local persistence for chat history and known rooms. mistlib is
// content-addressed only (storage_add/storage_get by CID) — it has no
// concept of a room's message "history", so each peer keeps its own
// per-room message index in localStorage, keyed by room id.

import { ROOM_TABS, type AppLocation, type RoomTab } from "./util";

export interface RoomMeta {
  id: string;
  name: string;
  joinedAt: number;
}

/**
 * A single emoji reaction on a post, keyed by the reactor's DID so the same
 * person can't inflate a count and can toggle their own reaction off.
 */
export interface Reaction {
  emoji: string;
  fromId: string;
  fromName: string;
}

/** Which stream a post belongs to. Chat, board, calendar and gallery are
 * separate streams that share this one structure and one distribution engine
 * (see usePostStream). */
export type PostSurface = "chat" | "board" | "calendar" | "gallery";
export type PostKind = "text" | "media" | "file" | "project" | "event";

/**
 * The single structure behind chat, the board, AND the room calendar. A chat
 * message, a recruitment post, a thread's opening post, a nested comment, and
 * a calendar event are all `PostNode`s — they differ only in:
 *
 *   - `surface`  — which stream it lives in ("chat" | "board" | "calendar")
 *   - `parentId` — null = top-level; the board uses it to nest replies to any depth
 *   - `kind`     — a rendering hint ("text"/"media"/"file"/"project"/"event")
 *
 * Structured bodies (title/text/roles/tags/startsAt/endsAt/location) are
 * content-addressed via storage_add() and only the CID + metadata is
 * broadcast; `media`/`file` kinds point their CID straight at the file bytes.
 * `reactions` are merged in from a separate index so they can arrive before or
 * after the node itself.
 */
export interface PostNode {
  id: string;
  roomId: string;
  surface: PostSurface;
  parentId: string | null;
  fromId: string;
  fromName: string;
  timestamp: number;
  kind: PostKind;
  cid: string;
  text?: string;
  title?: string;
  roles?: string[];
  tags?: string[];
  mimeType?: string;
  fileName?: string;
  fileSize?: number;
  /** Calendar event fields (kind "event"); epoch ms. */
  startsAt?: number;
  endsAt?: number;
  location?: string;
  /** Optional thumbnail image for board posts: CID of the (downscaled) image bytes. */
  thumbCid?: string;
  thumbMimeType?: string;
  /** Recruitment capacity (project kind): how many members the post is looking for. */
  capacity?: number;
  /** Tombstoned by its author (applyPostDelete): body cleared, position kept. */
  deleted?: boolean;
  /** Set when the author last edited the body (applyPostEdit). */
  editedAt?: number;
  reactions: Reaction[];
}

// Back-compat aliases: chat and the board used to have their own types.
export type ChatMessage = PostNode;
export type BoardNode = PostNode;
export type BoardNodeKind = PostKind;

export type ReactionOp = "add" | "remove";

// Each surface keeps its own per-room index. The keys match the pre-unification
// ones so existing local history keeps loading.
const POSTS_KEY_PREFIX: Record<PostSurface, string> = {
  chat: "tc-chat:messages:",
  board: "tc-chat:board-nodes:",
  calendar: "tc-chat:calendar-events:",
  gallery: "tc-chat:gallery:",
};
// One reaction index per room, shared by both surfaces: target ids are unique
// across chat and board, and whichever view knows a target merges it in.
const REACTIONS_KEY_PREFIX = "tc-chat:reactions:";
// Deletes that named a target which hasn't hydrated locally yet (the post
// handler awaits a slow storage_get; the delete handler doesn't, so a signed
// delete wire can win the race). Keyed per surface+room, targetId -> the
// delete's authorId, so appendPost can tombstone the post the instant it
// lands instead of losing the delete.
const PENDING_DELETES_KEY_PREFIX = "tc-chat:pending-deletes:";
// Append-only log of the raw *signed* wires seen in a room (posts + reactions),
// so any peer can replay verifiable history to a late joiner. Only signatures
// make replay safe — a replayer can't forge content, and each wire is
// re-verified on receipt (see useHistorySync).
const WIRE_LOG_KEY_PREFIX = "tc-chat:wirelog:";
const ROOMS_KEY = "tc-chat:rooms";
const USERNAME_KEY = "tc-chat:username";
const MAX_POSTS_PER_ROOM = 500;
const MAX_WIRE_LOG_PER_ROOM = 600;

type ReactionIndex = Record<string, Reaction[]>;

function loadReactionIndex(roomId: string): ReactionIndex {
  try {
    const raw = localStorage.getItem(REACTIONS_KEY_PREFIX + roomId);
    return raw ? (JSON.parse(raw) as ReactionIndex) : {};
  } catch {
    return {};
  }
}

function saveReactionIndex(roomId: string, index: ReactionIndex) {
  try {
    localStorage.setItem(REACTIONS_KEY_PREFIX + roomId, JSON.stringify(index));
  } catch (error) {
    console.warn(`tc-chat: failed to persist reactions for room "${roomId}"`, error);
  }
}

// targetId -> the delete wire's fromId, for deletes still waiting on their post.
type PendingDeletes = Record<string, string>;

function pendingDeletesKey(surface: PostSurface, roomId: string): string {
  return PENDING_DELETES_KEY_PREFIX + surface + ":" + roomId;
}

function loadPendingDeletes(surface: PostSurface, roomId: string): PendingDeletes {
  try {
    const raw = localStorage.getItem(pendingDeletesKey(surface, roomId));
    return raw ? (JSON.parse(raw) as PendingDeletes) : {};
  } catch {
    return {};
  }
}

function savePendingDeletes(surface: PostSurface, roomId: string, pending: PendingDeletes) {
  try {
    localStorage.setItem(pendingDeletesKey(surface, roomId), JSON.stringify(pending));
  } catch (error) {
    console.warn(`tc-chat: failed to persist pending deletes for room "${roomId}"`, error);
  }
}

/**
 * Clears a post's body content and marks it tombstoned, in place. The same end
 * state is reached whichever order the delete and the post arrive in — this is
 * the one place that decides what "deleted" looks like, used by applyPostDelete
 * (post already present) and appendPost (post landing after its delete).
 */
function tombstone(target: PostNode): void {
  target.deleted = true;
  target.cid = "";
  target.text = undefined;
  target.title = undefined;
  target.roles = undefined;
  target.tags = undefined;
  target.mimeType = undefined;
  target.fileName = undefined;
  target.fileSize = undefined;
  target.startsAt = undefined;
  target.endsAt = undefined;
  target.location = undefined;
  target.thumbCid = undefined;
  target.thumbMimeType = undefined;
  target.capacity = undefined;
  target.editedAt = undefined;
}

/**
 * Reads one surface's posts for a room with reactions merged in. Posts and
 * reactions are stored separately (a reaction can be received before or after
 * the post it targets), so this is the single read path that stitches them.
 */
export function loadPosts(surface: PostSurface, roomId: string): PostNode[] {
  let posts: PostNode[];
  try {
    const raw = localStorage.getItem(POSTS_KEY_PREFIX[surface] + roomId);
    posts = raw ? (JSON.parse(raw) as PostNode[]) : [];
  } catch {
    posts = [];
  }
  const reactions = loadReactionIndex(roomId);
  return posts.map((p) => ({
    ...p,
    surface,
    parentId: p.parentId ?? null,
    reactions: reactions[p.id] ?? [],
  }));
}

function savePosts(surface: PostSurface, roomId: string, posts: PostNode[]) {
  const trimmed =
    posts.length > MAX_POSTS_PER_ROOM ? posts.slice(posts.length - MAX_POSTS_PER_ROOM) : posts;
  // Posts trimmed off the front age out for good — prune their entries from
  // the room's reaction index too, or they'd accumulate forever as orphans
  // (ids are unique across chat/board, so this can't touch the other surface's
  // reactions; see the REACTIONS_KEY_PREFIX comment).
  if (trimmed.length < posts.length) {
    const keptIds = new Set(trimmed.map((p) => p.id));
    const dropped = posts.filter((p) => !keptIds.has(p.id));
    const index = loadReactionIndex(roomId);
    let changed = false;
    for (const p of dropped) {
      if (index[p.id]) {
        delete index[p.id];
        changed = true;
      }
    }
    if (changed) saveReactionIndex(roomId, index);
  }
  // Reactions live in the shared reaction index; keep them out of the post blob
  // so the two never drift or double-persist.
  const bare = trimmed.map(({ reactions: _reactions, ...p }) => p);
  try {
    localStorage.setItem(POSTS_KEY_PREFIX[surface] + roomId, JSON.stringify(bare));
  } catch (error) {
    console.warn(`tc-chat: failed to persist posts for room "${roomId}"`, error);
  }
}

export function appendPost(node: PostNode): PostNode[] {
  const posts = loadPosts(node.surface, node.roomId);
  if (posts.some((p) => p.id === node.id)) return posts;
  // A delete for this id may have already landed while this post was still
  // hydrating; consume the pending entry either way so it can't pile up.
  const pending = loadPendingDeletes(node.surface, node.roomId);
  const pendingAuthor = pending[node.id];
  if (pendingAuthor !== undefined) {
    delete pending[node.id];
    savePendingDeletes(node.surface, node.roomId, pending);
  }
  let toInsert = node;
  if (pendingAuthor !== undefined && pendingAuthor === node.fromId) {
    toInsert = { ...node };
    tombstone(toInsert);
    const index = loadReactionIndex(node.roomId);
    if (index[node.id]) {
      delete index[node.id];
      saveReactionIndex(node.roomId, index);
    }
  }
  const next = [...posts, toInsert].sort((a, b) => a.timestamp - b.timestamp);
  savePosts(node.surface, node.roomId, next);
  return next;
}

/**
 * Applies one reaction toggle to the room's shared reaction index (used by both
 * surfaces). `add` is idempotent per (emoji, fromId); `remove` drops that
 * person's reaction of that emoji. Callers reload their own list (loadPosts)
 * afterwards to pick up the merge.
 */
export function applyReaction(
  roomId: string,
  targetId: string,
  reaction: Reaction,
  op: ReactionOp,
): void {
  const index = loadReactionIndex(roomId);
  const current = index[targetId] ?? [];
  const withoutThis = current.filter(
    (r) => !(r.emoji === reaction.emoji && r.fromId === reaction.fromId),
  );
  const next = op === "add" ? [...withoutThis, reaction] : withoutThis;
  if (next.length > 0) index[targetId] = next;
  else delete index[targetId];
  saveReactionIndex(roomId, index);
}

/**
 * Applies an author's edit to their own post. `authorId` must equal the stored
 * post's `fromId` — that check is the security boundary: an edit wire can be
 * validly signed by anyone (over their OWN DID), so the only thing that makes
 * edits author-only is refusing to mutate a post whose author doesn't match.
 * Deleted posts and media/file kinds (whose CID *is* the file bytes) are never
 * edited. Missing targets no-op — an edit can arrive before its post.
 */
export function applyPostEdit(
  surface: PostSurface,
  roomId: string,
  targetId: string,
  authorId: string,
  patch: {
    cid: string;
    text?: string;
    title?: string;
    editedAt: number;
    startsAt?: number;
    endsAt?: number;
    location?: string;
    thumbCid?: string;
    thumbMimeType?: string;
    capacity?: number;
  },
): void {
  const posts = loadPosts(surface, roomId);
  const target = posts.find((p) => p.id === targetId);
  if (!target || target.fromId !== authorId || target.deleted) return;
  if (target.kind !== "text" && target.kind !== "project" && target.kind !== "event") return;
  target.cid = patch.cid;
  target.text = patch.text;
  target.title = patch.title;
  target.editedAt = patch.editedAt;
  target.startsAt = patch.startsAt;
  target.endsAt = patch.endsAt;
  target.location = patch.location;
  target.thumbCid = patch.thumbCid;
  target.thumbMimeType = patch.thumbMimeType;
  target.capacity = patch.capacity;
  savePosts(surface, roomId, posts);
}

/**
 * Tombstones an author's own post (same author-only boundary as
 * applyPostEdit). The node is kept — id/fromId/timestamp/parentId survive so
 * board reply threads keep their parent — but every piece of content is
 * cleared and `deleted` is set. Reactions on it are dropped from the shared
 * index. A delete can arrive before its post (the post handler awaits a slow
 * storage_get; the delete handler doesn't), so a missing target is recorded in
 * the pending-deletes map instead of being dropped — appendPost consults it
 * and tombstones the node the moment it lands.
 */
export function applyPostDelete(
  surface: PostSurface,
  roomId: string,
  targetId: string,
  authorId: string,
): void {
  const posts = loadPosts(surface, roomId);
  const target = posts.find((p) => p.id === targetId);
  if (!target) {
    const pending = loadPendingDeletes(surface, roomId);
    pending[targetId] = authorId;
    savePendingDeletes(surface, roomId, pending);
    return;
  }
  if (target.fromId !== authorId) return;
  tombstone(target);
  savePosts(surface, roomId, posts);
  const index = loadReactionIndex(roomId);
  if (index[targetId]) {
    delete index[targetId];
    saveReactionIndex(roomId, index);
  }
  const pending = loadPendingDeletes(surface, roomId);
  if (pending[targetId] !== undefined) {
    delete pending[targetId];
    savePendingDeletes(surface, roomId, pending);
  }
}

export type SignedWire = Record<string, unknown> & { id?: string };

export function loadWireLog(roomId: string): SignedWire[] {
  try {
    const raw = localStorage.getItem(WIRE_LOG_KEY_PREFIX + roomId);
    return raw ? (JSON.parse(raw) as SignedWire[]) : [];
  } catch {
    return [];
  }
}

/** Records a signed wire for later replay, deduped by wire id, newest kept. */
export function appendWireLog(roomId: string, wire: SignedWire): void {
  const log = loadWireLog(roomId);
  if (typeof wire.id === "string" && log.some((w) => w.id === wire.id)) return;
  const next = [...log, wire];
  const trimmed =
    next.length > MAX_WIRE_LOG_PER_ROOM ? next.slice(next.length - MAX_WIRE_LOG_PER_ROOM) : next;
  try {
    localStorage.setItem(WIRE_LOG_KEY_PREFIX + roomId, JSON.stringify(trimmed));
  } catch (error) {
    console.warn(`tc-chat: failed to persist wire log for room "${roomId}"`, error);
  }
}

export function loadRooms(): RoomMeta[] {
  try {
    const raw = localStorage.getItem(ROOMS_KEY);
    return raw ? (JSON.parse(raw) as RoomMeta[]) : [];
  } catch {
    return [];
  }
}

function saveRooms(rooms: RoomMeta[]) {
  try {
    localStorage.setItem(ROOMS_KEY, JSON.stringify(rooms));
  } catch (error) {
    console.warn("tc-chat: failed to persist room list", error);
  }
}

export function addRoom(id: string, name: string): RoomMeta[] {
  const rooms = loadRooms();
  if (rooms.some((r) => r.id === id)) return rooms;
  const next = [...rooms, { id, name, joinedAt: Date.now() }];
  saveRooms(next);
  return next;
}

export function removeRoom(id: string): RoomMeta[] {
  const next = loadRooms().filter((r) => r.id !== id);
  saveRooms(next);
  return next;
}

export function loadUsername(): string {
  return localStorage.getItem(USERNAME_KEY) ?? "";
}

export function saveUsername(name: string) {
  try {
    localStorage.setItem(USERNAME_KEY, name);
  } catch (error) {
    console.warn("tc-chat: failed to persist username", error);
  }
}

/**
 * How chat messages are laid out. "list" shows each message as an avatar + name
 * + text row (like a feed); "bubble" is the left/right chat-bubble style.
 */
export type ChatDisplay = "list" | "bubble";

const CHAT_DISPLAY_KEY = "tc-chat:chat-display";

export function loadChatDisplay(): ChatDisplay {
  return localStorage.getItem(CHAT_DISPLAY_KEY) === "bubble" ? "bubble" : "list";
}

export function saveChatDisplay(display: ChatDisplay) {
  try {
    localStorage.setItem(CHAT_DISPLAY_KEY, display);
  } catch (error) {
    console.warn("tc-chat: failed to persist chat display setting", error);
  }
}

const DEV_MODE_KEY = "tc-chat:dev-mode";

export function loadDevMode(): boolean {
  return localStorage.getItem(DEV_MODE_KEY) === "1";
}

export function saveDevMode(enabled: boolean) {
  try {
    localStorage.setItem(DEV_MODE_KEY, enabled ? "1" : "0");
  } catch (error) {
    console.warn("tc-chat: failed to persist dev mode setting", error);
  }
}

const LAST_VIEW_KEY = "tc-chat:last-view";

/**
 * The last place the user was looking at (room + tab + open board thread).
 * Written on every navigation and read back on launch when the URL hash
 * doesn't already say where to go, so reopening the app lands on the same
 * screen as last time.
 */
export function loadLastView(): AppLocation | null {
  try {
    const raw = localStorage.getItem(LAST_VIEW_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AppLocation>;
    if (typeof parsed.roomId !== "string" || !parsed.roomId) return null;
    const tab = (ROOM_TABS as readonly string[]).includes(parsed.tab as string)
      ? (parsed.tab as RoomTab)
      : "chat";
    const threadId = typeof parsed.threadId === "string" && parsed.threadId ? parsed.threadId : null;
    return { roomId: parsed.roomId, tab, threadId };
  } catch {
    return null;
  }
}

export function saveLastView(view: AppLocation) {
  try {
    localStorage.setItem(LAST_VIEW_KEY, JSON.stringify(view));
  } catch (error) {
    console.warn("tc-chat: failed to persist last view", error);
  }
}

const MEDIA_CAUTION_KEY = "tc-chat:media-caution";

/**
 * Whether MediaCautionDialog should gate camera/screen-share starts. Default
 * TRUE (shown) when unset -- broadcasting your camera or screen to everyone
 * currently in the room is easy to trigger without thinking about who that
 * is, so the caution is opt-out rather than opt-in.
 */
export function loadMediaCaution(): boolean {
  return localStorage.getItem(MEDIA_CAUTION_KEY) !== "0";
}

export function saveMediaCaution(enabled: boolean) {
  try {
    localStorage.setItem(MEDIA_CAUTION_KEY, enabled ? "1" : "0");
  } catch (error) {
    console.warn("tc-chat: failed to persist media caution setting", error);
  }
}

const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidRoomId(id: string): boolean {
  return ROOM_ID_PATTERN.test(id);
}

// GIPHY replaced Tenor (Google shut the Tenor API down 2026-06-30), so the
// old "tc-chat:tenor-key" entry is dead — a fresh key under a fresh name.
const GIPHY_KEY_STORAGE_KEY = "tc-chat:giphy-key";

/**
 * GIPHY API key for the GIF picker. Only the sender needs one — the fetched
 * GIF bytes travel through the normal media pipeline, so receivers render it
 * as a plain image/gif post with no GIPHY involvement. Falls back to a
 * build-time env var so a self-hosted deployment can bake in a shared key.
 */
export function loadGiphyApiKey(): string {
  const stored = localStorage.getItem(GIPHY_KEY_STORAGE_KEY);
  if (stored) return stored;
  return (import.meta.env.VITE_GIPHY_API_KEY as string | undefined) ?? "";
}

export function saveGiphyApiKey(key: string): void {
  try {
    localStorage.setItem(GIPHY_KEY_STORAGE_KEY, key);
  } catch (error) {
    console.warn("tc-chat: failed to persist GIPHY API key", error);
  }
}
