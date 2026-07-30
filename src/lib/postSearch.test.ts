import { describe, it, expect, beforeEach } from "vitest";
import { appendPost, applyPostDelete, type PostNode, type PostSurface } from "./chatStore";
import { searchPosts, SEARCH_SURFACES, type SearchScopeRoom } from "./postSearch";

// Mirrors chatStore.test.ts's helper: a minimal, overridable PostNode so each
// test only spells out what it cares about.
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

const roomOne: SearchScopeRoom = { id: "r1", name: "Room One" };
const roomTwo: SearchScopeRoom = { id: "r2", name: "Room Two" };

describe("postSearch", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("exposes the four surfaces in tab order", () => {
    expect(SEARCH_SURFACES).toEqual(["chat", "board", "calendar", "gallery"]);
  });

  it("finds a match in post.text", () => {
    appendPost(post({ id: "1", roomId: "r1", surface: "chat", text: "hello world" }));
    const hits = searchPosts("world", [roomOne]);
    expect(hits.map((h) => h.post.id)).toEqual(["1"]);
    expect(hits[0].roomName).toBe("Room One");
    expect(hits[0].surface).toBe("chat");
  });

  it("finds a match in post.title", () => {
    appendPost(
      post({ id: "2", roomId: "r1", surface: "board", text: undefined, title: "Recruiting cooks" }),
    );
    const hits = searchPosts("cooks", [roomOne]);
    expect(hits.map((h) => h.post.id)).toEqual(["2"]);
  });

  it("finds a match in post.fileName", () => {
    appendPost(
      post({
        id: "3",
        roomId: "r1",
        surface: "gallery",
        kind: "media",
        text: undefined,
        fileName: "vacation-photo.png",
      }),
    );
    const hits = searchPosts("vacation", [roomOne]);
    expect(hits.map((h) => h.post.id)).toEqual(["3"]);
  });

  it("matches case-insensitively", () => {
    appendPost(post({ id: "4", roomId: "r1", surface: "chat", text: "Hello WORLD" }));
    expect(searchPosts("hello world", [roomOne]).map((h) => h.post.id)).toEqual(["4"]);
    expect(searchPosts("HELLO", [roomOne]).map((h) => h.post.id)).toEqual(["4"]);
  });

  it("skips tombstoned posts — a delete clears the body there's nothing left to find", () => {
    appendPost(
      post({ id: "5", roomId: "r1", surface: "chat", fromId: "author", text: "secret message" }),
    );
    applyPostDelete("chat", "r1", "5", "author");
    expect(searchPosts("secret", [roomOne])).toEqual([]);
  });

  it("returns no results for a blank or whitespace-only query, without touching storage", () => {
    appendPost(post({ id: "6", roomId: "r1", surface: "chat", text: "anything" }));
    expect(searchPosts("", [roomOne])).toEqual([]);
    expect(searchPosts("   ", [roomOne])).toEqual([]);
  });

  it("searches across every room and every surface given", () => {
    appendPost(post({ id: "c1", roomId: "r1", surface: "chat", text: "shared keyword here", timestamp: 100 }));
    appendPost(
      post({
        id: "b1",
        roomId: "r1",
        surface: "board",
        text: undefined,
        title: "shared keyword title",
        timestamp: 200,
      }),
    );
    appendPost(
      post({
        id: "e1",
        roomId: "r2",
        surface: "calendar",
        kind: "event",
        text: undefined,
        title: "shared keyword event",
        timestamp: 300,
      }),
    );
    const hits = searchPosts("shared keyword", [roomOne, roomTwo]);
    expect(hits.map((h) => h.post.id).sort()).toEqual(["b1", "c1", "e1"]);
  });

  it("sorts hits newest-first by timestamp", () => {
    appendPost(post({ id: "old", roomId: "r1", surface: "chat", text: "match old", timestamp: 100 }));
    appendPost(post({ id: "new", roomId: "r1", surface: "chat", text: "match new", timestamp: 500 }));
    appendPost(post({ id: "mid", roomId: "r1", surface: "chat", text: "match mid", timestamp: 300 }));
    const hits = searchPosts("match", [roomOne]);
    expect(hits.map((h) => h.post.id)).toEqual(["new", "mid", "old"]);
  });

  it("caps results at the limit, keeping the newest after sorting (not the first found)", () => {
    for (let i = 0; i < 10; i++) {
      appendPost(post({ id: `p${i}`, roomId: "r1", surface: "chat", text: "capped match", timestamp: i }));
    }
    const hits = searchPosts("capped", [roomOne], { limit: 3 });
    expect(hits.map((h) => h.post.id)).toEqual(["p9", "p8", "p7"]);
  });

  it("defaults the limit to 100", () => {
    for (let i = 0; i < 150; i++) {
      appendPost(post({ id: `q${i}`, roomId: "r1", surface: "chat", text: "default-capped", timestamp: i }));
    }
    expect(searchPosts("default-capped", [roomOne])).toHaveLength(100);
  });

  it("centres a long snippet on the match and truncates with an ellipsis on both cut sides", () => {
    const long = "a".repeat(200) + "NEEDLE" + "b".repeat(200);
    appendPost(post({ id: "long1", roomId: "r1", surface: "chat", text: long }));
    const hits = searchPosts("needle", [roomOne]);
    expect(hits).toHaveLength(1);
    const { snippet } = hits[0];
    expect(snippet.toLowerCase()).toContain("needle");
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
    // ~80 visible chars plus the two ellipsis characters.
    expect(snippet.length).toBeLessThanOrEqual(82);
  });

  it("does not add an ellipsis on a side the window doesn't cut", () => {
    appendPost(
      post({
        id: "short1",
        roomId: "r1",
        surface: "chat",
        text: "needle at the start of a short message",
      }),
    );
    const hits = searchPosts("needle", [roomOne]);
    expect(hits[0].snippet).toBe("needle at the start of a short message");
  });

  it("collapses internal whitespace/newlines in the snippet", () => {
    appendPost(
      post({ id: "ws1", roomId: "r1", surface: "chat", text: "line one\n\n  needle  \nline two" }),
    );
    const hits = searchPosts("needle", [roomOne]);
    expect(hits[0].snippet).not.toMatch(/\n/);
    expect(hits[0].snippet).not.toMatch(/ {2,}/);
  });

  it("narrows the search to the given surfaces", () => {
    appendPost(post({ id: "c1", roomId: "r1", surface: "chat", text: "narrow match" }));
    appendPost(
      post({ id: "b1", roomId: "r1", surface: "board", text: undefined, title: "narrow match" }),
    );
    const hits = searchPosts("narrow", [roomOne], { surfaces: ["chat"] });
    expect(hits.map((h) => h.post.id)).toEqual(["c1"]);
  });

  it("a room with no matching history doesn't stop the search across other rooms", () => {
    appendPost(post({ id: "ok1", roomId: "r1", surface: "chat", text: "resilient match" }));
    const hits = searchPosts("resilient", [{ id: "empty-room", name: "Empty" }, roomOne]);
    expect(hits.map((h) => h.post.id)).toEqual(["ok1"]);
  });
});
