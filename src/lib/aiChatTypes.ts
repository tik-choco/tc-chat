// Shared types for the AI chat space (AI_ROOM_ID in util.ts). This file is
// the frozen contract between aiChatStore.ts (persistence), aiClient.ts
// (LLM transport), useAiChat.ts (state) and AiChat.tsx (UI).
//
// The AI chat space is local-only like the personal notes space: nothing in
// it is ever signed, broadcast, replayed or history-synced on a tc-chat swarm
// topic. A prompt leaves the device only toward the model provider the user
// picked (an OpenAI-compatible HTTP endpoint, or an AI Network room provider
// from the shared llm config).

import type { ModelRefV1 } from "@tik-choco/mistai/llm-config";

export type { ModelRefV1 };

/** reasoning_effort values, in ascending order. Same set as mistai's ReasoningEffort. */
export type AiEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export const AI_EFFORTS: readonly AiEffort[] = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
export const DEFAULT_AI_EFFORT: AiEffort = "medium";

export function isAiEffort(value: unknown): value is AiEffort {
  return typeof value === "string" && (AI_EFFORTS as readonly string[]).includes(value);
}

export type AiRole = "user" | "assistant";

export interface AiMessage {
  id: string;
  role: AiRole;
  content: string;
  createdAt: number;
  /** Set when the user edited the text after it was created. */
  editedAt?: number;
  /** assistant only: the model that produced this reply. */
  model?: ModelRefV1;
  /** assistant only: the reasoning effort the reply was requested with. */
  effort?: AiEffort;
  /** assistant only: generation failed; `content` holds whatever streamed before the failure. */
  error?: string;
  /** assistant only: the user stopped generation; `content` is partial. */
  stopped?: boolean;
}

export interface AiConversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** Model used for the next request in this conversation (undefined = the default chat model). */
  model?: ModelRefV1;
  effort: AiEffort;
  /** A temporary conversation lives in memory only and is never written to storage. */
  temporary?: boolean;
  messages: AiMessage[];
}

/** One row of the persisted conversation index (history list), newest `updatedAt` first. */
export interface AiConversationSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}
