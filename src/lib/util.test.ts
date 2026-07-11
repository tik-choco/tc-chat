import { describe, it, expect } from "vitest";
import { GLOBAL_ROOM_ID, hashForRoomId, newId, roomIdFromHash } from "./util";
import { isValidRoomId } from "./chatStore";

describe("room ↔ URL hash", () => {
  it("round-trips a room ID through the hash", () => {
    for (const id of [GLOBAL_ROOM_ID, "my-team", "部屋 A", "a/b?c#d"]) {
      expect(roomIdFromHash(hashForRoomId(id))).toBe(id);
    }
  });

  it("renders the hash as #/<encoded roomId>", () => {
    expect(hashForRoomId("global")).toBe("#/global");
    expect(hashForRoomId("部屋 A")).toBe(`#/${encodeURIComponent("部屋 A")}`);
  });

  it("falls back to global for an empty, bare, or malformed hash", () => {
    expect(roomIdFromHash("")).toBe(GLOBAL_ROOM_ID);
    expect(roomIdFromHash("#")).toBe(GLOBAL_ROOM_ID);
    expect(roomIdFromHash("#/")).toBe(GLOBAL_ROOM_ID);
    expect(roomIdFromHash("#/%E0%A4%A")).toBe(GLOBAL_ROOM_ID); // invalid percent-encoding
  });

  it("reads a room ID whether or not the hash has the leading slash", () => {
    expect(roomIdFromHash("#/my-team")).toBe("my-team");
    expect(roomIdFromHash("#my-team")).toBe("my-team");
  });
});

describe("newId", () => {
  it("generates ids that are valid room IDs", () => {
    const ids = Array.from({ length: 5 }, () => newId());
    for (const id of ids) {
      expect(isValidRoomId(id)).toBe(true);
    }
  });

  it("generates distinct ids across consecutive calls", () => {
    const a = newId();
    const b = newId();
    const c = newId();
    expect(a).not.toBe(b);
    expect(b).not.toBe(c);
    expect(a).not.toBe(c);
  });

  it("round-trips a generated id through the hash", () => {
    const id = newId();
    expect(roomIdFromHash(hashForRoomId(id))).toBe(id);
  });
});
