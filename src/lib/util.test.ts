import { describe, it, expect } from "vitest";
import {
  GLOBAL_ROOM_ID,
  PERSONAL_ROOM_ID,
  isPersonalRoom,
  hashForLocation,
  hashForRoomId,
  locationFromHash,
  newId,
  roomIdFromHash,
  type AppLocation,
} from "./util";
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

describe("location ↔ URL hash", () => {
  it("keeps the historical bare form for the chat tab", () => {
    expect(hashForLocation({ roomId: "global", tab: "chat", threadId: null })).toBe("#/global");
  });

  it("appends the tab segment for non-chat tabs, and the thread on board", () => {
    expect(hashForLocation({ roomId: "r", tab: "calendar", threadId: null })).toBe("#/r/calendar");
    expect(hashForLocation({ roomId: "r", tab: "gallery", threadId: null })).toBe("#/r/gallery");
    expect(hashForLocation({ roomId: "r", tab: "board", threadId: null })).toBe("#/r/board");
    expect(hashForLocation({ roomId: "r", tab: "board", threadId: "t-1" })).toBe("#/r/board/t-1");
  });

  it("only shows the thread on the board tab (a lingering id stays out of chat URLs)", () => {
    expect(hashForLocation({ roomId: "r", tab: "chat", threadId: "t-1" })).toBe("#/r");
  });

  it("round-trips locations, including ids that need percent-encoding", () => {
    const locs: AppLocation[] = [
      { roomId: GLOBAL_ROOM_ID, tab: "chat", threadId: null },
      { roomId: "my-team", tab: "board", threadId: newId() },
      { roomId: "部屋 A", tab: "gallery", threadId: null },
      { roomId: "a/b?c#d", tab: "board", threadId: "スレ/1" },
    ];
    for (const loc of locs) {
      expect(locationFromHash(hashForLocation(loc))).toEqual(loc);
    }
  });

  it("parses a legacy room-only hash as that room's chat tab", () => {
    expect(locationFromHash("#/my-team")).toEqual({ roomId: "my-team", tab: "chat", threadId: null });
  });

  it("returns null for an empty hash so the caller can fall back to the last view", () => {
    expect(locationFromHash("")).toBeNull();
    expect(locationFromHash("#")).toBeNull();
    expect(locationFromHash("#/")).toBeNull();
    expect(locationFromHash("#/%E0%A4%A")).toBeNull(); // invalid percent-encoding
  });

  it("degrades an unknown tab segment to chat and drops threads outside board", () => {
    expect(locationFromHash("#/r/bogus")).toEqual({ roomId: "r", tab: "chat", threadId: null });
    expect(locationFromHash("#/r/calendar/t-1")).toEqual({ roomId: "r", tab: "calendar", threadId: null });
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

describe("the personal notes space", () => {
  // The sentinel doubles as a room id, so the one thing that must never
  // happen is a real room shadowing it (or being shadowed by it) and
  // silently losing its swarm. isValidRoomId is what guarantees that:
  // rejecting the sentinel means it can't be typed into the join form or
  // carried by an invite link.
  it("cannot be reached as a joinable room id", () => {
    expect(isValidRoomId(PERSONAL_ROOM_ID)).toBe(false);
  });

  it("is not the global room", () => {
    expect(PERSONAL_ROOM_ID).not.toBe(GLOBAL_ROOM_ID);
    expect(isPersonalRoom(GLOBAL_ROOM_ID)).toBe(false);
  });

  it("recognises only its own id", () => {
    expect(isPersonalRoom(PERSONAL_ROOM_ID)).toBe(true);
    expect(isPersonalRoom("personal")).toBe(false);
    expect(isPersonalRoom(null)).toBe(false);
  });

  // Deep links still resolve it — harmless, since it only ever opens the
  // visitor's own notes — so the hash codec must survive the colon.
  it("survives a round trip through the URL hash", () => {
    expect(roomIdFromHash(hashForRoomId(PERSONAL_ROOM_ID))).toBe(PERSONAL_ROOM_ID);
  });
});
