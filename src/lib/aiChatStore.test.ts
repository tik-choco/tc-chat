import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiConversation, AiMessage } from "./aiChatTypes";

const kvStore = new Map<string, Uint8Array>();
const unreadableKeys = new Set<string>();
let allReadsFail = false;

vi.mock("./mistClient", () => ({
  storage_kv_get: vi.fn(async (key: string) => {
    // Yield on every read to expose overlapping index read-modify-writes.
    await Promise.resolve();
    if (allReadsFail || unreadableKeys.has(key)) throw new Error("kv unavailable");
    return kvStore.get(key);
  }),
  storage_kv_set: vi.fn(async (key: string, data: Uint8Array) => {
    kvStore.set(key, data);
  }),
  storage_kv_delete: vi.fn(async (key: string) => {
    kvStore.delete(key);
  }),
}));

import { storage_kv_delete, storage_kv_get, storage_kv_set } from "./mistClient";
import {
  AI_TITLE_MAX,
  AiChatUnavailable,
  MAX_AI_CONVERSATIONS,
  createAiConversation,
  createAiMessage,
  deleteAiConversation,
  deriveAiTitle,
  loadAiConversation,
  loadAiIndex,
  renameAiConversation,
  saveAiConversation,
  summarizeAiConversation,
  toChatMessages,
  withMessageEdited,
  withMessageRemoved,
  withMessagesBefore,
  withMessagesThrough,
} from "./aiChatStore";

const INDEX = "tc-chat:ai-chat:index:v1";
const CONV = "tc-chat:ai-chat:conv:v1:";
const encoder = new TextEncoder();

function putJson(key: string, value: unknown): void {
  kvStore.set(key, encoder.encode(JSON.stringify(value)));
}

function conversation(id: string, updatedAt = 1): AiConversation {
  return {
    id,
    title: "title " + id,
    createdAt: 1,
    updatedAt,
    effort: "medium",
    messages: [],
  };
}

function message(id: string, role: AiMessage["role"], content: string): AiMessage {
  return { id, role, content, createdAt: 1 };
}

beforeEach(() => {
  kvStore.clear();
  unreadableKeys.clear();
  allReadsFail = false;
  vi.clearAllMocks();
});

