import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  loadMutes,
  isMuted,
  mutePeer,
  unmutePeer,
  subscribeMutes,
  __resetMuteCacheForTests,
  MAX_MUTED_PEERS,
  type MutedPeer,
} from "./muteStore";

const KEY = "tc-chat:muted-peers:v1";

describe("muteStore", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetMuteCacheForTests();
    vi.restoreAllMocks();
  });

  it("loadMutes returns [] when nothing is stored", () => {
    expect(loadMutes()).toEqual([]);
  });

  it("loadMutes returns [] on corrupted JSON rather than throwing", () => {
    localStorage.setItem(KEY, "{not valid json");
    expect(() => loadMutes()).not.toThrow();
    expect(loadMutes()).toEqual([]);
  });

  it("loadMutes returns [] when the stored value isn't an array", () => {
    localStorage.setItem(KEY, JSON.stringify({ did: "did:key:z1", name: "x", mutedAt: 1 }));
    expect(loadMutes()).toEqual([]);
  });

  it("loadMutes drops individually malformed elements but keeps valid ones", () => {
    const valid: MutedPeer = { did: "did:key:zValid", name: "Valid", mutedAt: 5 };
    const garbage = [
      valid,
      { did: "did:key:zNoName", mutedAt: 6 }, // missing name
      { did: "", name: "blank did", mutedAt: 7 }, // blank did
      { did: "did:key:zBadTime", name: "bad time", mutedAt: "not-a-number" },
      null,
      "just a string",
    ];
    localStorage.setItem(KEY, JSON.stringify(garbage));
    expect(loadMutes()).toEqual([valid]);
  });

  it("loadMutes round-trips valid storage, newest mutedAt first", () => {
    const raw: MutedPeer[] = [
      { did: "did:key:zA", name: "Alice", mutedAt: 100 },
      { did: "did:key:zB", name: "Bob", mutedAt: 200 },
    ];
    localStorage.setItem(KEY, JSON.stringify(raw));
    expect(loadMutes()).toEqual([raw[1], raw[0]]);
  });

  it("mutes a peer and reports it muted", () => {
    expect(isMuted("did:key:zA")).toBe(false);
    const list = mutePeer("did:key:zA", "Alice");
    expect(isMuted("did:key:zA")).toBe(true);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ did: "did:key:zA", name: "Alice" });
    expect(typeof list[0].mutedAt).toBe("number");
  });

  it("persists muted peers under tc-chat:muted-peers:v1", () => {
    mutePeer("did:key:zA", "Alice");
    const raw = localStorage.getItem(KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!)).toEqual([expect.objectContaining({ did: "did:key:zA", name: "Alice" })]);
  });

  it("re-muting an existing did refreshes name/mutedAt without duplicating", () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
    mutePeer("did:key:zA", "Alice");
    vi.spyOn(Date, "now").mockReturnValue(2000);
    const list = mutePeer("did:key:zA", "Alice Renamed");

    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({ did: "did:key:zA", name: "Alice Renamed", mutedAt: 2000 });
  });

  it("rejects a blank/whitespace-only did without changing the list", () => {
    mutePeer("did:key:zA", "Alice");
    const before = loadMutes();
    const afterBlank = mutePeer("", "Nobody");
    const afterWhitespace = mutePeer("   ", "Nobody");
    expect(afterBlank).toEqual(before);
    expect(afterWhitespace).toEqual(before);
    expect(isMuted("")).toBe(false);
  });

  it("unmutes a peer", () => {
    mutePeer("did:key:zA", "Alice");
    expect(isMuted("did:key:zA")).toBe(true);

    const list = unmutePeer("did:key:zA");
    expect(list).toEqual([]);
    expect(isMuted("did:key:zA")).toBe(false);
  });

  it("unmuting a peer that isn't muted is a no-op", () => {
    mutePeer("did:key:zA", "Alice");
    const before = loadMutes();
    const after = unmutePeer("did:key:zNeverMuted");
    expect(after).toEqual(before);
  });

  it("caps at MAX_MUTED_PEERS, evicting the oldest mutedAt first", () => {
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now++);

    for (let i = 0; i < MAX_MUTED_PEERS + 1; i++) {
      mutePeer(`did:key:z${i}`, `Peer ${i}`);
    }

    const list = loadMutes();
    expect(list).toHaveLength(MAX_MUTED_PEERS);
    // did:key:z0 had mutedAt 0, the oldest of the batch, so it's the one evicted.
    expect(isMuted("did:key:z0")).toBe(false);
    expect(isMuted("did:key:z1")).toBe(true);
    expect(isMuted(`did:key:z${MAX_MUTED_PEERS}`)).toBe(true);
  });

  it("subscribeMutes fires on mutate and stops after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeMutes(listener);

    mutePeer("did:key:zA", "Alice");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith([
      expect.objectContaining({ did: "did:key:zA", name: "Alice" }),
    ]);

    unmutePeer("did:key:zA");
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    mutePeer("did:key:zB", "Bob");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("supports multiple subscribers independently", () => {
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = subscribeMutes(a);
    const unsubB = subscribeMutes(b);

    mutePeer("did:key:zA", "Alice");
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    unsubB();
    mutePeer("did:key:zB", "Bob");
    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledTimes(1);

    unsubA();
  });

  it("invalidates the cache and notifies subscribers on a cross-tab storage change", () => {
    mutePeer("did:key:zA", "Alice");
    const listener = vi.fn();
    const unsubscribe = subscribeMutes(listener);

    // Simulate another tab muting a second peer directly in localStorage,
    // then firing the storage event this tab would receive for it.
    const nextRaw: MutedPeer[] = [
      { did: "did:key:zA", name: "Alice", mutedAt: 1 },
      { did: "did:key:zB", name: "Bob", mutedAt: 2 },
    ];
    localStorage.setItem(KEY, JSON.stringify(nextRaw));
    window.dispatchEvent(new StorageEvent("storage", { key: KEY }));

    expect(isMuted("did:key:zB")).toBe(true);
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it("treats a storage event with key === null (localStorage.clear()) as an invalidation", () => {
    mutePeer("did:key:zA", "Alice");
    localStorage.clear();
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(isMuted("did:key:zA")).toBe(false);
    expect(loadMutes()).toEqual([]);
  });

  it("degrades without throwing when localStorage.setItem throws (quota exceeded)", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    expect(() => mutePeer("did:key:zA", "Alice")).not.toThrow();
    // The in-memory cache still reflects the mute even though persisting failed.
    expect(isMuted("did:key:zA")).toBe(true);
    expect(loadMutes()).toEqual([
      expect.objectContaining({ did: "did:key:zA", name: "Alice" }),
    ]);
  });
});
