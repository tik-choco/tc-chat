import { describe, it, expect, beforeEach, vi } from "vitest";

const pinned = new Set<string>();
const pinCalls: string[] = [];
const unpinCalls: string[] = [];

vi.mock("./mistClient", () => ({
  storage_pin: vi.fn(async (cid: string) => {
    pinCalls.push(cid);
    pinned.add(cid);
  }),
  storage_unpin: vi.fn(async (cid: string) => {
    unpinCalls.push(cid);
    pinned.delete(cid);
  }),
}));

import {
  shouldRelayRoom,
  noteBody,
  releasePost,
  sweepRoom,
  getRelayStats,
  RELAY_PIN_BUDGET_BYTES,
} from "./relayCache";
import { appendPost, type PostNode, type PostSurface } from "./chatStore";
import { GLOBAL_ROOM_ID } from "./util";

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

describe("relayCache", () => {
  beforeEach(() => {
    localStorage.clear();
    pinned.clear();
    pinCalls.length = 0;
    unpinCalls.length = 0;
    vi.clearAllMocks();
  });

  describe("shouldRelayRoom", () => {
    it("is true only for the global room", () => {
      expect(shouldRelayRoom(GLOBAL_ROOM_ID)).toBe(true);
      expect(shouldRelayRoom("some-other-room")).toBe(false);
    });
  });

  describe("noteBody", () => {
    it("pins the CID and records it in the index", async () => {
      await noteBody("r1", "p1", "cid-1", 100);
      expect(pinCalls).toEqual(["cid-1"]);
      const stats = getRelayStats();
      expect(stats.pinnedBytes).toBe(100);
      expect(stats.pinnedPosts).toBe(1);
    });

    it("is idempotent for the same cid on the same post", async () => {
      await noteBody("r1", "p1", "cid-1", 100);
      await noteBody("r1", "p1", "cid-1", 100);
      expect(pinCalls).toEqual(["cid-1"]);
      expect(getRelayStats().pinnedBytes).toBe(100);
    });

    it("accumulates multiple distinct cids under the same post (e.g. body + thumbnail)", async () => {
      await noteBody("r1", "p1", "cid-1", 100);
      await noteBody("r1", "p1", "cid-2", 50);
      expect(pinCalls).toEqual(["cid-1", "cid-2"]);
      const stats = getRelayStats();
      expect(stats.pinnedBytes).toBe(150);
      expect(stats.pinnedPosts).toBe(1);
    });

    it("evicts the oldest posts first once the budget is exceeded, unpinning their cids", async () => {
      const big = Math.floor(RELAY_PIN_BUDGET_BYTES * 0.6);
      await noteBody("r1", "old-post", "cid-old", big);
      await noteBody("r1", "new-post", "cid-new", big);

      // old-post's pin should have been released to make room for new-post.
      expect(unpinCalls).toEqual(["cid-old"]);
      expect(pinned.has("cid-old")).toBe(false);
      expect(pinned.has("cid-new")).toBe(true);

      const stats = getRelayStats();
      expect(stats.pinnedPosts).toBe(1);
      expect(stats.pinnedBytes).toBe(big);
      expect(stats.pinnedBytes).toBeLessThanOrEqual(RELAY_PIN_BUDGET_BYTES);
    });

    it("evicts oldest posts across rooms, not just within one room", async () => {
      const big = Math.floor(RELAY_PIN_BUDGET_BYTES * 0.6);
      await noteBody("room-a", "p-old", "cid-old", big);
      await noteBody("room-b", "p-new", "cid-new", big);

      expect(unpinCalls).toEqual(["cid-old"]);
      const stats = getRelayStats();
      expect(stats.pinnedPosts).toBe(1);
    });
  });

  describe("releasePost", () => {
    it("unpins every cid recorded for the post and removes it from the index", async () => {
      await noteBody("r1", "p1", "cid-1", 100);
      await noteBody("r1", "p1", "cid-2", 50);

      await releasePost("r1", "p1");

      expect(unpinCalls.sort()).toEqual(["cid-1", "cid-2"]);
      expect(pinned.size).toBe(0);
      const stats = getRelayStats();
      expect(stats.pinnedPosts).toBe(0);
      expect(stats.pinnedBytes).toBe(0);
    });

    it("is a safe no-op for a post that was never recorded", async () => {
      await expect(releasePost("r1", "nope")).resolves.toBeUndefined();
      expect(unpinCalls).toEqual([]);
    });

    it("still drops the index entry even if unpin rejects", async () => {
      const { storage_unpin } = await import("./mistClient");
      vi.mocked(storage_unpin).mockRejectedValueOnce(new Error("boom"));

      await noteBody("r1", "p1", "cid-1", 100);
      await releasePost("r1", "p1");

      expect(getRelayStats().pinnedPosts).toBe(0);
    });
  });

  describe("sweepRoom", () => {
    it("releases pins for posts no longer present (evicted) in any local surface", async () => {
      appendPost(post({ id: "p1", roomId: "r1", surface: "chat" }));
      await noteBody("r1", "p1", "cid-1", 100);
      await noteBody("r1", "gone", "cid-gone", 100);

      await sweepRoom("r1");

      expect(unpinCalls).toEqual(["cid-gone"]);
      const stats = getRelayStats();
      expect(stats.pinnedPosts).toBe(1);
    });

    it("treats tombstoned (deleted) posts as gone", async () => {
      appendPost(
        post({ id: "p1", roomId: "r1", surface: "board", deleted: true, text: undefined }),
      );
      await noteBody("r1", "p1", "cid-1", 100);

      await sweepRoom("r1");

      expect(unpinCalls).toEqual(["cid-1"]);
      expect(getRelayStats().pinnedPosts).toBe(0);
    });

    it("checks all four surfaces before releasing", async () => {
      appendPost(post({ id: "gallery-post", roomId: "r1", surface: "gallery", kind: "media" }));
      await noteBody("r1", "gallery-post", "cid-1", 100);

      await sweepRoom("r1");

      expect(unpinCalls).toEqual([]);
      expect(getRelayStats().pinnedPosts).toBe(1);
    });

    it("is a no-op when nothing is indexed for the room", async () => {
      await expect(sweepRoom("empty-room")).resolves.toBeUndefined();
      expect(unpinCalls).toEqual([]);
    });
  });

  describe("fail-soft behavior", () => {
    it("noteBody never throws even when localStorage is broken", async () => {
      const getItemSpy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("quota");
      });
      const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("quota");
      });

      await expect(noteBody("r1", "p1", "cid-1", 100)).resolves.toBeUndefined();
      // Pin still gets attempted even though bookkeeping failed.
      expect(pinCalls).toEqual(["cid-1"]);

      getItemSpy.mockRestore();
      setItemSpy.mockRestore();
    });

    it("noteBody never throws when storage_pin rejects", async () => {
      const { storage_pin } = await import("./mistClient");
      vi.mocked(storage_pin).mockRejectedValueOnce(new Error("network down"));

      await expect(noteBody("r1", "p1", "cid-1", 100)).resolves.toBeUndefined();
      // Bookkeeping still records it despite the pin failure.
      expect(getRelayStats().pinnedPosts).toBe(1);
    });

    it("releasePost never throws even when localStorage is broken", async () => {
      await noteBody("r1", "p1", "cid-1", 100);

      const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("quota");
      });
      await expect(releasePost("r1", "p1")).resolves.toBeUndefined();
      setItemSpy.mockRestore();
    });

    it("sweepRoom never throws even when localStorage read is broken", async () => {
      const getItemSpy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("broken");
      });
      await expect(sweepRoom("r1")).resolves.toBeUndefined();
      getItemSpy.mockRestore();
    });

    it("getRelayStats never throws and returns zeros when localStorage is broken", () => {
      const getItemSpy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("broken");
      });
      expect(getRelayStats()).toEqual({ pinnedBytes: 0, pinnedPosts: 0 });
      getItemSpy.mockRestore();
    });
  });
});
