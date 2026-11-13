import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { streamChatCompletion } from "@tik-choco/mistai";
import {
  emptyLlmConfig,
  LLM_CONFIG_KEY,
  networkProviderBaseUrl,
  type SharedLlmConfigV1,
} from "@tik-choco/mistai/llm-config";
import { aiRooms } from "./mistaiNode";
import { AiClientError, isAbortError, resolveAiTarget, streamAiReply, type AiStreamRequest } from "./aiClient";

vi.mock("@tik-choco/mistai", () => ({ streamChatCompletion: vi.fn() }));
vi.mock("./mistaiNode", () => ({ aiRooms: { requestRoomChat: vi.fn() } }));

const http = vi.mocked(streamChatCompletion);
const room = vi.mocked(aiRooms.requestRoomChat);
const ref = { providerId: "http", model: "chat-model" };
const messages: AiStreamRequest["messages"] = [
  { role: "system", content: "Be helpful." },
  { role: "user", content: "Hello" },
];

function config(): SharedLlmConfigV1 {
  return {
    ...emptyLlmConfig(),
    defaultModel: ref,
    providers: [
      { id: "http", label: "HTTP", baseUrl: "https://example.test/v1", apiKey: "key" },
      { id: "room", label: "Room", baseUrl: networkProviderBaseUrl("ai-room"), apiKey: "" },
    ],
  };
}

