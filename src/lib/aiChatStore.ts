// AI conversations are local-only. Separate records keep each completed reply
// from rewriting the entire history, while the small index drives the sidebar.
import { storage_kv_delete, storage_kv_get, storage_kv_set } from "./mistClient";
import {
  DEFAULT_AI_EFFORT,
  isAiEffort,
  type AiConversation,
  type AiConversationSummary,
  type AiEffort,
  type AiMessage,
  type AiRole,
  type ModelRefV1,
} from "./aiChatTypes";

const INDEX_KEY = "tc-chat:ai-chat:index:v1";
const CONVERSATION_PREFIX = "tc-chat:ai-chat:conv:v1:";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const MAX_AI_CONVERSATIONS = 200;
export const AI_TITLE_MAX = 40;

/** A failed read must not be mistaken for an empty store and overwritten. */
export class AiChatUnavailable extends Error {
  constructor() {
    super("aiChatStore: storage unavailable or corrupt");
    this.name = "AiChatUnavailable";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseModel(value: unknown): ModelRefV1 | undefined {
  if (!isObject(value) || typeof value.providerId !== "string" || typeof value.model !== "string") {
    return undefined;
  }
  return { providerId: value.providerId, model: value.model };
}

function parseSummary(value: unknown): AiConversationSummary | null {
  if (
    !isObject(value) ||
    typeof value.id !== "string" || !value.id ||
    typeof value.title !== "string" ||
    !isTimestamp(value.createdAt) || !isTimestamp(value.updatedAt) ||
    typeof value.messageCount !== "number" ||
    !Number.isInteger(value.messageCount) || value.messageCount < 0
  ) return null;
  return {
    id: value.id,
    title: value.title,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    messageCount: value.messageCount,
  };
}

function parseMessage(value: unknown): AiMessage | null {
  if (
    !isObject(value) ||
    typeof value.id !== "string" || !value.id ||
    (value.role !== "user" && value.role !== "assistant") ||
    typeof value.content !== "string" || !isTimestamp(value.createdAt)
  ) return null;

  const message: AiMessage = {
    id: value.id,
    role: value.role,
    content: value.content,
    createdAt: value.createdAt,
  };
  if (isTimestamp(value.editedAt)) message.editedAt = value.editedAt;
  const model = parseModel(value.model);
  if (model) message.model = model;
  if (value.effort !== undefined) {
    message.effort = isAiEffort(value.effort) ? value.effort : DEFAULT_AI_EFFORT;
  }
  if (typeof value.error === "string") message.error = value.error;
  if (typeof value.stopped === "boolean") message.stopped = value.stopped;
  return message;
}

function parseConversation(value: unknown, id: string): AiConversation | null {
  if (
    !isObject(value) || value.id !== id || !id ||
    typeof value.title !== "string" ||
    !isTimestamp(value.createdAt) || !isTimestamp(value.updatedAt) ||
    !Array.isArray(value.messages)
  ) return null;

  const conversation: AiConversation = {
    id,
    title: value.title,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    effort: isAiEffort(value.effort) ? value.effort : DEFAULT_AI_EFFORT,
    messages: value.messages.map(parseMessage).filter((message): message is AiMessage => message !== null),
  };
  const model = parseModel(value.model);
  if (model) conversation.model = model;
  if (typeof value.temporary === "boolean") conversation.temporary = value.temporary;
  return conversation;
}

async function readJson(key: string): Promise<unknown | undefined> {
  try {
    const bytes = await storage_kv_get(key);
    return bytes ? JSON.parse(decoder.decode(bytes)) as unknown : undefined;
  } catch {
    throw new AiChatUnavailable();
  }
}

/** Returns an empty list only when the index key really is absent. */
export async function loadAiIndex(): Promise<AiConversationSummary[]> {
  const value = await readJson(INDEX_KEY);
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new AiChatUnavailable();
  return value
    .map(parseSummary)
    .filter((summary): summary is AiConversationSummary => summary !== null)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadAiConversation(id: string): Promise<AiConversation | null> {
  const value = await readJson(CONVERSATION_PREFIX + id);
  if (value === undefined) return null;
  const conversation = parseConversation(value, id);
  if (!conversation) throw new AiChatUnavailable();
  return conversation;
}

// One queue covers every index read-modify-write, including a rename's record
// read. Recover the tail after a rejection so one failed write cannot block all
// subsequent operations.
let writeQueue: Promise<void> = Promise.resolve();

function enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(operation);
  writeQueue = result.then(() => undefined, () => undefined);
  return result;
}

async function saveConversation(conv: AiConversation): Promise<void> {
  const index = await loadAiIndex();
  const next = [...index.filter((summary) => summary.id !== conv.id), summarizeAiConversation(conv)]
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const kept = next.slice(0, MAX_AI_CONVERSATIONS);
  const evicted = next.slice(MAX_AI_CONVERSATIONS);

  await storage_kv_set(CONVERSATION_PREFIX + conv.id, encoder.encode(JSON.stringify(conv)));
  await storage_kv_set(INDEX_KEY, encoder.encode(JSON.stringify(kept)));

  // Publish the capped index first, so a failed index write never removes a
  // record still referenced by the old index. Avoid deleting a retained id if
  // a damaged index happened to contain duplicate rows.
  const keptIds = new Set(kept.map((summary) => summary.id));
  for (const id of new Set(evicted.map((summary) => summary.id))) {
    if (!keptIds.has(id)) await storage_kv_delete(CONVERSATION_PREFIX + id);
  }
}

export function saveAiConversation(conv: AiConversation): Promise<void> {
  if (conv.temporary) return Promise.resolve();
  return enqueueWrite(() => saveConversation(conv));
}

export function deleteAiConversation(id: string): Promise<void> {
  return enqueueWrite(async () => {
    const index = await loadAiIndex();
    // Remove the row before the record so a failed index write cannot leave a
    // visible history item pointing at a record we already deleted.
    await storage_kv_set(INDEX_KEY, encoder.encode(JSON.stringify(index.filter((row) => row.id !== id))));
    await storage_kv_delete(CONVERSATION_PREFIX + id);
  });
}

export function renameAiConversation(id: string, title: string): Promise<void> {
  return enqueueWrite(async () => {
    const conversation = await loadAiConversation(id);
    if (!conversation) return;
    const nextTitle = Array.from(title.trim()).slice(0, AI_TITLE_MAX).join("") || conversation.title;
    if (conversation.temporary) return;
    await saveConversation({ ...conversation, title: nextTitle });
  });
}

export function createAiConversation(
  opts: { model?: ModelRefV1; effort: AiEffort; temporary?: boolean },
  now?: number,
): AiConversation {
  const at = now ?? Date.now();
  return {
    id: crypto.randomUUID(),
    title: "",
    createdAt: at,
    updatedAt: at,
    ...(opts.model !== undefined ? { model: opts.model } : {}),
    effort: opts.effort,
    ...(opts.temporary !== undefined ? { temporary: opts.temporary } : {}),
    messages: [],
  };
}

export function createAiMessage(role: AiRole, content: string, extra?: Partial<AiMessage>, now?: number): AiMessage {
  return { ...extra, id: crypto.randomUUID(), role, content, createdAt: now ?? Date.now() };
}

export function deriveAiTitle(text: string): string {
  const line = text.split(/\r\n|\r|\n/).find((part) => part.trim()) ?? "";
  const title = line.trim().replace(/\s+/g, " ");
  const characters = Array.from(title);
  return characters.length > AI_TITLE_MAX ? `${characters.slice(0, AI_TITLE_MAX - 1).join("")}…` : title;
}

export function summarizeAiConversation(conv: AiConversation): AiConversationSummary {
  return {
    id: conv.id,
    title: conv.title,
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
    messageCount: conv.messages.length,
  };
}

export function withMessageEdited(conv: AiConversation, messageId: string, content: string, now?: number): AiConversation {
  const index = conv.messages.findIndex((message) => message.id === messageId);
  if (index < 0) return conv;
  const at = now ?? Date.now();
  const edited = { ...conv.messages[index], content, editedAt: at };
  delete edited.error;
  delete edited.stopped;
  const messages = conv.messages.slice();
  messages[index] = edited;
  return { ...conv, messages, updatedAt: at };
}

export function withMessageRemoved(conv: AiConversation, messageId: string, now?: number): AiConversation {
  const index = conv.messages.findIndex((message) => message.id === messageId);
  if (index < 0) return conv;
  return {
    ...conv,
    messages: [...conv.messages.slice(0, index), ...conv.messages.slice(index + 1)],
    updatedAt: now ?? Date.now(),
  };
}

export function withMessagesThrough(conv: AiConversation, messageId: string, now?: number): AiConversation {
  const index = conv.messages.findIndex((message) => message.id === messageId);
  if (index < 0 || index === conv.messages.length - 1) return conv;
  return { ...conv, messages: conv.messages.slice(0, index + 1), updatedAt: now ?? Date.now() };
}

export function withMessagesBefore(conv: AiConversation, messageId: string, now?: number): AiConversation {
  const index = conv.messages.findIndex((message) => message.id === messageId);
  if (index < 0) return conv;
  return { ...conv, messages: conv.messages.slice(0, index), updatedAt: now ?? Date.now() };
}

export function toChatMessages(conv: AiConversation): { role: AiRole; content: string }[] {
  return conv.messages
    .filter((message) => message.role !== "assistant" || message.content !== "")
    .map(({ role, content }) => ({ role, content }));
}
