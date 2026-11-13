import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/preact";
import { useAiChat } from "./useAiChat";
import {
  createAiConversation, createAiMessage, summarizeAiConversation, loadAiIndex, loadAiConversation,
  saveAiConversation, deleteAiConversation, renameAiConversation,
} from "../lib/aiChatStore";
import { AiClientError, streamAiReply, type AiStreamRequest, type AiStreamResult } from "../lib/aiClient";
import { getNode } from "../lib/mistClient";
import { setAiLocalSettings, setDefaultChatModel } from "../lib/aiLocalSettings";
import type { AiConversation } from "../lib/aiChatTypes";

vi.mock("../lib/mistClient", () => ({
  getNode: vi.fn(async () => ({})),
  storage_kv_get: vi.fn(), storage_kv_set: vi.fn(), storage_kv_delete: vi.fn(),
}));
vi.mock("../lib/aiChatStore", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/aiChatStore")>(),
  loadAiIndex: vi.fn(), loadAiConversation: vi.fn(), saveAiConversation: vi.fn(),
  deleteAiConversation: vi.fn(), renameAiConversation: vi.fn(),
}));
vi.mock("../lib/aiClient", () => ({
  streamAiReply: vi.fn(),
  isAbortError: (error: unknown) => error instanceof Error && error.name === "AbortError",
  AiClientError: class extends Error {
    readonly code: string;
    constructor(code: string) { super(`config: ${code}`); this.code = code; }
  },
}));

const MODEL = { providerId: "p", model: "model" };
const ACTIVE_KEY = "tc-chat:ai-chat:active:v1";
const disk = new Map<string, AiConversation>();

function fixture(text = "existing", at = 1): AiConversation {
  const conv = createAiConversation({ effort: "medium" }, at);
  return { ...conv, title: text, messages: [createAiMessage("user", text, {}, at)] };
}

async function mount() {
  const hook = renderHook(() => useAiChat());
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  return hook;
}

function pendingStream(ignoreAbort = false) {
  let request!: AiStreamRequest;
  let resolve!: (result: AiStreamResult) => void;
  let reject!: (error: unknown) => void;
  vi.mocked(streamAiReply).mockImplementationOnce((req) => {
    request = req;
    return new Promise<AiStreamResult>((res, rej) => {
      resolve = res;
      reject = rej;
      if (!ignoreAbort) req.signal?.addEventListener("abort", () => rej(new DOMException("stopped", "AbortError")), { once: true });
    });
  });
  return {
    get request() { return request; },
    delta: (text: string) => request.onDelta?.(text),
    resolve: (content = "answer") => resolve({ content, model: MODEL }),
    reject: (error: unknown) => reject(error),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  disk.clear();
  localStorage.clear();
  setAiLocalSettings({ tasks: {}, roomProvide: {}, recentModels: [] });
  vi.mocked(getNode).mockResolvedValue({} as Awaited<ReturnType<typeof getNode>>);
  vi.mocked(loadAiIndex).mockImplementation(async () => [...disk.values()].map(summarizeAiConversation)
    .sort((a, b) => b.updatedAt - a.updatedAt));
  vi.mocked(loadAiConversation).mockImplementation(async (id) => disk.get(id) ?? null);
  vi.mocked(saveAiConversation).mockImplementation(async (conv) => { disk.set(conv.id, structuredClone(conv)); });
  vi.mocked(deleteAiConversation).mockImplementation(async (id) => { disk.delete(id); });
  vi.mocked(renameAiConversation).mockImplementation(async (id, title) => {
    const conv = disk.get(id);
    if (conv) disk.set(id, { ...conv, title });
  });
  vi.mocked(streamAiReply).mockResolvedValue({ content: "answer", model: MODEL });
});