describe("AI conversation storage", () => {
  it("round-trips records and upserts a newest-first summary", async () => {
    const first = {
      ...conversation("first", 2),
      model: { providerId: "provider", model: "model" },
      effort: "high" as const,
      messages: [
        message("question", "user", "hello"),
        { ...message("answer", "assistant", "world"), effort: "high" as const, stopped: true },
      ],
    };
    const second = conversation("second", 3);
    await saveAiConversation(first);
    await saveAiConversation(second);
    expect(await loadAiConversation("first")).toEqual(first);
    expect(await loadAiIndex()).toEqual([
      summarizeAiConversation(second),
      summarizeAiConversation(first),
    ]);

    const updated = { ...first, title: "updated", updatedAt: 4 };
    await saveAiConversation(updated);
    expect(await loadAiIndex()).toEqual([
      summarizeAiConversation(updated),
      summarizeAiConversation(second),
    ]);
    expect(await loadAiConversation("first")).toEqual(updated);
  });

  it("never touches KV for temporary conversations, even when storage is unavailable", async () => {
    allReadsFail = true;
    await saveAiConversation({ ...conversation("temporary"), temporary: true });
    expect(storage_kv_get).not.toHaveBeenCalled();
    expect(storage_kv_set).not.toHaveBeenCalled();
    expect(storage_kv_delete).not.toHaveBeenCalled();
  });

  it("distinguishes absent keys from failed reads", async () => {
    expect(await loadAiIndex()).toEqual([]);
    expect(await loadAiConversation("missing")).toBeNull();
    allReadsFail = true;
    await expect(loadAiIndex()).rejects.toMatchObject({ name: "AiChatUnavailable" });
    await expect(loadAiConversation("missing")).rejects.toBeInstanceOf(AiChatUnavailable);
  });

  it.each(["{bad", "null", "{}", '"string"'])(
    "treats an invalid index payload %s as unavailable",
    async (payload) => {
      kvStore.set(INDEX, encoder.encode(payload));
      await expect(loadAiIndex()).rejects.toBeInstanceOf(AiChatUnavailable);
    },
  );

  it.each([
    "{bad",
    "null",
    "{}",
    '{"id":"x","title":"","createdAt":1,"updatedAt":2}',
    '{"id":"another","title":"","createdAt":1,"updatedAt":2,"messages":[]}',
  ])("treats an invalid conversation payload %s as unavailable", async (payload) => {
    kvStore.set(CONV + "x", encoder.encode(payload));
    await expect(loadAiConversation("x")).rejects.toBeInstanceOf(AiChatUnavailable);
  });

  it("drops invalid index rows, validates counts, and sorts valid rows", async () => {
    const early = summarizeAiConversation(conversation("early", 1));
    const late = summarizeAiConversation(conversation("late", 5));
    putJson(INDEX, [
      early,
      null,
      { ...early, id: "" },
      { ...early, id: "no-count", messageCount: undefined },
      { ...early, id: "negative", messageCount: -1 },
      { ...early, id: "fraction", messageCount: 1.5 },
      { ...early, id: "bad-time", updatedAt: "tomorrow" },
      late,
    ]);
    expect(await loadAiIndex()).toEqual([late, early]);
  });

  it("drops invalid messages and optional fields, defaulting invalid effort values", async () => {
    const valid = message("valid", "assistant", "");
    putJson(CONV + "x", {
      ...conversation("x"),
      effort: "imaginary",
      model: { providerId: 5, model: "invalid" },
      messages: [
        { ...valid, effort: "imaginary", editedAt: "bad", error: "failed", stopped: true },
        message("user", "user", ""),
        null,
        { ...valid, id: "" },
        { ...valid, role: "system" },
        { ...valid, content: 7 },
        { ...valid, createdAt: null },
      ],
    });
    expect(await loadAiConversation("x")).toEqual({
      ...conversation("x"),
      messages: [
        { ...valid, effort: "medium", error: "failed", stopped: true },
        message("user", "user", ""),
      ],
    });
  });

  it("defaults a missing conversation effort without adding effort to messages", async () => {
    putJson(CONV + "x", { ...conversation("x"), effort: undefined, messages: [message("m", "user", "hi")] });
    expect(await loadAiConversation("x")).toEqual({
      ...conversation("x"),
      messages: [message("m", "user", "hi")],
    });
  });

  it("refuses all mutations when the index is unreadable, without touching stored data", async () => {
    const saved = conversation("saved");
    await saveAiConversation(saved);
    const before = new Map(kvStore);
    unreadableKeys.add(INDEX);
    vi.clearAllMocks();
    await expect(saveAiConversation(conversation("new"))).rejects.toBeInstanceOf(AiChatUnavailable);
    await expect(deleteAiConversation("saved")).rejects.toBeInstanceOf(AiChatUnavailable);
    await expect(renameAiConversation("saved", "renamed")).rejects.toBeInstanceOf(AiChatUnavailable);
    expect(storage_kv_set).not.toHaveBeenCalled();
    expect(storage_kv_delete).not.toHaveBeenCalled();
    expect(kvStore).toEqual(before);
  });

  it("refuses to overwrite a corrupt index and resumes after a failed queued operation", async () => {
    kvStore.set(INDEX, encoder.encode("{corrupt"));
    await expect(saveAiConversation(conversation("first"))).rejects.toBeInstanceOf(AiChatUnavailable);
    expect(kvStore.has(CONV + "first")).toBe(false);
    expect(new TextDecoder().decode(kvStore.get(INDEX))).toBe("{corrupt");
    kvStore.delete(INDEX);
    await saveAiConversation(conversation("second"));
    expect((await loadAiIndex()).map((row) => row.id)).toEqual(["second"]);
  });

  it("does not write if the record cannot be read during rename", async () => {
    await saveAiConversation(conversation("saved"));
    unreadableKeys.add(CONV + "saved");
    vi.clearAllMocks();
    await expect(renameAiConversation("saved", "new title")).rejects.toBeInstanceOf(AiChatUnavailable);
    expect(storage_kv_set).not.toHaveBeenCalled();
    expect(storage_kv_delete).not.toHaveBeenCalled();
  });

  it("renames with trimming and clipping, keeps the old title for blank input, and ignores a missing id", async () => {
    await saveAiConversation(conversation("x"));
    await renameAiConversation("x", "  " + "a".repeat(AI_TITLE_MAX + 4) + "  ");
    expect((await loadAiConversation("x"))?.title).toBe("a".repeat(AI_TITLE_MAX));
    expect((await loadAiIndex())[0].title).toBe("a".repeat(AI_TITLE_MAX));
    await renameAiConversation("x", " \n ");
    expect((await loadAiConversation("x"))?.title).toBe("a".repeat(AI_TITLE_MAX));
    vi.clearAllMocks();
    await renameAiConversation("missing", "ignored");
    expect(storage_kv_set).not.toHaveBeenCalled();
    expect(storage_kv_delete).not.toHaveBeenCalled();
  });

  it("clips renamed titles on Unicode character boundaries", async () => {
    await saveAiConversation(conversation("x"));
    await renameAiConversation("x", "😀".repeat(AI_TITLE_MAX + 1));
    expect((await loadAiConversation("x"))?.title).toBe("😀".repeat(AI_TITLE_MAX));
  });

  it("deletes the record and its index row without disturbing other conversations", async () => {
    await saveAiConversation(conversation("one"));
    await saveAiConversation(conversation("two"));
    await deleteAiConversation("one");
    expect(await loadAiConversation("one")).toBeNull();
    expect((await loadAiIndex()).map((row) => row.id)).toEqual(["two"]);
    expect(kvStore.has(CONV + "one")).toBe(false);
    expect(kvStore.has(CONV + "two")).toBe(true);
  });

  it("keeps the record if deleting its index row fails", async () => {
    const saved = conversation("saved");
    await saveAiConversation(saved);
    vi.mocked(storage_kv_set).mockRejectedValueOnce(new Error("disk full"));
    await expect(deleteAiConversation(saved.id)).rejects.toThrow("disk full");
    expect(await loadAiConversation(saved.id)).toEqual(saved);
    expect(await loadAiIndex()).toEqual([summarizeAiConversation(saved)]);
  });

  it("does not evict existing records if writing the new index fails", async () => {
    const existing = Array.from({ length: MAX_AI_CONVERSATIONS }, (_, i) => conversation("c" + i, i));
    putJson(INDEX, existing.map(summarizeAiConversation));
    for (const conv of existing) putJson(CONV + conv.id, conv);
    const originalIndex = kvStore.get(INDEX);
    vi.mocked(storage_kv_set)
      .mockImplementationOnce(async (key, data) => { kvStore.set(key, data); })
      .mockRejectedValueOnce(new Error("disk full"));

    await expect(saveAiConversation(conversation("new", MAX_AI_CONVERSATIONS + 1)))
      .rejects.toThrow("disk full");
    expect(kvStore.get(INDEX)).toBe(originalIndex);
    expect(await loadAiConversation("c0")).toEqual(existing[0]);
    expect(storage_kv_delete).not.toHaveBeenCalled();
  });

  it("caps the index and deletes the oldest records on eviction", async () => {
    const existing = Array.from({ length: MAX_AI_CONVERSATIONS }, (_, i) => conversation("c" + i, i));
    putJson(INDEX, existing.map(summarizeAiConversation));
    for (const conv of existing) putJson(CONV + conv.id, conv);

    const newest = conversation("newest", MAX_AI_CONVERSATIONS + 1);
    await saveAiConversation(newest);
    const index = await loadAiIndex();
    expect(index).toHaveLength(MAX_AI_CONVERSATIONS);
    expect(index[0]).toEqual(summarizeAiConversation(newest));
    expect(index.some((row) => row.id === "c0")).toBe(false);
    expect(kvStore.has(CONV + "c0")).toBe(false);
    expect(await loadAiConversation("c1")).toEqual(existing[1]);
  });

  it("also evicts a newly saved record when its timestamp is older than the capped history", async () => {
    const existing = Array.from({ length: MAX_AI_CONVERSATIONS }, (_, i) => conversation("c" + i, i + 1));
    putJson(INDEX, existing.map(summarizeAiConversation));
    await saveAiConversation(conversation("old", 0));
    expect(await loadAiIndex()).toHaveLength(MAX_AI_CONVERSATIONS);
    expect(await loadAiConversation("old")).toBeNull();
  });

  it("serializes simultaneous saves so no index rows are lost", async () => {
    const conversations = Array.from({ length: 12 }, (_, i) => conversation("c" + i, i));
    await Promise.all(conversations.map(saveAiConversation));
    expect((await loadAiIndex()).map((row) => row.id)).toEqual(
      conversations.toReversed().map((conv) => conv.id),
    );
    for (const conv of conversations) expect(await loadAiConversation(conv.id)).toEqual(conv);
  });

  it("serializes saves, renames, and deletes against one another", async () => {
    await saveAiConversation(conversation("x"));
    const replacement = { ...conversation("x", 5), title: "replacement" };
    await Promise.all([
      saveAiConversation(replacement),
      renameAiConversation("x", "final"),
      saveAiConversation(conversation("other", 4)),
      deleteAiConversation("other"),
    ]);
    expect(await loadAiConversation("x")).toEqual({ ...replacement, title: "final" });
    expect((await loadAiIndex()).map((row) => row.id)).toEqual(["x"]);
    expect(await loadAiConversation("other")).toBeNull();
  });
});

