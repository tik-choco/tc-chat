import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AI_CHAT_TASK_ID, aiLocalSettingsAdapter, getAiLocalSettings, getDefaultChatModel,
  setDefaultChatModel, subscribeAiLocalSettings,
} from "./aiLocalSettings";
import { DEFAULT_AI_EFFORT } from "./aiChatTypes";

const KEY = "tc-chat:llm-local-settings:v1";
function invalidate(key: string | null = KEY) {
  window.dispatchEvent(new StorageEvent("storage", { key }));
}

beforeEach(() => {
  localStorage.clear();
  invalidate();
});
afterEach(() => vi.restoreAllMocks());

describe("AI local settings", () => {
  it("defaults defensively for absent, malformed and invalid values", () => {
    expect(getAiLocalSettings()).toEqual({ tasks: {}, roomProvide: {}, recentModels: [] });
    for (const value of ["{", "[]", "null", '{"tasks":[],"roomProvide":null,"recentModels":1}']) {
      localStorage.setItem(KEY, value);
      invalidate();
      expect(getAiLocalSettings()).toEqual({ tasks: {}, roomProvide: {}, recentModels: [] });
      expect(getDefaultChatModel()).toEqual({ ref: undefined, effort: DEFAULT_AI_EFFORT });
    }
  });

  it("round trips the mistai shape and preserves other tasks and room providers", () => {
    const settings = {
      tasks: { translation: { ref: { providerId: "p", model: "translate" }, reasoningEffort: "low" as const } },
      roomProvide: { room: { enabled: true, shared: [{ providerId: "p", model: "shared" }] } },
      recentModels: [],
    };
    aiLocalSettingsAdapter.set(settings);
    expect(aiLocalSettingsAdapter.get()).toEqual(settings);
    setDefaultChatModel({ ref: { providerId: "p", model: "chat" }, effort: "max" });
    expect(getAiLocalSettings().tasks.translation).toEqual(settings.tasks.translation);
    expect(getAiLocalSettings().roomProvide).toEqual(settings.roomProvide);
    invalidate();
    expect(getDefaultChatModel()).toEqual({ ref: { providerId: "p", model: "chat" }, effort: "max" });
    expect(getAiLocalSettings().tasks[AI_CHAT_TASK_ID].reasoningEffort).toBe("max");
  });

  it("falls back for invalid effort and drops malformed references", () => {
    localStorage.setItem(KEY, JSON.stringify({
      tasks: { chat: { ref: { providerId: "p", model: "m" }, reasoningEffort: "extreme" }, bad: 42 },
      roomProvide: { broken: null }, recentModels: [null, {}, { providerId: "p", model: "m" }],
    }));
    invalidate();
    expect(getDefaultChatModel()).toEqual({ ref: { providerId: "p", model: "m" }, effort: DEFAULT_AI_EFFORT });
    expect(getAiLocalSettings().recentModels).toEqual([{ providerId: "p", model: "m" }]);
    expect(getAiLocalSettings().roomProvide).toEqual({});
  });

  it("keeps an omitted ref, clears a null ref, and deduplicates/caps recent models", () => {
    for (let i = 0; i < 10; i++) setDefaultChatModel({ ref: { providerId: "p", model: `m${i}` } });
    setDefaultChatModel({ ref: { providerId: "p", model: "m5" } });
    expect(getAiLocalSettings().recentModels.map((ref) => ref.model)).toEqual(["m5", "m9", "m8", "m7", "m6", "m4", "m3", "m2"]);
    setDefaultChatModel({ effort: "none" });
    expect(getDefaultChatModel()).toEqual({ ref: { providerId: "p", model: "m5" }, effort: "none" });
    setDefaultChatModel({ ref: null });
    expect(getDefaultChatModel()).toEqual({ ref: undefined, effort: "none" });
    expect(getAiLocalSettings().recentModels).toHaveLength(8);
  });

  it("also deduplicates older entries when adding a recent model", () => {
    const old = { providerId: "p", model: "old" };
    aiLocalSettingsAdapter.set({ tasks: {}, roomProvide: {}, recentModels: [old, old] });
    setDefaultChatModel({ ref: { providerId: "p", model: "new" } });
    expect(getAiLocalSettings().recentModels).toEqual([{ providerId: "p", model: "new" }, old]);
  });

  it("caches reads and notifies for same-tab writes and other-tab changes", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAiLocalSettings(listener);
    const getItem = vi.spyOn(localStorage, "getItem");
    const first = getAiLocalSettings();
    expect(getAiLocalSettings()).toBe(first);
    expect(getItem).toHaveBeenCalledTimes(1);
    setDefaultChatModel({ effort: "high" });
    expect(listener).toHaveBeenCalledTimes(1);
    localStorage.setItem(KEY, JSON.stringify({ tasks: { chat: { reasoningEffort: "low" } } }));
    invalidate("another-key");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getDefaultChatModel().effort).toBe("high");
    invalidate();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(getDefaultChatModel().effort).toBe("low");
    unsubscribe();
    invalidate(null);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("fails soft when storage cannot be read or written", () => {
    vi.spyOn(localStorage, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(getAiLocalSettings()).toEqual({ tasks: {}, roomProvide: {}, recentModels: [] });
    vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("full"); });
    const cb = vi.fn();
    const unsubscribe = aiLocalSettingsAdapter.subscribe(cb);
    expect(() => setDefaultChatModel({ effort: "high" })).not.toThrow();
    expect(cb).toHaveBeenCalledOnce();
    expect(getDefaultChatModel().effort).toBe("high");
    unsubscribe();
  });
});