afterEach(async () => {
  cleanup();
  await Promise.resolve();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useAiChat", () => {
  it("sends a trimmed prompt, streams with throttled updates, and saves once on completion", async () => {
    setDefaultChatModel({ ref: MODEL, effort: "high" });
    const hook = await mount();
    const stream = pendingStream();
    let sent!: Promise<void>;
    act(() => { sent = hook.result.current.send("  question  "); });
    expect(hook.result.current.active.messages.map((msg) => msg.content)).toEqual(["question", ""]);
    expect(hook.result.current.streamingMessageId).toBe(hook.result.current.active.messages[1].id);
    expect(stream.request).toMatchObject({ ref: MODEL, effort: "high", messages: [{ role: "user", content: "question" }] });
    vi.useFakeTimers();
    act(() => { stream.delta("a"); stream.delta("an"); stream.delta("answer"); });
    expect(hook.result.current.active.messages[1].content).toBe("");
    act(() => { vi.advanceTimersByTime(50); });
    expect(hook.result.current.active.messages[1].content).toBe("answer");
    expect(saveAiConversation).not.toHaveBeenCalled();
    await act(async () => { stream.resolve(); await sent; });
    expect(saveAiConversation).toHaveBeenCalledTimes(1);
    expect(hook.result.current.active.title).toBe("question");
    expect(hook.result.current.active.messages[1]).toMatchObject({ content: "answer", model: MODEL, effort: "high" });
    expect(hook.result.current.streamingMessageId).toBeNull();
    expect(hook.result.current.conversations).toEqual([summarizeAiConversation(hook.result.current.active)]);
    expect(localStorage.getItem(ACTIVE_KEY)).toBe(hook.result.current.active.id);
  });

  it("ignores blank sends and concurrent sends", async () => {
    const hook = await mount();
    await act(async () => { await hook.result.current.send("   "); });
    expect(streamAiReply).not.toHaveBeenCalled();
    const stream = pendingStream();
    let sent!: Promise<void>;
    act(() => { sent = hook.result.current.send("first"); });
    await act(async () => { await hook.result.current.send("second"); });
    expect(streamAiReply).toHaveBeenCalledTimes(1);
    await act(async () => { stream.resolve(); await sent; });
  });

  it("never persists temporary conversations or their selection", async () => {
    const hook = await mount();
    localStorage.setItem(ACTIVE_KEY, "last-persisted");
    const setItem = vi.spyOn(localStorage, "setItem");
    act(() => { hook.result.current.newConversation({ temporary: true }); });
    const tempId = hook.result.current.active.id;
    await act(async () => { await hook.result.current.send("secret"); });
    await act(async () => { await hook.result.current.renameConversation(tempId, "renamed"); });
    act(() => { hook.result.current.setModel(MODEL); hook.result.current.setEffort("max"); });
    await act(async () => { await hook.result.current.editMessage(hook.result.current.active.messages[0].id, "private"); });
    expect(saveAiConversation).not.toHaveBeenCalled();
    expect(hook.result.current.conversations).toEqual([]);
    expect(localStorage.getItem(ACTIVE_KEY)).toBe("last-persisted");
    expect(setItem.mock.calls.filter(([key]) => key === ACTIVE_KEY)).toEqual([]);
    act(() => { hook.result.current.newConversation(); });
    expect(hook.result.current.active.temporary).toBe(true);
    expect(hook.result.current.active.messages).toEqual([]);
    expect(hook.result.current.active.id).not.toBe(tempId);
  });

  it("keeps buffered partial content on stop and removes an empty stopped response", async () => {
    const hook = await mount();
    let sent!: Promise<void>;
    const stream = pendingStream();
    act(() => { sent = hook.result.current.send("question"); stream.delta("partial"); });
    await act(async () => { hook.result.current.stop(); await sent; });
    expect(stream.request.signal?.aborted).toBe(true);
    expect(hook.result.current.active.messages[1]).toMatchObject({ content: "partial", stopped: true });
    expect(disk.get(hook.result.current.active.id)?.messages[1]).toMatchObject({ content: "partial", stopped: true });
    const empty = pendingStream();
    act(() => { sent = hook.result.current.send("again"); });
    await act(async () => { hook.result.current.stop(); await sent; });
    expect(empty.request.signal?.aborted).toBe(true);
    expect(hook.result.current.active.messages.map((msg) => msg.content)).toEqual(["question", "partial", "again"]);
    expect(hook.result.current.error).toBeNull();
  });

  it("reports a config error and keeps only the user prompt for retry", async () => {
    const hook = await mount();
    vi.mocked(streamAiReply).mockRejectedValueOnce(new AiClientError("no-model"));
    await act(async () => { await hook.result.current.send("question"); });
    expect(hook.result.current.error).toBe("config");
    expect(hook.result.current.errorDetail).toContain("no-model");
    expect(hook.result.current.active.messages.map((msg) => msg.role)).toEqual(["user"]);
    expect(saveAiConversation).toHaveBeenCalledTimes(1);
    act(() => { hook.result.current.dismissError(); });
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.errorDetail).toBeNull();
  });

  it("keeps partial content and exposes detail for generation failures", async () => {
    const hook = await mount();
    const stream = pendingStream();
    let sent!: Promise<void>;
    act(() => { sent = hook.result.current.send("question"); stream.delta("partial"); });
    await act(async () => { stream.reject(new Error("upstream failed")); await sent; });
    expect(hook.result.current.error).toBe("generate");
    expect(hook.result.current.errorDetail).toBe("upstream failed");
    expect(hook.result.current.active.messages[1]).toMatchObject({ content: "partial", error: "upstream failed" });
  });

  it("edits and resends a user message, truncating later history", async () => {
    const hook = await mount();
    await act(async () => { await hook.result.current.send("first"); await hook.result.current.send("second"); });
    const first = hook.result.current.active.messages[0].id;
    await act(async () => { await hook.result.current.editMessage(first, "edited", { resend: true }); });
    expect(vi.mocked(streamAiReply).mock.lastCall?.[0].messages).toEqual([{ role: "user", content: "edited" }]);
    expect(hook.result.current.active.messages.map((msg) => msg.content)).toEqual(["edited", "answer"]);
    expect(hook.result.current.active.messages[0].editedAt).toBeTypeOf("number");
  });

  it("regenerates a reply using only history before that reply", async () => {
    const hook = await mount();
    await act(async () => { await hook.result.current.send("first"); await hook.result.current.send("second"); });
    const reply = hook.result.current.active.messages[1].id;
    vi.mocked(streamAiReply).mockResolvedValueOnce({ content: "replacement", model: MODEL });
    await act(async () => { await hook.result.current.regenerate(reply); });
    expect(vi.mocked(streamAiReply).mock.lastCall?.[0].messages).toEqual([{ role: "user", content: "first" }]);
    expect(hook.result.current.active.messages.map((msg) => msg.content)).toEqual(["first", "replacement"]);
  });

  it("edits/deletes individual messages, without resending assistant edits", async () => {
    const hook = await mount();
    await act(async () => { await hook.result.current.send("question"); });
    const reply = hook.result.current.active.messages[1].id;
    await act(async () => { await hook.result.current.editMessage(reply, "manual", { resend: true }); });
    expect(streamAiReply).toHaveBeenCalledTimes(1);
    expect(hook.result.current.active.messages[1].content).toBe("manual");
    await act(async () => { await hook.result.current.deleteMessage(hook.result.current.active.messages[0].id); });
    expect(hook.result.current.active.messages.map((msg) => msg.content)).toEqual(["manual"]);
    expect(saveAiConversation).toHaveBeenCalledTimes(3);
  });

  it("deletes the active conversation and starts a new draft", async () => {
    const hook = await mount();
    await act(async () => { await hook.result.current.send("question"); });
    const id = hook.result.current.active.id;
    await act(async () => { await hook.result.current.deleteConversation(id); });
    expect(deleteAiConversation).toHaveBeenCalledWith(id);
    expect(disk.has(id)).toBe(false);
    expect(hook.result.current.conversations).toEqual([]);
    expect(hook.result.current.active.id).not.toBe(id);
    expect(hook.result.current.active.messages).toEqual([]);
    expect(localStorage.getItem(ACTIVE_KEY)).toBeNull();
  });

  it("switches conversations, saving partial output to its original conversation and ignoring late results", async () => {
    const other = fixture("other");
    disk.set(other.id, other);
    const hook = await mount();
    const originalId = hook.result.current.active.id;
    const stream = pendingStream(true);
    let sent!: Promise<void>;
    act(() => { sent = hook.result.current.send("question"); stream.delta("partial"); });
    await act(async () => { await hook.result.current.selectConversation(other.id); });
    expect(stream.request.signal?.aborted).toBe(true);
    expect(hook.result.current.active.id).toBe(other.id);
    expect(disk.get(originalId)?.messages[1]).toMatchObject({ content: "partial", stopped: true });
    expect(disk.get(other.id)).toEqual(other);
    act(() => { stream.delta("late tokens"); });
    await act(async () => { stream.resolve("late result"); await sent; });
    expect(hook.result.current.active).toEqual(other);
    expect(disk.get(originalId)?.messages[1].content).toBe("partial");
    expect(saveAiConversation).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(ACTIVE_KEY)).toBe(other.id);
  });

  it("waits for a stopped reply to save when rapidly switching back to its conversation", async () => {
    const other = fixture("other");
    disk.set(other.id, other);
    const hook = await mount();
    const originalId = hook.result.current.active.id;
    let releaseSave!: () => void;
    vi.mocked(saveAiConversation).mockImplementationOnce((conv) => new Promise<void>((resolve) => {
      releaseSave = () => { disk.set(conv.id, structuredClone(conv)); resolve(); };
    }));
    const stream = pendingStream();
    let sent!: Promise<void>;
    let away!: Promise<void>;
    let back!: Promise<void>;
    act(() => { sent = hook.result.current.send("question"); stream.delta("partial"); });
    act(() => { away = hook.result.current.selectConversation(other.id); });
    act(() => { back = hook.result.current.selectConversation(originalId); });
    expect(loadAiConversation).not.toHaveBeenCalled();
    await act(async () => { releaseSave(); await Promise.all([sent, away, back]); });
    expect(hook.result.current.active.id).toBe(originalId);
    expect(hook.result.current.active.messages[1]).toMatchObject({ content: "partial", stopped: true });
  });

  it("does not let a slow selection overwrite a newer selection", async () => {
    const first = fixture("first");
    const second = fixture("second");
    disk.set(first.id, first);
    disk.set(second.id, second);
    const hook = await mount();
    let resolveFirst!: (conv: AiConversation) => void;
    vi.mocked(loadAiConversation).mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }));
    let selecting!: Promise<void>;
    await act(async () => { selecting = hook.result.current.selectConversation(first.id); });
    await act(async () => { await hook.result.current.selectConversation(second.id); });
    await act(async () => { resolveFirst(first); await selecting; });
    expect(hook.result.current.active.id).toBe(second.id);
    expect(localStorage.getItem(ACTIVE_KEY)).toBe(second.id);
  });

  it("stops and persists the old conversation when starting a new draft", async () => {
    const hook = await mount();
    const stream = pendingStream();
    const oldId = hook.result.current.active.id;
    let sent!: Promise<void>;
    act(() => { sent = hook.result.current.send("question"); stream.delta("part"); });
    await act(async () => { hook.result.current.newConversation(); await sent; });
    expect(hook.result.current.active.id).not.toBe(oldId);
    expect(hook.result.current.active.messages).toEqual([]);
    expect(disk.get(oldId)?.messages[1]).toMatchObject({ content: "part", stopped: true });
    expect(localStorage.getItem(ACTIVE_KEY)).toBeNull();
  });

  it("aborts on unmount and saves the partial reply only once", async () => {
    const hook = await mount();
    const stream = pendingStream();
    const id = hook.result.current.active.id;
    let sent!: Promise<void>;
    act(() => { sent = hook.result.current.send("question"); stream.delta("part"); });
    await act(async () => { hook.unmount(); await sent; });
    expect(stream.request.signal?.aborted).toBe(true);
    expect(disk.get(id)?.messages[1]).toMatchObject({ content: "part", stopped: true });
    expect(saveAiConversation).toHaveBeenCalledTimes(1);
  });

  it("restores persisted selection and defaults for new drafts", async () => {
    const existing = fixture();
    disk.set(existing.id, existing);
    localStorage.setItem(ACTIVE_KEY, existing.id);
    setDefaultChatModel({ ref: MODEL, effort: "xhigh" });
    const hook = await mount();
    expect(hook.result.current.active).toEqual(existing);
    act(() => { hook.result.current.newConversation(); });
    expect(hook.result.current.model).toEqual(MODEL);
    expect(hook.result.current.effort).toBe("xhigh");
    expect(hook.result.current.recentModels).toEqual([MODEL]);
  });

  it("reports load failure and finishes startup even when the node also fails", async () => {
    vi.mocked(getNode).mockRejectedValueOnce(new Error("wasm"));
    vi.mocked(loadAiIndex).mockRejectedValueOnce(new Error("unavailable"));
    const hook = await mount();
    expect(hook.result.current.error).toBe("load");
    expect(hook.result.current.conversations).toEqual([]);
    expect(hook.result.current.active.messages).toEqual([]);
  });

  it("reports save failure without discarding the completed reply", async () => {
    const hook = await mount();
    vi.mocked(saveAiConversation).mockRejectedValueOnce(new Error("disk full"));
    await act(async () => { await hook.result.current.send("question"); });
    expect(hook.result.current.error).toBe("save");
    expect(hook.result.current.active.messages[1].content).toBe("answer");
    expect(hook.result.current.conversations).toEqual([]);
  });

  it("changes model/effort on active history and uses those defaults in new chats", async () => {
    const hook = await mount();
    await act(async () => { await hook.result.current.send("question"); });
    await act(async () => { hook.result.current.setModel(MODEL); hook.result.current.setEffort("max"); });
    expect(disk.get(hook.result.current.active.id)).toMatchObject({ model: MODEL, effort: "max" });
    act(() => { hook.result.current.newConversation(); });
    expect(hook.result.current.model).toEqual(MODEL);
    expect(hook.result.current.effort).toBe("max");
    act(() => { hook.result.current.setModel(undefined); hook.result.current.newConversation(); });
    expect(hook.result.current.model).toBeUndefined();
  });

  it("toggles an empty draft in place, but starts fresh when it already has messages", async () => {
    const hook = await mount();
    const id = hook.result.current.active.id;
    act(() => { hook.result.current.setTemporary(true); });
    expect(hook.result.current.active.id).toBe(id);
    await act(async () => { await hook.result.current.send("private"); });
    act(() => { hook.result.current.setTemporary(false); });
    expect(hook.result.current.active.id).not.toBe(id);
    expect(hook.result.current.active.temporary).toBe(false);
    expect(hook.result.current.active.messages).toEqual([]);
    expect(saveAiConversation).not.toHaveBeenCalled();
  });

  it("renames active and inactive histories and refreshes their summaries", async () => {
    const other = fixture();
    disk.set(other.id, other);
    const hook = await mount();
    await act(async () => { await hook.result.current.send("question"); });
    await act(async () => { await hook.result.current.renameConversation(hook.result.current.active.id, "  title  "); });
    expect(hook.result.current.active.title).toBe("title");
    await act(async () => { await hook.result.current.renameConversation(other.id, "other title"); });
    expect(renameAiConversation).toHaveBeenCalledWith(other.id, "other title");
    expect(hook.result.current.conversations.find((item) => item.id === other.id)?.title).toBe("other title");
  });

  it("stops before editing an in-flight prompt and resends its edited history", async () => {
    const hook = await mount();
    const stream = pendingStream();
    let sent!: Promise<void>;
    act(() => { sent = hook.result.current.send("question"); stream.delta("partial"); });
    await act(async () => {
      await hook.result.current.editMessage(hook.result.current.active.messages[0].id, "edited", { resend: true });
      await sent;
    });
    expect(stream.request.signal?.aborted).toBe(true);
    expect(hook.result.current.active.messages.map((msg) => msg.content)).toEqual(["edited", "answer"]);
    expect(disk.get(hook.result.current.active.id)?.messages.map((msg) => msg.content)).toEqual(["edited", "answer"]);
  });
});