function request(patch: Partial<AiStreamRequest> = {}): AiStreamRequest {
  return { ref: undefined, effort: "medium", messages, ...patch };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("aiClient", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    http.mockResolvedValue("HTTP reply");
    room.mockResolvedValue("Room reply");
  });

  afterEach(() => vi.unstubAllGlobals());

  it("resolves the default or the exact explicit model without falling back", () => {
    expect(resolveAiTarget(undefined, config())).toMatchObject(ref);
    expect(resolveAiTarget({ providerId: "http", model: "another" }, config())).toMatchObject({ model: "another" });
    expect(resolveAiTarget({ providerId: "missing", model: "model" }, config())).toBeNull();
  });

  it("loads shared settings when no config is supplied", async () => {
    localStorage.setItem(LLM_CONFIG_KEY, JSON.stringify(config()));
    expect(resolveAiTarget(undefined)).toMatchObject(ref);
    expect(await streamAiReply(request())).toEqual({ content: "HTTP reply", model: ref });
  });

  it("reports no-model when neither an explicit ref nor a default exists", async () => {
    expect(resolveAiTarget(undefined)).toBeNull();
    await expect(streamAiReply(request())).rejects.toMatchObject({ name: "AiClientError", code: "no-model" });
    expect(http).not.toHaveBeenCalled();
    expect(room).not.toHaveBeenCalled();
    expect(new AiClientError("no-model")).toBeInstanceOf(Error);
  });

  it.each([
    { providerId: "deleted", model: "model" },
    { providerId: "http", model: "   " },
    { providerId: "disabled", model: "model" },
    { providerId: "blank-url", model: "model" },
  ])("reports unresolved for an unusable explicit model: %j", async unavailable => {
    const settings = config();
    settings.providers.push(
      { id: "disabled", label: "Disabled", baseUrl: "https://example.test", apiKey: "", enabled: false },
      { id: "blank-url", label: "Blank", baseUrl: "  ", apiKey: "" },
    );
    await expect(streamAiReply(request({ ref: unavailable }), settings)).rejects.toMatchObject({ code: "unresolved" });
    expect(http).not.toHaveBeenCalled();
    expect(room).not.toHaveBeenCalled();
  });

  it("reports an unusable configured default as unresolved", async () => {
    const settings = config();
    settings.providers = [];
    await expect(streamAiReply(request(), settings)).rejects.toMatchObject({ code: "unresolved" });
  });

  it("passes HTTP settings and effort, accumulates deltas, and returns the actual model", async () => {
    const onDelta = vi.fn();
    http.mockImplementation(async (_settings, sent, delta) => {
      expect(sent).toEqual(messages);
      delta?.("Hello");
      delta?.(" world");
      return "Hello world";
    });
    const selected = { providerId: "http", model: "explicit-model" };
    expect(await streamAiReply(request({ ref: selected, effort: "none", onDelta }), config())).toEqual({
      content: "Hello world", model: selected,
    });
    expect(http.mock.calls[0][0]).toEqual({
      baseUrl: "https://example.test/v1", apiKey: "key", model: selected.model, reasoningEffort: "none",
    });
    expect(onDelta.mock.calls).toEqual([["Hello"], ["Hello world"]]);
    expect(room).not.toHaveBeenCalled();
  });

  it("injects the abort signal into fetch and preserves the other request options", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    http.mockImplementation(async (_settings, _messages, _delta, fetchFn) => {
      await fetchFn!("https://example.test/v1/chat/completions", { method: "POST", body: "payload" });
      return "done";
    });
    await streamAiReply(request({ signal: controller.signal }), config());
    expect(fetchMock).toHaveBeenCalledWith("https://example.test/v1/chat/completions", {
      method: "POST", body: "payload", signal: controller.signal,
    });
  });

  it("converts a wrapped HTTP fetch abort to AbortError and suppresses late deltas", async () => {
    const controller = new AbortController();
    const onDelta = vi.fn();
    http.mockImplementation(async (_settings, _messages, delta) => {
      controller.abort();
      delta?.("late");
      throw Object.assign(new Error("wrapped fetch failure"), { name: "MistaiError" });
    });
    await expect(streamAiReply(request({ signal: controller.signal, onDelta }), config())).rejects.toMatchObject({ name: "AbortError" });
    expect(onDelta).not.toHaveBeenCalled();
  });

  it("preserves non-abort HTTP failures", async () => {
    const error = new Error("upstream failed");
    http.mockRejectedValue(error);
    await expect(streamAiReply(request(), config())).rejects.toBe(error);
  });

  it("routes room requests with model and effort and forwards full deltas", async () => {
    const onDelta = vi.fn();
    room.mockImplementation(async (roomId, sent, options) => {
      expect(roomId).toBe("ai-room");
      expect(sent).toEqual(messages);
      expect(options).toMatchObject({ model: "room-model", reasoningEffort: "max" });
      if (typeof options === "object") {
        options.onDelta?.("Hello", "Hello");
        options.onDelta?.(" room", "Hello room");
      }
      return "Hello room";
    });
    const selected = { providerId: "room", model: "room-model" };
    expect(await streamAiReply(request({ ref: selected, effort: "max", onDelta }), config())).toEqual({
      content: "Hello room", model: selected,
    });
    expect(onDelta.mock.calls).toEqual([["Hello"], ["Hello room"]]);
    expect(http).not.toHaveBeenCalled();
  });

  it.each(["http", "room"])("rejects an already-aborted %s request without starting transport", async providerId => {
    const controller = new AbortController();
    controller.abort();
    await expect(streamAiReply(request({ ref: { providerId, model: "model" }, signal: controller.signal }), config()))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(http).not.toHaveBeenCalled();
    expect(room).not.toHaveBeenCalled();
  });

  it.each(["resolve", "reject"] as const)("aborts a pending room request immediately and ignores late %s", async outcome => {
    const reply = deferred<string>();
    room.mockReturnValue(reply.promise);
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const onDelta = vi.fn();
    const pending = streamAiReply(request({
      ref: { providerId: "room", model: "model" }, signal: controller.signal, onDelta,
    }), config());
    const options = room.mock.calls[0][2];
    if (typeof options === "object") options.onDelta?.("partial", "partial");
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await rejected;
    if (typeof options === "object") options.onDelta?.("late", "partiallate");
    if (outcome === "resolve") reply.resolve("late reply");
    else reply.reject(new Error("late failure"));
    await Promise.resolve();
    expect(onDelta.mock.calls).toEqual([["partial"]]);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("cleans up the room abort listener on success and ignores deltas after completion", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const onDelta = vi.fn();
    await streamAiReply(request({ ref: { providerId: "room", model: "model" }, signal: controller.signal, onDelta }), config());
    const options = room.mock.calls[0][2];
    if (typeof options === "object") options.onDelta?.("late", "late");
    controller.abort();
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(onDelta).not.toHaveBeenCalled();
  });

  it("preserves room errors and removes the abort listener", async () => {
    const error = new Error("room failed");
    room.mockRejectedValue(error);
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    await expect(streamAiReply(request({ ref: { providerId: "room", model: "model" }, signal: controller.signal }), config()))
      .rejects.toBe(error);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("recognizes abort errors from Error and DOMException only", () => {
    expect(isAbortError(new DOMException("stopped", "AbortError"))).toBe(true);
    expect(isAbortError(Object.assign(new Error("stopped"), { name: "AbortError" }))).toBe(true);
    expect(isAbortError(new Error("AbortError"))).toBe(false);
    expect(isAbortError({ name: "AbortError" })).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });
});
