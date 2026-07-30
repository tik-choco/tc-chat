import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadDraft, saveDraft, clearDraft, MAX_DRAFT_LENGTH } from "./draftStore";
import { GLOBAL_ROOM_ID } from "./util";

const KEY_PREFIX = "tc-chat:draft:v1:";

describe("draftStore", () => {
  beforeEach(() => localStorage.clear());

  it("yields '' from loadDraft when nothing is stored", () => {
    expect(loadDraft("r1")).toBe("");
  });

  it("yields '' from loadDraft on garbage storage rather than throwing", () => {
    // draftStore stores raw text, not JSON, so there's no parse step to break —
    // but a broken localStorage.getItem itself must still degrade quietly.
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("broken");
    });
    expect(() => loadDraft("r1")).not.toThrow();
    expect(loadDraft("r1")).toBe("");
    vi.restoreAllMocks();
  });

  it("round-trips a saved draft", () => {
    saveDraft("r1", "hello world");
    expect(loadDraft("r1")).toBe("hello world");
  });

  it("persists under the tc-chat:draft:v1:<roomId> key", () => {
    saveDraft("r1", "hello world");
    expect(localStorage.getItem(KEY_PREFIX + "r1")).toBe("hello world");
  });

  it("clears (deletes) the key when given blank text", () => {
    saveDraft("r1", "hello");
    saveDraft("r1", "");
    expect(localStorage.getItem(KEY_PREFIX + "r1")).toBeNull();
    expect(loadDraft("r1")).toBe("");
  });

  it("clears (deletes) the key when given whitespace-only text", () => {
    saveDraft("r1", "hello");
    saveDraft("r1", "   \n\t  ");
    expect(localStorage.getItem(KEY_PREFIX + "r1")).toBeNull();
    expect(loadDraft("r1")).toBe("");
  });

  it("truncates at MAX_DRAFT_LENGTH", () => {
    const long = "x".repeat(MAX_DRAFT_LENGTH + 500);
    saveDraft("r1", long);
    const stored = loadDraft("r1");
    expect(stored.length).toBe(MAX_DRAFT_LENGTH);
    expect(stored).toBe("x".repeat(MAX_DRAFT_LENGTH));
  });

  it("clearDraft removes an existing draft", () => {
    saveDraft("r1", "hello");
    clearDraft("r1");
    expect(loadDraft("r1")).toBe("");
    expect(localStorage.getItem(KEY_PREFIX + "r1")).toBeNull();
  });

  it("clearDraft on an already-absent room does not throw", () => {
    expect(() => clearDraft("r1")).not.toThrow();
  });

  it("keeps other rooms' drafts untouched", () => {
    saveDraft("r1", "alice's draft");
    saveDraft("r2", "bob's draft");
    expect(loadDraft("r1")).toBe("alice's draft");
    expect(loadDraft("r2")).toBe("bob's draft");
    clearDraft("r1");
    expect(loadDraft("r1")).toBe("");
    expect(loadDraft("r2")).toBe("bob's draft");
  });

  it("keeps the global room's draft in memory only, never in localStorage", () => {
    saveDraft(GLOBAL_ROOM_ID, "unsent global message");
    expect(loadDraft(GLOBAL_ROOM_ID)).toBe("unsent global message");
    expect(localStorage.getItem(KEY_PREFIX + GLOBAL_ROOM_ID)).toBeNull();
    expect(localStorage.length).toBe(0);
  });

  it("clears the global room's in-memory draft on blank text", () => {
    saveDraft(GLOBAL_ROOM_ID, "draft");
    saveDraft(GLOBAL_ROOM_ID, "   ");
    expect(loadDraft(GLOBAL_ROOM_ID)).toBe("");
  });

  it("clearDraft removes the global room's in-memory draft", () => {
    saveDraft(GLOBAL_ROOM_ID, "draft");
    clearDraft(GLOBAL_ROOM_ID);
    expect(loadDraft(GLOBAL_ROOM_ID)).toBe("");
  });

  it("degrades without throwing when localStorage.setItem throws (quota exceeded)", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => saveDraft("r1", "hello")).not.toThrow();
    vi.restoreAllMocks();
  });

  it("degrades without throwing when localStorage.removeItem throws", () => {
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("broken");
    });
    expect(() => clearDraft("r1")).not.toThrow();
    vi.restoreAllMocks();
  });
});
