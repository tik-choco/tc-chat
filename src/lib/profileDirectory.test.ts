import { describe, it, expect, beforeEach } from "vitest";
import {
  loadDirectoryStore,
  mergeProfile,
  roomDirectory,
  identityFor,
  EMPTY_DIRECTORY,
  type DirectoryStore,
  type DirectoryProfile,
  type ProfileDirectory,
} from "./profileDirectory";

const KEY = "tc-chat:profile-directory:v2";

function profile(updatedAt: number, displayName = "X"): DirectoryProfile {
  return { displayName, updatedAt };
}

describe("profileDirectory", () => {
  beforeEach(() => localStorage.clear());

  describe("loadDirectoryStore", () => {
    it("returns {} when nothing is stored", () => {
      expect(loadDirectoryStore()).toEqual({});
    });

    it("returns {} on corrupted JSON rather than throwing", () => {
      localStorage.setItem(KEY, "{not valid json");
      expect(() => loadDirectoryStore()).not.toThrow();
      expect(loadDirectoryStore()).toEqual({});
    });
  });

  describe("roomDirectory", () => {
    it("returns the EMPTY_DIRECTORY reference for an unknown or absent room", () => {
      expect(roomDirectory({}, "nope")).toBe(EMPTY_DIRECTORY);
      expect(roomDirectory({ r1: { "did:a": profile(1) } }, "r2")).toBe(EMPTY_DIRECTORY);
      expect(roomDirectory({}, null)).toBe(EMPTY_DIRECTORY);
      expect(roomDirectory({}, undefined)).toBe(EMPTY_DIRECTORY);
    });
  });

  describe("identityFor", () => {
    it("falls back to the given name when the did is unknown", () => {
      expect(identityFor({}, "did:a", "Fallback")).toEqual({
        name: "Fallback",
        avatarCid: undefined,
      });
    });

    it("falls back to the given name when the known profile has no displayName", () => {
      const dir: ProfileDirectory = { "did:a": { updatedAt: 1 } };
      expect(identityFor(dir, "did:a", "Fallback")).toEqual({
        name: "Fallback",
        avatarCid: undefined,
      });
    });

    it("treats a whitespace-only displayName as absent", () => {
      const dir: ProfileDirectory = { "did:a": { displayName: "   ", updatedAt: 1 } };
      expect(identityFor(dir, "did:a", "Fallback").name).toBe("Fallback");
    });

    it("prefers the known displayName and avatarCid over the fallback", () => {
      const dir: ProfileDirectory = {
        "did:a": { displayName: "Alice", avatarCid: "cid-1", updatedAt: 1 },
      };
      expect(identityFor(dir, "did:a", "Fallback")).toEqual({ name: "Alice", avatarCid: "cid-1" });
    });
  });

  describe("mergeProfile: reference equality", () => {
    it("returns the SAME store reference when the incoming updatedAt is stale or equal (no-op)", () => {
      let store: DirectoryStore = {};
      store = mergeProfile(store, "r1", "did:a", profile(10));

      const stale = mergeProfile(store, "r1", "did:a", profile(5));
      expect(stale).toBe(store);

      const equal = mergeProfile(store, "r1", "did:a", profile(10));
      expect(equal).toBe(store);
    });

    it("returns a NEW store reference when the merge actually changes something", () => {
      let store: DirectoryStore = {};
      store = mergeProfile(store, "r1", "did:a", profile(10));

      const next = mergeProfile(store, "r1", "did:a", profile(20));
      expect(next).not.toBe(store);
      expect(next.r1["did:a"].updatedAt).toBe(20);
    });
  });

  describe("mergeProfile: per-room cap (MAX_ENTRIES_PER_ROOM = 200)", () => {
    it("evicts a room's own oldest entries once it exceeds the cap, keeping the newest (including the just-merged did)", () => {
      let store: DirectoryStore = {};
      for (let i = 0; i < 200; i++) {
        store = mergeProfile(store, "busy", `did:${i}`, profile(i));
      }
      expect(Object.keys(store.busy)).toHaveLength(200);

      // One more push over the cap: the oldest entry (did:0) must go, the
      // just-merged did:200 must survive.
      store = mergeProfile(store, "busy", "did:200", profile(200));

      expect(Object.keys(store.busy)).toHaveLength(200);
      expect(store.busy["did:0"]).toBeUndefined();
      expect(store.busy["did:1"]).toBeTruthy(); // next-oldest survivor
      expect(store.busy["did:200"]).toBeTruthy(); // just-merged, always spared
    });

    it("does not let a busy room's overflow evict a separate quiet room's entries (the regression this fix targets)", () => {
      let store: DirectoryStore = {};
      store = mergeProfile(store, "quiet", "did:quiet-a", profile(1));
      store = mergeProfile(store, "quiet", "did:quiet-b", profile(2));

      // Drive "busy" far past its own per-room cap.
      for (let i = 0; i < 250; i++) {
        store = mergeProfile(store, "busy", `did:busy-${i}`, profile(1000 + i));
      }

      expect(store.quiet["did:quiet-a"]).toBeTruthy();
      expect(store.quiet["did:quiet-b"]).toBeTruthy();
      expect(Object.keys(store.quiet)).toHaveLength(2);
      expect(Object.keys(store.busy)).toHaveLength(200);
    });
  });

  describe("mergeProfile: room cap (MAX_ROOMS = 50)", () => {
    it("evicts the least-recently-active room once MAX_ROOMS is exceeded, never the room just merged into", () => {
      let store: DirectoryStore = {};
      for (let i = 0; i < 50; i++) {
        store = mergeProfile(store, `r${i}`, "did:x", profile(i));
      }
      expect(Object.keys(store)).toHaveLength(50);

      // 51st room pushes over the cap: r0 (oldest updatedAt = least active) goes.
      store = mergeProfile(store, "r50", "did:x", profile(50));

      expect(Object.keys(store)).toHaveLength(50);
      expect(store.r0).toBeUndefined();
      expect(store.r1).toBeTruthy(); // next-least-active survivor
      expect(store.r50).toBeTruthy(); // just-merged room, always spared
    });

    it("never evicts the room just merged into, even when its own updatedAt would otherwise make it look least-recently-active", () => {
      let store: DirectoryStore = {};
      for (let i = 0; i < 50; i++) {
        store = mergeProfile(store, `r${i}`, "did:x", profile(1000 + i));
      }

      // Merged with a very old updatedAt, but this room must still survive
      // its own eviction sweep — some OTHER room is evicted instead.
      store = mergeProfile(store, "new-room", "did:x", profile(1));

      expect(Object.keys(store)).toHaveLength(50);
      expect(store["new-room"]).toBeTruthy();
      expect(store.r0).toBeUndefined();
    });
  });

  describe("mergeProfile: empty room pruning", () => {
    it("drops a room already left with zero entries", () => {
      const store: DirectoryStore = { stale: {}, other: { "did:x": profile(1) } };
      const next = mergeProfile(store, "other", "did:y", profile(2));
      expect(next.stale).toBeUndefined();
      expect(next.other["did:y"]).toBeTruthy();
    });
  });

  describe("mergeProfile: persistence", () => {
    it("persists the merged store under the tc-chat:profile-directory:v2 key", () => {
      const store = mergeProfile({}, "r1", "did:a", profile(1));
      const raw = localStorage.getItem(KEY);
      expect(raw).toBeTruthy();
      expect(JSON.parse(raw!)).toEqual(store);
    });
  });
});
