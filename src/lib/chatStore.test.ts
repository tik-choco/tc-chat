import { describe, it, expect, beforeEach } from "vitest";
import {
  appendPost,
  loadPosts,
  isValidRoomId,
  addRoom,
  loadRooms,
  applyReaction,
  applyPostEdit,
  applyPostDelete,
  appendWireLog,
  loadWireLog,
  loadLastView,
  saveLastView,
  type PostNode,
  type PostSurface,
} from "./chatStore";

function post(
  overrides: Partial<PostNode> & Pick<PostNode, "id" | "roomId"> & { surface?: PostSurface },
): PostNode {
  return {
    surface: "board",
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

describe("chatStore", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("appends and sorts chat posts by timestamp, deduping by id", () => {
    appendPost(post({ id: "1", roomId: "r1", surface: "chat", timestamp: 200, text: "second" }));
    appendPost(post({ id: "2", roomId: "r1", surface: "chat", timestamp: 100, text: "first" }));
    appendPost(post({ id: "1", roomId: "r1", surface: "chat", timestamp: 200, text: "dup" }));

    const messages = loadPosts("chat", "r1");
    expect(messages).toHaveLength(2);
    expect(messages[0].text).toBe("first");
    expect(messages[1].text).toBe("second");
  });

  it("keeps the chat, board and calendar surfaces separate even in the same room", () => {
    appendPost(post({ id: "c1", roomId: "r1", surface: "chat", text: "chat msg" }));
    appendPost(post({ id: "b1", roomId: "r1", surface: "board", text: "board post" }));
    appendPost(
      post({ id: "e1", roomId: "r1", surface: "calendar", kind: "event", title: "Standup", startsAt: 500 }),
    );
    expect(loadPosts("chat", "r1").map((p) => p.id)).toEqual(["c1"]);
    expect(loadPosts("board", "r1").map((p) => p.id)).toEqual(["b1"]);
    expect(loadPosts("calendar", "r1").map((p) => p.id)).toEqual(["e1"]);
    expect(loadPosts("calendar", "r1")[0].startsAt).toBe(500);
  });

  it("appendPost/loadPosts round-trips gallery posts under their own localStorage key", () => {
    appendPost(
      post({
        id: "g1",
        roomId: "r1",
        surface: "gallery",
        kind: "media",
        text: undefined,
        mimeType: "image/png",
        fileName: "pic.png",
        fileSize: 123,
      }),
    );

    const items = loadPosts("gallery", "r1");
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("g1");
    expect(items[0].mimeType).toBe("image/png");
    expect(localStorage.getItem("tc-chat:gallery:r1")).not.toBeNull();
  });

  it("keeps the gallery surface separate from chat in the same room", () => {
    appendPost(post({ id: "c1", roomId: "r1", surface: "chat", text: "chat msg" }));
    appendPost(
      post({ id: "g1", roomId: "r1", surface: "gallery", kind: "media", text: undefined }),
    );
    expect(loadPosts("chat", "r1").map((p) => p.id)).toEqual(["c1"]);
    expect(loadPosts("gallery", "r1").map((p) => p.id)).toEqual(["g1"]);
  });

  it("applyPostDelete tombstones a gallery post", () => {
    appendPost(
      post({
        id: "g2",
        roomId: "r1",
        surface: "gallery",
        fromId: "author",
        kind: "media",
        text: undefined,
        mimeType: "image/png",
        fileName: "pic.png",
        fileSize: 123,
      }),
    );
    applyPostDelete("gallery", "r1", "g2", "author");

    const tomb = loadPosts("gallery", "r1").find((p) => p.id === "g2")!;
    expect(tomb.deleted).toBe(true);
    expect(tomb.cid).toBe("");
    expect(tomb.mimeType).toBeUndefined();
    expect(tomb.fileName).toBeUndefined();
    expect(tomb.fileSize).toBeUndefined();
  });

  it("validates room ids", () => {
    expect(isValidRoomId("valid-room_123")).toBe(true);
    expect(isValidRoomId("")).toBe(false);
    expect(isValidRoomId("has space")).toBe(false);
  });

  it("adds a room without duplicating", () => {
    addRoom("r1", "Room One");
    addRoom("r1", "Room One");
    expect(loadRooms()).toHaveLength(1);
  });

  it("stores a room's display name separately from its id", () => {
    addRoom("secret-room-42", "みんなの部屋");
    const room = loadRooms().find((r) => r.id === "secret-room-42");
    expect(room?.id).toBe("secret-room-42");
    expect(room?.name).toBe("みんなの部屋");
    // Re-joining the same id keeps the first name (dedup by id), not the label.
    addRoom("secret-room-42", "別名");
    expect(loadRooms().find((r) => r.id === "secret-room-42")?.name).toBe("みんなの部屋");
  });

  it("appends and sorts board posts by timestamp, deduping by id", () => {
    appendPost(post({ id: "p1", roomId: "r1", timestamp: 200, title: "second" }));
    appendPost(post({ id: "p2", roomId: "r1", timestamp: 100, title: "first" }));
    appendPost(post({ id: "p1", roomId: "r1", timestamp: 200, title: "dup" }));

    const nodes = loadPosts("board", "r1");
    expect(nodes).toHaveLength(2);
    expect(nodes[0].title).toBe("first");
    expect(nodes[1].title).toBe("second");
  });

  it("keeps board posts scoped to their own room", () => {
    appendPost(post({ id: "p1", roomId: "r1" }));
    expect(loadPosts("board", "r2")).toHaveLength(0);
  });

  it("preserves parentId so comments can nest", () => {
    appendPost(post({ id: "root", roomId: "r1" }));
    appendPost(post({ id: "child", roomId: "r1", parentId: "root", timestamp: 150 }));
    const nodes = loadPosts("board", "r1");
    expect(nodes.find((n) => n.id === "child")?.parentId).toBe("root");
  });

  it("adds a reaction, dedupes per (emoji, person), and toggles it off", () => {
    appendPost(post({ id: "n1", roomId: "r1" }));

    applyReaction("r1", "n1", { emoji: "👍", fromId: "u1", fromName: "U1" }, "add");
    applyReaction("r1", "n1", { emoji: "👍", fromId: "u1", fromName: "U1" }, "add");
    applyReaction("r1", "n1", { emoji: "👍", fromId: "u2", fromName: "U2" }, "add");

    let reactions = loadPosts("board", "r1")[0].reactions;
    expect(reactions).toHaveLength(2);
    expect(reactions.map((r) => r.fromId).sort()).toEqual(["u1", "u2"]);

    applyReaction("r1", "n1", { emoji: "👍", fromId: "u1", fromName: "U1" }, "remove");
    reactions = loadPosts("board", "r1")[0].reactions;
    expect(reactions).toHaveLength(1);
    expect(reactions[0].fromId).toBe("u2");
  });

  it("merges a reaction that arrived before its post", () => {
    applyReaction("r1", "late", { emoji: "🎉", fromId: "u1", fromName: "U1" }, "add");
    expect(loadPosts("board", "r1")).toHaveLength(0);
    appendPost(post({ id: "late", roomId: "r1" }));
    expect(loadPosts("board", "r1")[0].reactions).toHaveLength(1);
  });

  it("shares the reaction index across surfaces (unique target ids)", () => {
    appendPost(post({ id: "m1", roomId: "r1", surface: "chat" }));
    applyReaction("r1", "m1", { emoji: "👍", fromId: "u2", fromName: "U2" }, "add");
    expect(loadPosts("chat", "r1")[0].reactions).toHaveLength(1);
  });

  it("prunes the reaction index when a room's post history is trimmed past the cap", () => {
    const roomId = "trim-room";
    appendPost(post({ id: "old", roomId, surface: "chat", timestamp: 0, text: "first ever" }));
    applyReaction(roomId, "old", { emoji: "👍", fromId: "u1", fromName: "U1" }, "add");
    expect(loadPosts("chat", roomId).find((p) => p.id === "old")?.reactions).toHaveLength(1);

    // Push the room's history past MAX_POSTS_PER_ROOM (500) so "old" ages out
    // of the cap and savePosts trims it off.
    for (let i = 0; i < 500; i++) {
      appendPost(post({ id: `p${i}`, roomId, surface: "chat", timestamp: i + 1, text: `msg ${i}` }));
    }

    const posts = loadPosts("chat", roomId);
    expect(posts).toHaveLength(500);
    expect(posts.find((p) => p.id === "old")).toBeUndefined();

    // The trimmed-out post's reaction entry must not linger forever as an
    // orphan in the room's reaction index.
    const raw = localStorage.getItem(`tc-chat:reactions:${roomId}`);
    const index = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    expect(index.old).toBeUndefined();
  });

  it("applyPostEdit updates body fields and editedAt for the matching author", () => {
    appendPost(post({ id: "e1", roomId: "r1", fromId: "author", cid: "cid-old", text: "old" }));
    applyPostEdit("board", "r1", "e1", "author", { cid: "cid-new", text: "new", editedAt: 999 });

    const edited = loadPosts("board", "r1")[0];
    expect(edited.text).toBe("new");
    expect(edited.cid).toBe("cid-new");
    expect(edited.editedAt).toBe(999);
  });

  it("applyPostEdit REJECTS an edit whose author doesn't match the post's fromId", () => {
    appendPost(post({ id: "e2", roomId: "r1", fromId: "author", text: "original" }));
    applyPostEdit("board", "r1", "e2", "attacker", { cid: "cid-x", text: "pwned", editedAt: 1 });

    const unchanged = loadPosts("board", "r1")[0];
    expect(unchanged.text).toBe("original");
    expect(unchanged.editedAt).toBeUndefined();
  });

  it("applyPostEdit refuses media/file kinds and deleted posts", () => {
    appendPost(post({ id: "m1", roomId: "r1", fromId: "author", kind: "media", text: undefined }));
    applyPostEdit("board", "r1", "m1", "author", { cid: "cid-x", text: "sneaky", editedAt: 1 });
    expect(loadPosts("board", "r1")[0].text).toBeUndefined();

    appendPost(post({ id: "d1", roomId: "r1", fromId: "author", text: "bye", timestamp: 200 }));
    applyPostDelete("board", "r1", "d1", "author");
    applyPostEdit("board", "r1", "d1", "author", { cid: "cid-x", text: "revived", editedAt: 1 });
    const tombstone = loadPosts("board", "r1").find((p) => p.id === "d1")!;
    expect(tombstone.deleted).toBe(true);
    expect(tombstone.text).toBeUndefined();
  });

  it("applyPostEdit accepts the 'event' kind and updates calendar-only fields", () => {
    appendPost(
      post({
        id: "ev1",
        roomId: "r1",
        surface: "calendar",
        fromId: "author",
        kind: "event",
        text: undefined,
        title: "Standup",
        startsAt: 1000,
        cid: "cid-old",
      }),
    );
    applyPostEdit("calendar", "r1", "ev1", "author", {
      cid: "cid-new",
      title: "Standup (moved)",
      editedAt: 999,
      startsAt: 2000,
      endsAt: 2500,
      location: "Room A",
    });
    const edited = loadPosts("calendar", "r1")[0];
    expect(edited.title).toBe("Standup (moved)");
    expect(edited.startsAt).toBe(2000);
    expect(edited.endsAt).toBe(2500);
    expect(edited.location).toBe("Room A");
  });

  it("applyPostDelete clears calendar-only fields on tombstone", () => {
    appendPost(
      post({
        id: "ev2",
        roomId: "r1",
        surface: "calendar",
        fromId: "author",
        kind: "event",
        text: undefined,
        title: "Standup",
        startsAt: 1000,
        endsAt: 1500,
        location: "Room A",
      }),
    );
    applyPostDelete("calendar", "r1", "ev2", "author");
    const tomb = loadPosts("calendar", "r1")[0];
    expect(tomb.deleted).toBe(true);
    expect(tomb.startsAt).toBeUndefined();
    expect(tomb.endsAt).toBeUndefined();
    expect(tomb.location).toBeUndefined();
  });

  it("applyPostDelete tombstones: clears content, keeps thread position, drops reactions", () => {
    appendPost(post({ id: "root", roomId: "r1", fromId: "author" }));
    appendPost(
      post({
        id: "del",
        roomId: "r1",
        fromId: "author",
        parentId: "root",
        timestamp: 150,
        title: "t",
        roles: ["r"],
        tags: ["g"],
        mimeType: "image/png",
        fileName: "a.png",
        fileSize: 3,
      }),
    );
    applyReaction("r1", "del", { emoji: "👍", fromId: "u2", fromName: "U2" }, "add");
    applyPostDelete("board", "r1", "del", "author");

    const tomb = loadPosts("board", "r1").find((p) => p.id === "del")!;
    expect(tomb.deleted).toBe(true);
    expect(tomb.text).toBeUndefined();
    expect(tomb.title).toBeUndefined();
    expect(tomb.cid).toBe("");
    expect(tomb.roles).toBeUndefined();
    expect(tomb.tags).toBeUndefined();
    expect(tomb.mimeType).toBeUndefined();
    expect(tomb.fileName).toBeUndefined();
    expect(tomb.fileSize).toBeUndefined();
    // Thread identity survives so replies stay attached.
    expect(tomb.parentId).toBe("root");
    expect(tomb.fromId).toBe("author");
    expect(tomb.timestamp).toBe(150);
    expect(tomb.reactions).toHaveLength(0);
  });

  it("applyPostDelete REJECTS a delete whose author doesn't match the post's fromId", () => {
    appendPost(post({ id: "safe", roomId: "r1", fromId: "author", text: "keep me" }));
    applyPostDelete("board", "r1", "safe", "attacker");

    const kept = loadPosts("board", "r1")[0];
    expect(kept.deleted).toBeUndefined();
    expect(kept.text).toBe("keep me");
  });

  it("applyPostEdit no-ops when the target hasn't arrived yet", () => {
    applyPostEdit("board", "r1", "ghost", "author", { cid: "c", text: "x", editedAt: 1 });
    expect(loadPosts("board", "r1")).toHaveLength(0);
  });

  it("applyPostDelete on a missing target is inert for loadPosts but remembers a pending delete", () => {
    applyPostDelete("board", "r1", "ghost", "author");
    // Nothing to show yet — the post hasn't hydrated — but the delete wasn't dropped;
    // see the "delete arrives before its post" tests below for the pending-delete payoff.
    expect(loadPosts("board", "r1")).toHaveLength(0);
  });

  it("delete-before-post: a pending delete tombstones the post the instant it lands", () => {
    applyPostDelete("chat", "r1", "x", "author");
    // A reaction can also beat the post; it should be dropped same as a normal tombstone.
    applyReaction("r1", "x", { emoji: "👍", fromId: "u1", fromName: "U1" }, "add");

    appendPost(post({ id: "x", roomId: "r1", surface: "chat", fromId: "author", text: "hello", title: "t" }));

    const node = loadPosts("chat", "r1").find((p) => p.id === "x")!;
    expect(node.deleted).toBe(true);
    expect(node.cid).toBe("");
    expect(node.text).toBeUndefined();
    expect(node.title).toBeUndefined();
    expect(node.reactions).toHaveLength(0);
  });

  it("delete-before-post with a mismatched author leaves the post live, and purges the stale pending entry", () => {
    applyPostDelete("chat", "r1", "y", "attacker");
    appendPost(post({ id: "y", roomId: "r1", surface: "chat", fromId: "victim", text: "hi" }));

    const node = loadPosts("chat", "r1").find((p) => p.id === "y")!;
    expect(node.deleted).toBeFalsy();
    expect(node.text).toBe("hi");

    // The mismatched pending entry must have been purged (not left to leak onto
    // some future post with the same id) — a fresh, correctly-authored delete
    // still works normally afterwards.
    applyPostDelete("chat", "r1", "z", "author");
    appendPost(post({ id: "z", roomId: "r1", surface: "chat", fromId: "author", text: "bye" }));
    const tomb = loadPosts("chat", "r1").find((p) => p.id === "z")!;
    expect(tomb.deleted).toBe(true);
    expect(tomb.text).toBeUndefined();
  });

  it("normal-order delete (post then applyPostDelete) leaves no pending entry behind", () => {
    appendPost(post({ id: "d1", roomId: "r1", surface: "chat", fromId: "author", text: "bye" }));
    applyPostDelete("chat", "r1", "d1", "author");
    const tomb = loadPosts("chat", "r1").find((p) => p.id === "d1")!;
    expect(tomb.deleted).toBe(true);

    // A different post id by the same author is unaffected by the delete that
    // already resolved against "d1" — no leftover pending entry to misfire on.
    appendPost(post({ id: "d2", roomId: "r1", surface: "chat", fromId: "author", text: "unrelated" }));
    const other = loadPosts("chat", "r1").find((p) => p.id === "d2")!;
    expect(other.deleted).toBeFalsy();
    expect(other.text).toBe("unrelated");
  });

  it("deleted/editedAt survive a save/load round-trip", () => {
    appendPost(post({ id: "a", roomId: "r1", fromId: "author", text: "v1" }));
    applyPostEdit("board", "r1", "a", "author", { cid: "c2", text: "v2", editedAt: 5 });
    appendPost(post({ id: "b", roomId: "r1", fromId: "author", timestamp: 300 }));
    applyPostDelete("board", "r1", "b", "author");
    // Appending another post rewrites the whole blob — flags must persist.
    appendPost(post({ id: "c", roomId: "r1", timestamp: 400 }));

    const posts = loadPosts("board", "r1");
    expect(posts.find((p) => p.id === "a")?.editedAt).toBe(5);
    expect(posts.find((p) => p.id === "b")?.deleted).toBe(true);
  });

  it("appendPost/loadPosts round-trips a thumbCid on a board post", () => {
    appendPost(
      post({
        id: "thumb1",
        roomId: "r1",
        title: "With thumbnail",
        thumbCid: "cid-thumb",
        thumbMimeType: "image/webp",
      }),
    );
    const loaded = loadPosts("board", "r1").find((p) => p.id === "thumb1")!;
    expect(loaded.thumbCid).toBe("cid-thumb");
    expect(loaded.thumbMimeType).toBe("image/webp");
  });

  it("applyPostDelete clears thumbCid/thumbMimeType on tombstone", () => {
    appendPost(
      post({
        id: "thumb2",
        roomId: "r1",
        fromId: "author",
        thumbCid: "cid-thumb",
        thumbMimeType: "image/webp",
      }),
    );
    applyPostDelete("board", "r1", "thumb2", "author");
    const tomb = loadPosts("board", "r1").find((p) => p.id === "thumb2")!;
    expect(tomb.deleted).toBe(true);
    expect(tomb.thumbCid).toBeUndefined();
    expect(tomb.thumbMimeType).toBeUndefined();
  });

  it("applyPostEdit replaces a thumbnail and can clear it (undefined in the patch)", () => {
    appendPost(
      post({
        id: "thumb3",
        roomId: "r1",
        fromId: "author",
        thumbCid: "cid-old-thumb",
        thumbMimeType: "image/png",
      }),
    );
    applyPostEdit("board", "r1", "thumb3", "author", {
      cid: "cid-new",
      text: "hi",
      editedAt: 1,
      thumbCid: "cid-new-thumb",
      thumbMimeType: "image/webp",
    });
    let edited = loadPosts("board", "r1").find((p) => p.id === "thumb3")!;
    expect(edited.thumbCid).toBe("cid-new-thumb");
    expect(edited.thumbMimeType).toBe("image/webp");

    // Omitting thumbCid/thumbMimeType from the patch clears them (the same
    // unconditional-assignment semantics as every other editable field).
    applyPostEdit("board", "r1", "thumb3", "author", { cid: "cid-new2", text: "hi", editedAt: 2 });
    edited = loadPosts("board", "r1").find((p) => p.id === "thumb3")!;
    expect(edited.thumbCid).toBeUndefined();
    expect(edited.thumbMimeType).toBeUndefined();
  });

  it("appendPost/loadPosts round-trips a capacity on a project board post", () => {
    appendPost(
      post({
        id: "cap1",
        roomId: "r1",
        kind: "project",
        title: "Team recruiting",
        capacity: 4,
      }),
    );
    const loaded = loadPosts("board", "r1").find((p) => p.id === "cap1")!;
    expect(loaded.capacity).toBe(4);
  });

  it("applyPostDelete clears capacity on tombstone", () => {
    appendPost(
      post({
        id: "cap2",
        roomId: "r1",
        fromId: "author",
        kind: "project",
        capacity: 3,
      }),
    );
    applyPostDelete("board", "r1", "cap2", "author");
    const tomb = loadPosts("board", "r1").find((p) => p.id === "cap2")!;
    expect(tomb.deleted).toBe(true);
    expect(tomb.capacity).toBeUndefined();
  });

  it("applyPostEdit replaces capacity and can clear it (omitted from the patch)", () => {
    appendPost(
      post({
        id: "cap3",
        roomId: "r1",
        fromId: "author",
        kind: "project",
        capacity: 2,
      }),
    );
    applyPostEdit("board", "r1", "cap3", "author", {
      cid: "cid-new",
      text: "hi",
      editedAt: 1,
      capacity: 5,
    });
    let edited = loadPosts("board", "r1").find((p) => p.id === "cap3")!;
    expect(edited.capacity).toBe(5);

    // Omitting capacity from the patch clears it (the same unconditional-
    // assignment semantics as every other editable field, e.g. thumbCid).
    applyPostEdit("board", "r1", "cap3", "author", { cid: "cid-new2", text: "hi", editedAt: 2 });
    edited = loadPosts("board", "r1").find((p) => p.id === "cap3")!;
    expect(edited.capacity).toBeUndefined();
  });

  it("wire log records wires in order, dedupes by id, and is room-scoped", () => {
    appendWireLog("r1", { id: "a", type: "tc-chat:post" });
    appendWireLog("r1", { id: "a", type: "tc-chat:post" }); // duplicate id
    appendWireLog("r1", { id: "b", type: "tc-chat:reaction" });
    appendWireLog("r2", { id: "c", type: "tc-chat:post" });

    expect(loadWireLog("r1").map((w) => w.id)).toEqual(["a", "b"]);
    expect(loadWireLog("r2").map((w) => w.id)).toEqual(["c"]);
  });

  it("wire log buckets per surface: a busy chat stream can't evict board history", () => {
    appendWireLog("r1", { id: "board-1", type: "tc-chat:post", surface: "board", timestamp: 1 });
    // Overflow the chat bucket well past its cap.
    for (let i = 0; i < 700; i += 1) {
      appendWireLog("r1", { id: `chat-${i}`, type: "tc-chat:post", surface: "chat", timestamp: 2 + i });
    }
    const log = loadWireLog("r1");
    expect(log.some((w) => w.id === "board-1")).toBe(true);
    expect(log.filter((w) => w.surface === "chat").length).toBe(600);
    // Oldest chat wires were the ones trimmed.
    expect(log.some((w) => w.id === "chat-0")).toBe(false);
    expect(log.some((w) => w.id === "chat-699")).toBe(true);
  });

  it("wire log merges buckets in timestamp order for replay", () => {
    appendWireLog("r1", { id: "p1", type: "tc-chat:post", surface: "chat", timestamp: 10 });
    appendWireLog("r1", { id: "rx", type: "tc-chat:reaction", timestamp: 20 }); // misc bucket
    appendWireLog("r1", { id: "p2", type: "tc-chat:post", surface: "board", timestamp: 15 });
    expect(loadWireLog("r1").map((w) => w.id)).toEqual(["p1", "p2", "rx"]);
  });

  it("migrates a legacy single-key wire log into buckets and removes the old key", () => {
    localStorage.setItem(
      "tc-chat:wirelog:legacy-room",
      JSON.stringify([
        { id: "old-chat", type: "tc-chat:post", surface: "chat", timestamp: 1 },
        { id: "old-react", type: "tc-chat:reaction", timestamp: 2 },
      ]),
    );
    appendWireLog("legacy-room", { id: "new-chat", type: "tc-chat:post", surface: "chat", timestamp: 3 });

    expect(loadWireLog("legacy-room").map((w) => w.id)).toEqual(["old-chat", "old-react", "new-chat"]);
    // Legacy key is gone once the buckets hold everything.
    expect(localStorage.getItem("tc-chat:wirelog:legacy-room")).toBeNull();
    // Migration is idempotent: a second load doesn't duplicate anything.
    expect(loadWireLog("legacy-room")).toHaveLength(3);
  });

  it("last view round-trips through localStorage", () => {
    saveLastView({ roomId: "my-team", tab: "board", threadId: "t-1" });
    expect(loadLastView()).toEqual({ roomId: "my-team", tab: "board", threadId: "t-1" });

    saveLastView({ roomId: "global", tab: "chat", threadId: null });
    expect(loadLastView()).toEqual({ roomId: "global", tab: "chat", threadId: null });
  });

  it("last view is null when unset and survives garbage or partial records", () => {
    expect(loadLastView()).toBeNull();

    localStorage.setItem("tc-chat:last-view", "not json");
    expect(loadLastView()).toBeNull();

    // A record missing its room is useless — better to fall back to default.
    localStorage.setItem("tc-chat:last-view", JSON.stringify({ tab: "board" }));
    expect(loadLastView()).toBeNull();

    // An unknown tab (say, from a newer/older build) degrades to chat.
    localStorage.setItem(
      "tc-chat:last-view",
      JSON.stringify({ roomId: "r", tab: "bogus", threadId: 7 }),
    );
    expect(loadLastView()).toEqual({ roomId: "r", tab: "chat", threadId: null });
  });
});
