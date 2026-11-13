import { streamChatCompletion, type ChatMessage } from "@tik-choco/mistai";
import {
  emptyLlmConfig,
  isNetworkProviderBaseUrl,
  loadLlmConfig,
  resolveModel,
  resolveModelExact,
  roomIdFromBaseUrl,
  type ModelRefV1,
  type ResolvedLlmTargetV1,
  type SharedLlmConfigV1,
} from "@tik-choco/mistai/llm-config";
import type { AiEffort } from "./aiChatTypes";
import { aiRooms } from "./mistaiNode";

export type AiClientErrorCode = "no-model" | "unresolved";

export class AiClientError extends Error {
  readonly code: AiClientErrorCode;

  constructor(code: AiClientErrorCode) {
    super(code === "no-model" ? "No default AI model is configured." : "The selected AI model is unavailable.");
    this.name = "AiClientError";
    this.code = code;
  }
}

export interface AiStreamRequest {
  ref: ModelRefV1 | undefined;
  effort: AiEffort;
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  signal?: AbortSignal;
  onDelta?: (full: string) => void;
}

export interface AiStreamResult {
  content: string;
  model: ModelRefV1;
}

export function isAbortError(err: unknown): boolean {
  return (err instanceof Error || err instanceof DOMException) && err.name === "AbortError";
}

function abortError(): DOMException {
  return new DOMException("The AI request was aborted.", "AbortError");
}

export function resolveAiTarget(
  ref: ModelRefV1 | undefined,
  config: SharedLlmConfigV1 = loadLlmConfig() ?? emptyLlmConfig(),
): ResolvedLlmTargetV1 | null {
  return ref === undefined ? resolveModel(config, undefined) : resolveModelExact(config, ref);
}

function streamRoomReply(target: ResolvedLlmTargetV1, req: AiStreamRequest): Promise<string> {
  // Room consumers cannot cancel an individual request. Settle locally and
  // keep observing the remote promise so late failures/deltas stay harmless.
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const finish = (result: { content: string } | { error: unknown }) => {
      if (settled) return;
      settled = true;
      req.signal?.removeEventListener("abort", onAbort);
      if ("error" in result) reject(result.error);
      else resolve(result.content);
    };
    const onAbort = () => finish({ error: abortError() });
    req.signal?.addEventListener("abort", onAbort, { once: true });
    if (req.signal?.aborted) { onAbort(); return; }
    try {
      const reply = aiRooms.requestRoomChat(roomIdFromBaseUrl(target.baseUrl), req.messages, {
        model: target.model,
        reasoningEffort: req.effort,
        onDelta: (_delta, full) => {
          if (!settled && !req.signal?.aborted) req.onDelta?.(full);
        },
      });
      void reply.then(content => finish({ content }), error => finish({ error }));
    } catch (error) {
      finish({ error });
    }
  });
}

export async function streamAiReply(
  req: AiStreamRequest,
  config: SharedLlmConfigV1 = loadLlmConfig() ?? emptyLlmConfig(),
): Promise<AiStreamResult> {
  if (req.signal?.aborted) throw abortError();
  const target = resolveAiTarget(req.ref, config);
  if (!target) throw new AiClientError(req.ref === undefined && !config.defaultModel ? "no-model" : "unresolved");
  let content: string;
  if (isNetworkProviderBaseUrl(target.baseUrl)) {
    content = await streamRoomReply(target, req);
  } else {
    let full = "";
    try {
      content = await streamChatCompletion({
        baseUrl: target.baseUrl,
        apiKey: target.apiKey,
        model: target.model,
        reasoningEffort: req.effort,
      }, req.messages satisfies ChatMessage[], delta => {
        if (req.signal?.aborted) return;
        full += delta;
        req.onDelta?.(full);
      }, (input, init) => fetch(input, { ...init, signal: req.signal }));
      if (req.signal?.aborted) throw abortError();
    } catch (error) {
      // mistai wraps fetch failures (including abort) in MistaiError.
      if (req.signal?.aborted) throw abortError();
      throw error;
    }
  }
  return { content, model: { providerId: target.providerId, model: target.model } };
}
