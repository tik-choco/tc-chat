import { describe, it, expect, beforeEach } from "vitest";
import { loadRoomDisplayNames, saveRoomDisplayName } from "./roomDisplayNameStore";

const KEY = "tc-chat:room-display-names:v1";

describe("roomDisplayNameStore", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips a saved override", () => {
    const map = saveRoomDisplayName({}, "r1", "Alice");
    expect(map).toEqual({ r1: "Alice" });
    expect(loadRoomDisplayNames()).toEqual({ r1: "Alice" });
  });

  it("persists under the tc-chat:room-display-names:v1 key", () => {
    saveRoomDisplayName({}, "r1", "Alice");
    const raw = localStorage.getItem(KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!)).toEqual({ r1: "Alice" });
  });

  it("trims leading/trailing whitespace", () => {
    const map = saveRoomDisplayName({}, "r1", "  Alice  ");
    expect(map.r1).toBe("Alice");
  });

  it("caps the name at 60 characters", () => {
    const long = "x".repeat(100);
    const map = saveRoomDisplayName({}, "r1", long);
    expect(map.r1).toBe("x".repeat(60));
    expect(map.r1.length).toBe(60);
  });

  it("clears (deletes) the entry when given an empty name", () => {
    const withName = saveRoomDisplayName({}, "r1", "Alice");
    const cleared = saveRoomDisplayName(withName, "r1", "");
    expect(cleared).toEqual({});
    expect("r1" in cleared).toBe(false);
  });

  it("clears the entry when given a whitespace-only name", () => {
    const withName = saveRoomDisplayName({}, "r1", "Alice");
    const cleared = saveRoomDisplayName(withName, "r1", "   ");
    expect(cleared).toEqual({});
  });

  it("returns the same reference when saving the unchanged value", () => {
    const withName = saveRoomDisplayName({}, "r1", "Alice");
    const again = saveRoomDisplayName(withName, "r1", "Alice");
    expect(again).toBe(withName);
  });

  it("returns the same reference when clearing an already-absent entry", () => {
    const empty: Record<string, string> = {};
    const result = saveRoomDisplayName(empty, "r1", "");
    expect(result).toBe(empty);
  });

  it("yields {} from loadRoomDisplayNames on corrupted JSON rather than throwing", () => {
    localStorage.setItem(KEY, "{not valid json");
    expect(() => loadRoomDisplayNames()).not.toThrow();
    expect(loadRoomDisplayNames()).toEqual({});
  });

  it("yields {} from loadRoomDisplayNames when nothing is stored", () => {
    expect(loadRoomDisplayNames()).toEqual({});
  });

  it("keeps other rooms' overrides untouched when saving one room", () => {
    const map = saveRoomDisplayName({ r1: "Alice" }, "r2", "Bob");
    expect(map).toEqual({ r1: "Alice", r2: "Bob" });
  });
});
