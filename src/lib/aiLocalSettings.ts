import type { LlmLocalSettings } from "@tik-choco/mistai/preact";
import type { ModelRefV1 } from "@tik-choco/mistai/llm-config";
import { DEFAULT_AI_EFFORT, isAiEffort, type AiEffort } from "./aiChatTypes";

const KEY = "tc-chat:llm-local-settings:v1";
export const AI_CHAT_TASK_ID = "chat";
const listeners = new Set<() => void>();
let cached: LlmLocalSettings | undefined;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function modelRef(value: unknown): value is ModelRefV1 {
  return record(value) && typeof value.providerId === "string" && !!value.providerId.trim()
    && typeof value.model === "string" && !!value.model.trim();
}

function parse(value: unknown): LlmLocalSettings {
  const result: LlmLocalSettings = { tasks: {}, roomProvide: {}, recentModels: [] };
  if (!record(value)) return result;
  if (record(value.tasks)) {
    result.tasks = Object.fromEntries(Object.entries(value.tasks).flatMap(([id, task]) => {
      if (!record(task)) return [];
      return [[id, {
        ...task,
        ref: modelRef(task.ref) ? task.ref : undefined,
        reasoningEffort: isAiEffort(task.reasoningEffort) ? task.reasoningEffort : DEFAULT_AI_EFFORT,
      }]];
    }));
  }
  if (record(value.roomProvide)) {
    result.roomProvide = Object.fromEntries(Object.entries(value.roomProvide).flatMap(([id, room]) => {
      if (!record(room) || typeof room.enabled !== "boolean" || !Array.isArray(room.shared)) return [];
      return [[id, { ...room, enabled: room.enabled, shared: room.shared.filter(modelRef) }]];
    }));
  }
  if (Array.isArray(value.recentModels)) result.recentModels = value.recentModels.filter(modelRef);
  return result;
}

export function getAiLocalSettings(): LlmLocalSettings {
  if (cached) return cached;
  try {
    cached = parse(JSON.parse(localStorage.getItem(KEY) ?? "null"));
  } catch {
    // Storage may be blocked, or contain an older/broken value.
    cached = parse(null);
  }
  return cached;
}

function notify(): void {
  for (const cb of listeners) cb();
}

export function setAiLocalSettings(value: LlmLocalSettings): void {
  cached = parse(value);
  try {
    localStorage.setItem(KEY, JSON.stringify(cached));
  } catch {
    // Keep settings usable for this tab even if persistence is unavailable.
  }
  notify();
}

function onStorage(event: StorageEvent): void {
  if (event.key !== KEY && event.key !== null) return;
  cached = undefined;
  notify();
}

// The cache must also be invalidated while no settings UI is mounted.
if (typeof window !== "undefined") window.addEventListener("storage", onStorage);

export function subscribeAiLocalSettings(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export const aiLocalSettingsAdapter = {
  get: getAiLocalSettings,
  set: setAiLocalSettings,
  subscribe: subscribeAiLocalSettings,
};

export function getDefaultChatModel(): { ref?: ModelRefV1; effort: AiEffort } {
  const task = getAiLocalSettings().tasks[AI_CHAT_TASK_ID];
  return {
    ref: task?.ref,
    effort: isAiEffort(task?.reasoningEffort) ? task.reasoningEffort : DEFAULT_AI_EFFORT,
  };
}

export function setDefaultChatModel(patch: { ref?: ModelRefV1 | null; effort?: AiEffort }): void {
  const settings = getAiLocalSettings();
  const current = getDefaultChatModel();
  const ref = patch.ref === undefined ? current.ref : patch.ref ?? undefined;
  const selected = patch.ref;
  const recentModels = selected
    ? [selected, ...settings.recentModels].filter((item, index, models) => models.findIndex((other) =>
      other.providerId === item.providerId && other.model === item.model) === index).slice(0, 8)
    : settings.recentModels;
  setAiLocalSettings({
    ...settings,
    tasks: {
      ...settings.tasks,
      [AI_CHAT_TASK_ID]: { ...settings.tasks[AI_CHAT_TASK_ID], ref, reasoningEffort: patch.effort ?? current.effort },
    },
    recentModels,
  });
}