describe("pure AI conversation helpers", () => {
  it("creates conversations with fresh ids, matching timestamps, and optional settings", () => {
    const model = { providerId: "p", model: "m" };
    const first = createAiConversation({ model, effort: "max", temporary: true }, 123);
    const second = createAiConversation({ effort: "low" }, 456);
    expect(first).toEqual({
      id: expect.any(String), title: "", createdAt: 123, updatedAt: 123,
      model, effort: "max", temporary: true, messages: [],
    });
    expect(second.id).not.toBe(first.id);
    expect(second).toEqual({
      id: expect.any(String), title: "", createdAt: 456, updatedAt: 456,
      effort: "low", messages: [],
    });
  });

  it("creates messages with fresh ids, preserving metadata without letting extras replace required fields", () => {
    const first = createAiMessage("assistant", "answer", {
      id: "not-used", role: "user", content: "not-used", createdAt: 0,
      model: { providerId: "p", model: "m" }, effort: "high", stopped: true,
    }, 42);
    const second = createAiMessage("user", "question", undefined, 43);
    expect(first).toEqual({
      id: expect.any(String), role: "assistant", content: "answer", createdAt: 42,
      model: { providerId: "p", model: "m" }, effort: "high", stopped: true,
    });
    expect(first.id).not.toBe("not-used");
    expect(first.id).not.toBe(second.id);
  });

  it("uses Date.now when no time is supplied", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(100);
    try {
      expect(createAiConversation({ effort: "none" }).updatedAt).toBe(100);
      expect(createAiMessage("user", "hi").createdAt).toBe(100);
      expect(withMessageRemoved({ ...conversation("x"), messages: [message("m", "user", "")] }, "m").updatedAt).toBe(100);
    } finally {
      now.mockRestore();
    }
  });

  it("derives a title from the first non-empty line and collapses its whitespace", () => {
    expect(deriveAiTitle(" \r\n\t \n  First \t  line  \r\nsecond")).toBe("First line");
    expect(deriveAiTitle("\n \t\r\n")).toBe("");
    expect(deriveAiTitle("x".repeat(AI_TITLE_MAX))).toBe("x".repeat(AI_TITLE_MAX));
  });

  it("clips long titles including the ellipsis within the limit and preserves Unicode characters", () => {
    expect(deriveAiTitle("x".repeat(AI_TITLE_MAX + 1))).toBe("x".repeat(AI_TITLE_MAX - 1) + "…");
    expect(deriveAiTitle("😀".repeat(AI_TITLE_MAX + 1))).toBe("😀".repeat(AI_TITLE_MAX - 1) + "…");
  });

  it("summarizes only the history fields and counts all messages", () => {
    const conv = { ...conversation("x", 7), messages: [message("a", "user", ""), message("b", "assistant", "")] };
    expect(summarizeAiConversation(conv)).toEqual({
      id: "x", title: "title x", createdAt: 1, updatedAt: 7, messageCount: 2,
    });
  });

  it("edits a message immutably, records the edit, and clears failure state", () => {
    const original = {
      ...conversation("x"),
      messages: [message("a", "user", "hi"), {
        ...message("b", "assistant", "partial"), error: "failed", stopped: true,
      }],
    };
    const updated = withMessageEdited(original, "b", "new answer", 12);
    expect(updated).not.toBe(original);
    expect(updated.messages).not.toBe(original.messages);
    expect(updated.messages[0]).toBe(original.messages[0]);
    expect(updated.messages[1]).toEqual({ ...message("b", "assistant", "new answer"), editedAt: 12 });
    expect(updated.messages[1]).not.toHaveProperty("error");
    expect(updated.messages[1]).not.toHaveProperty("stopped");
    expect(updated.updatedAt).toBe(12);
    expect(original.messages[1]).toMatchObject({ content: "partial", error: "failed", stopped: true });
  });

  it("removes only the requested message and leaves the original untouched", () => {
    const original = { ...conversation("x"), messages: [message("a", "user", "a"), message("b", "assistant", "b"), message("c", "user", "c")] };
    const updated = withMessageRemoved(original, "b", 13);
    expect(updated.messages.map((item) => item.id)).toEqual(["a", "c"]);
    expect(updated.updatedAt).toBe(13);
    expect(original.messages.map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps messages through or strictly before the given id", () => {
    const original = { ...conversation("x"), messages: [message("a", "user", "a"), message("b", "assistant", "b"), message("c", "user", "c")] };
    const through = withMessagesThrough(original, "b", 14);
    expect(through.messages.map((item) => item.id)).toEqual(["a", "b"]);
    expect(through.updatedAt).toBe(14);
    const before = withMessagesBefore(original, "b", 15);
    expect(before.messages.map((item) => item.id)).toEqual(["a"]);
    expect(before.updatedAt).toBe(15);
    expect(withMessagesBefore(original, "a", 16).messages).toEqual([]);
    expect(original.messages).toHaveLength(3);
    expect(withMessagesThrough(original, "c", 17)).toBe(original);
  });

  it("returns the same object for every helper when the message id is unknown", () => {
    const original = { ...conversation("x"), messages: [message("a", "user", "a")] };
    expect(withMessageEdited(original, "missing", "new", 2)).toBe(original);
    expect(withMessageRemoved(original, "missing", 2)).toBe(original);
    expect(withMessagesThrough(original, "missing", 2)).toBe(original);
    expect(withMessagesBefore(original, "missing", 2)).toBe(original);
  });

  it("sends all user messages and only assistant messages with content, including partial failures", () => {
    const conv = {
      ...conversation("x"),
      messages: [
        message("empty-user", "user", ""),
        message("empty-assistant", "assistant", ""),
        { ...message("partial-error", "assistant", "partial"), error: "failed" },
        { ...message("partial-stop", "assistant", "stopped"), stopped: true },
        message("whitespace", "assistant", " "),
        message("final", "user", "next"),
      ],
    };
    expect(toChatMessages(conv)).toEqual([
      { role: "user", content: "" },
      { role: "assistant", content: "partial" },
      { role: "assistant", content: "stopped" },
      { role: "assistant", content: " " },
      { role: "user", content: "next" },
    ]);
  });
});
