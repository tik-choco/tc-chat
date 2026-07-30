import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  loadRoomAlerts,
  roomAlertsFor,
  shouldNotifyRoom,
  shouldBadgeRoom,
  setRoomAlerts,
  subscribeRoomAlerts,
  __resetRoomAlertCacheForTests,
  DEFAULT_ROOM_ALERTS,
  MAX_TRACKED_ROOMS,
  type RoomAlertPrefs,
} from "./roomNotifyStore";

const KEY = "tc-chat:room-alerts:v1";

describe("roomNotifyStore", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetRoomAlertCacheForTests();
    vi.restoreAllMocks();
  });

  it("returns the default prefs for an unknown room", () => {
    expect(roomAlertsFor("room-a")).toEqual(DEFAULT_ROOM_ALERTS);
    expect(shouldNotifyRoom("room-a")).toBe(true);
    expect(shouldBadgeRoom("room-a")).toBe(true);
    expect(loadRoomAlerts()).toEqual({});
  });

  it("set/read round-trips a non-default preference", () => {
    setRoomAlerts("room-a", { notify: false, badge: false });
    expect(roomAlertsFor("room-a")).toEqual({ notify: false, badge: false });
    expect(loadRoomAlerts()).toEqual({ "room-a": { notify: false, badge: false } });
  });

  it("persists non-default prefs under tc-chat:room-alerts:v1", () => {
    setRoomAlerts("room-a", { notify: false, badge: true });
    const raw = localStorage.getItem(KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!)).toEqual({ "room-a": { notify: false, badge: true } });
  });

  it("a room set back to the default is removed from storage entirely", () => {
    setRoomAlerts("room-a", { notify: false, badge: false });
    expect(loadRoomAlerts()).not.toEqual({});

    setRoomAlerts("room-a", { notify: true, badge: true });
    expect(loadRoomAlerts()).toEqual({});
    expect(localStorage.getItem(KEY)).toBe(JSON.stringify({}));
    expect(roomAlertsFor("room-a")).toEqual(DEFAULT_ROOM_ALERTS);
  });

  it("merges a partial patch over the room's current effective prefs", () => {
    setRoomAlerts("room-a", { notify: false });
    expect(roomAlertsFor("room-a")).toEqual({ notify: false, badge: true });

    setRoomAlerts("room-a", { badge: false });
    expect(roomAlertsFor("room-a")).toEqual({ notify: false, badge: false });

    // Patching notify back to true alone merges over the *current* effective
    // prefs, not the bare default — badge is still false from the previous
    // patch, so the room stays stored (not yet back at the full default).
    setRoomAlerts("room-a", { notify: true });
    expect(roomAlertsFor("room-a")).toEqual({ notify: true, badge: false });
    expect(loadRoomAlerts()).toEqual({ "room-a": { notify: true, badge: false } });

    // Only once both fields are back at their defaults does the entry drop.
    setRoomAlerts("room-a", { badge: true });
    expect(roomAlertsFor("room-a")).toEqual(DEFAULT_ROOM_ALERTS);
    expect(loadRoomAlerts()).toEqual({});
  });

  it("shouldNotifyRoom/shouldBadgeRoom reflect writes independently", () => {
    setRoomAlerts("room-a", { notify: false });
    expect(shouldNotifyRoom("room-a")).toBe(false);
    expect(shouldBadgeRoom("room-a")).toBe(true);

    setRoomAlerts("room-a", { badge: false, notify: true });
    expect(shouldNotifyRoom("room-a")).toBe(true);
    expect(shouldBadgeRoom("room-a")).toBe(false);
  });

  it("loadRoomAlerts returns {} on corrupted JSON rather than throwing", () => {
    localStorage.setItem(KEY, "{not valid json");
    expect(() => loadRoomAlerts()).not.toThrow();
    expect(loadRoomAlerts()).toEqual({});
  });

  it("loadRoomAlerts returns {} when the stored value isn't a plain object", () => {
    localStorage.setItem(KEY, JSON.stringify(["room-a"]));
    expect(loadRoomAlerts()).toEqual({});

    localStorage.setItem(KEY, JSON.stringify("room-a"));
    expect(loadRoomAlerts()).toEqual({});
  });

  it("drops individually malformed entries but keeps valid ones", () => {
    const garbage = {
      "room-valid": { notify: false, badge: true },
      "room-bad-shape": { notify: "nope", badge: true },
      "room-missing-badge": { notify: false },
      "room-null": null,
      "room-string": "nope",
    };
    localStorage.setItem(KEY, JSON.stringify(garbage));
    expect(loadRoomAlerts()).toEqual({ "room-valid": { notify: false, badge: true } });
  });

  it("caps at MAX_TRACKED_ROOMS, evicting the oldest-inserted room first", () => {
    for (let i = 0; i < MAX_TRACKED_ROOMS + 1; i++) {
      setRoomAlerts(`room-${i}`, { notify: false, badge: false });
    }

    const all = loadRoomAlerts();
    expect(Object.keys(all)).toHaveLength(MAX_TRACKED_ROOMS);
    // room-0 was the first ever inserted, so it's the one evicted once we
    // cross the cap.
    expect(roomAlertsFor("room-0")).toEqual(DEFAULT_ROOM_ALERTS);
    expect(roomAlertsFor("room-1")).toEqual({ notify: false, badge: false });
    expect(roomAlertsFor(`room-${MAX_TRACKED_ROOMS}`)).toEqual({ notify: false, badge: false });
  });

  it("subscribeRoomAlerts fires on mutate and stops after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeRoomAlerts(listener);

    setRoomAlerts("room-a", { notify: false });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith({ "room-a": { notify: false, badge: true } });

    setRoomAlerts("room-a", { notify: true, badge: true });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith({});

    unsubscribe();
    setRoomAlerts("room-b", { notify: false });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("supports multiple subscribers independently", () => {
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = subscribeRoomAlerts(a);
    const unsubB = subscribeRoomAlerts(b);

    setRoomAlerts("room-a", { notify: false });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    unsubB();
    setRoomAlerts("room-b", { badge: false });
    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledTimes(1);

    unsubA();
  });

  it("invalidates the cache and notifies subscribers on a cross-tab storage change", () => {
    setRoomAlerts("room-a", { notify: false });
    const listener = vi.fn();
    const unsubscribe = subscribeRoomAlerts(listener);

    // Simulate another tab silencing a second room directly in localStorage,
    // then firing the storage event this tab would receive for it.
    const next: Record<string, RoomAlertPrefs> = {
      "room-a": { notify: false, badge: true },
      "room-b": { notify: true, badge: false },
    };
    localStorage.setItem(KEY, JSON.stringify(next));
    window.dispatchEvent(new StorageEvent("storage", { key: KEY }));

    expect(shouldBadgeRoom("room-b")).toBe(false);
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it("treats a storage event with key === null (localStorage.clear()) as an invalidation", () => {
    setRoomAlerts("room-a", { notify: false });
    localStorage.clear();
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(roomAlertsFor("room-a")).toEqual(DEFAULT_ROOM_ALERTS);
    expect(loadRoomAlerts()).toEqual({});
  });

  it("degrades without throwing when localStorage.setItem throws (quota exceeded)", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    expect(() => setRoomAlerts("room-a", { notify: false })).not.toThrow();
    // The in-memory cache still reflects the write even though persisting failed.
    expect(roomAlertsFor("room-a")).toEqual({ notify: false, badge: true });
    expect(loadRoomAlerts()).toEqual({ "room-a": { notify: false, badge: true } });
  });
});
