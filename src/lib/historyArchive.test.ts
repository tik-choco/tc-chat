import { describe, it, expect, beforeEach } from "vitest";
import {
  appendPost,
  applyPostDelete,
  applyReaction,
  __clearEphemeralRoomStoreForTests,
  type PostNode,
  type PostSurface,
} from "./chatStore";
import {
  ARCHIVE_VERSION,
  archiveFileName,
  archiveSize,
  buildRoomArchive,
  serializeArchive,
} from "./historyArchive";

function post(
  overrides: Partial<PostNode> & Pick<PostNode, "id" | "roomId"> & { surface?: PostSurface },
): PostNode {
  return {
    surface: "chat",
    parentId: null,
    fromId: "a",
    fromName: "A",
    timestamp: 100,
    kind: "text",
    cid: "cid",
    text: "hi",
    reactions: [],
    ...overrides,
  };
}

describe("historyArchive", () => {
  beforeEach(() => {
    localStorage.clear();
    __clearEphemeralRoomStoreForTests();
  });

  it("collects posts from all four surfaces", () => {
    appendPost(post({ id: "c1", roomId: "r1", surface: "chat", text: "chat msg" }));
    appendPost(post({ id: "b1", roomId: "r1", surface: "board", text: "board post" }));
    appendPost(
      post({
        id: "e1",
        roomId: "r1",
        surface: "calendar",
        kind: "event",
        text: undefined,
        title: "Standup",
        startsAt: 500,
      }),
    );
    appendPost(
      post({
        id: "g1",
        roomId: "r1",
        surface: "gallery",
        kind: "media",
        text: undefined,
        mimeType: "image/png",
        fileName: "pic.png",
      }),
    );

    const archive = buildRoomArchive("r1", "My Room", 1000);
    expect(archive.posts.map((p) => p.id).sort()).toEqual(["b1", "c1", "e1", "g1"]);
    expect(archive.version).toBe(ARCHIVE_VERSION);
    expect(archive.roomId).toBe("r1");
    expect(archive.roomName).toBe("My Room");
    expect(archive.exportedAt).toBe(1000);
  });

  it("orders posts chronologically across surfaces combined, not per-surface", () => {
    appendPost(post({ id: "late", roomId: "r1", surface: "chat", timestamp: 300 }));
    appendPost(post({ id: "mid", roomId: "r1", surface: "board", timestamp: 200 }));
    appendPost(
      post({ id: "early", roomId: "r1", surface: "gallery", kind: "media", text: undefined, timestamp: 100 }),
    );

    const archive = buildRoomArchive("r1", "Room", 1000);
    expect(archive.posts.map((p) => p.id)).toEqual(["early", "mid", "late"]);
  });

  it("carries a media post's cid/fileName/mimeType, never a body", () => {
    appendPost(
      post({
        id: "media1",
        roomId: "r1",
        surface: "gallery",
        kind: "media",
        text: undefined,
        cid: "cid-media-bytes",
        mimeType: "image/png",
        fileName: "photo.png",
      }),
    );
    const archive = buildRoomArchive("r1", "Room", 1000);
    const media = archive.posts.find((p) => p.id === "media1")!;
    expect(media.cid).toBe("cid-media-bytes");
    expect(media.fileName).toBe("photo.png");
    expect(media.mimeType).toBe("image/png");
    expect(media.text).toBeUndefined();
    expect(media.title).toBeUndefined();
    // The archive is a JSON metadata record — no "bytes"/binary field exists
    // anywhere in the schema for callers to accidentally populate.
    expect(Object.keys(media).sort()).toEqual(
      ["cid", "fileName", "fromId", "fromName", "id", "kind", "mimeType", "parentId", "reactions", "surface", "timestamp"].sort(),
    );
  });

  it("flattens reactions to {emoji, fromName}, dropping the reactor's DID", () => {
    appendPost(post({ id: "reacted", roomId: "r1", surface: "chat" }));
    applyReaction(
      "r1",
      "reacted",
      { emoji: "\u{1F44D}", fromId: "did:key:zSecretReactorDid", fromName: "Bob" },
      "add",
    );

    const archive = buildRoomArchive("r1", "Room", 1000);
    const target = archive.posts.find((p) => p.id === "reacted")!;
    expect(target.reactions).toEqual([{ emoji: "\u{1F44D}", fromName: "Bob" }]);
    expect(serializeArchive(archive)).not.toContain("did:key:zSecretReactorDid");
  });

  it("keeps a deleted post as a tombstone with no body", () => {
    appendPost(post({ id: "del1", roomId: "r1", surface: "chat", fromId: "author", text: "secret" }));
    applyPostDelete("chat", "r1", "del1", "author");

    const archive = buildRoomArchive("r1", "Room", 1000);
    const tomb = archive.posts.find((p) => p.id === "del1")!;
    expect(tomb.deleted).toBe(true);
    expect(tomb.text).toBeUndefined();
    expect(tomb.cid).toBeUndefined();
  });

  it("reports counts per surface", () => {
    appendPost(post({ id: "c1", roomId: "r1", surface: "chat" }));
    appendPost(post({ id: "c2", roomId: "r1", surface: "chat", timestamp: 200 }));
    appendPost(post({ id: "b1", roomId: "r1", surface: "board" }));

    const archive = buildRoomArchive("r1", "Room", 1000);
    expect(archive.counts).toEqual({ chat: 2, board: 1, calendar: 0, gallery: 0 });
  });

  it("returns a valid, empty archive for a room with no history instead of throwing", () => {
    const archive = buildRoomArchive("empty-room", "Empty", 1000);
    expect(archive.posts).toEqual([]);
    expect(archive.counts).toEqual({ chat: 0, board: 0, calendar: 0, gallery: 0 });
    expect(archiveSize(archive)).toBe(0);
  });

  it("archiveSize counts posts across every surface", () => {
    appendPost(post({ id: "c1", roomId: "r1", surface: "chat" }));
    appendPost(post({ id: "b1", roomId: "r1", surface: "board" }));
    const archive = buildRoomArchive("r1", "Room", 1000);
    expect(archiveSize(archive)).toBe(2);
  });

  describe("archiveFileName", () => {
    it("sanitizes spaces and mixed case", () => {
      const archive = buildRoomArchive("room-id", "My Cool Room", Date.UTC(2026, 6, 30));
      expect(archiveFileName(archive)).toBe("tc-chat-my-cool-room-2026-07-30.json");
    });

    it("collapses slashes and other path-unsafe characters to hyphens", () => {
      const archive = buildRoomArchive("room-id", "team/finance\\Q3", Date.UTC(2026, 6, 30));
      expect(archiveFileName(archive)).toBe("tc-chat-team-finance-q3-2026-07-30.json");
    });

    it("collapses a fully-unicode name to nothing and falls back to the room id", () => {
      const archive = buildRoomArchive("room-id", "みんなの部屋", Date.UTC(2026, 6, 30));
      expect(archiveFileName(archive)).toBe("tc-chat-room-id-2026-07-30.json");
    });

    it("falls back to the room id when an all-punctuation name sanitizes to nothing", () => {
      const archive = buildRoomArchive("secret-room-42", "!!!###", Date.UTC(2026, 6, 30));
      expect(archiveFileName(archive)).toBe("tc-chat-secret-room-42-2026-07-30.json");
    });
  });
});
