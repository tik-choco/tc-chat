import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { ModelRefV1 } from "@tik-choco/mistai/llm-config";
import type { AiConversation, AiConversationSummary, AiEffort } from "../lib/aiChatTypes";
import {
  createAiConversation, createAiMessage, deriveAiTitle, summarizeAiConversation,
  withMessageEdited, withMessageRemoved, withMessagesThrough, withMessagesBefore, toChatMessages,
  loadAiIndex, loadAiConversation, saveAiConversation, deleteAiConversation, renameAiConversation,
  AI_TITLE_MAX, MAX_AI_CONVERSATIONS,
} from "../lib/aiChatStore";
import { AiClientError, isAbortError, streamAiReply } from "../lib/aiClient";
import { getNode } from "../lib/mistClient";
import {
  getAiLocalSettings, getDefaultChatModel, setDefaultChatModel, subscribeAiLocalSettings,
} from "../lib/aiLocalSettings";

export type AiChatError = "load" | "save" | "config" | "generate";
export interface UseAiChat {
  ready: boolean;
  error: AiChatError | null;
  errorDetail: string | null;
  dismissError(): void;
  conversations: AiConversationSummary[];
  active: AiConversation;
  streamingMessageId: string | null;
  model: ModelRefV1 | undefined;
  effort: AiEffort;
  recentModels: ModelRefV1[];
  selectConversation(id: string): Promise<void>;
  newConversation(opts?: { temporary?: boolean }): void;
  setTemporary(on: boolean): void;
  renameConversation(id: string, title: string): Promise<void>;
  deleteConversation(id: string): Promise<void>;
  setModel(ref: ModelRefV1 | undefined): void;
  setEffort(effort: AiEffort): void;
  send(text: string): Promise<void>;
  stop(): void;
  regenerate(assistantMessageId: string): Promise<void>;
  editMessage(messageId: string, content: string, opts?: { resend?: boolean }): Promise<void>;
  deleteMessage(messageId: string): Promise<void>;
}

const ACTIVE_KEY = "tc-chat:ai-chat:active:v1";

function draft(temporary = false): AiConversation {
  const { ref, effort } = getDefaultChatModel();
  return createAiConversation({ model: ref, effort, temporary });
}

function remember(id: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {
    // Restoring the last selection is optional, unlike conversation storage.
  }
}

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface Generation {
  number: number;
  conv: AiConversation;
  messageId: string;
  controller: AbortController;
  full: string;
  timer: ReturnType<typeof setTimeout> | null;
  ended: boolean;
  saved: Promise<void> | null;
}

type Outcome = { kind: "success"; content: string; model: ModelRefV1 }
  | { kind: "stop" } | { kind: "failure"; error: unknown };

export function useAiChat(): UseAiChat {
  const [active, setActive] = useState<AiConversation>(() => draft());
  const [conversations, setConversations] = useState<AiConversationSummary[]>([]);
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState<{ error: AiChatError; detail: string | null } | null>(null);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [recentModels, setRecentModels] = useState(() => getAiLocalSettings().recentModels);
  const activeRef = useRef(active);
  const readyRef = useRef(false);
  const mounted = useRef(true);
  const selection = useRef(0);
  const generation = useRef(0);
  const running = useRef<Generation | null>(null);
  const pendingSaves = useRef<Promise<void>>(Promise.resolve());

  const invalidateSelection = useCallback(() => { selection.current++; }, []);

  const report = useCallback((error: AiChatError, raw: string | null = null) => {
    if (mounted.current) setFailure({ error, detail: raw });
  }, []);

  const publish = useCallback((conv: AiConversation) => {
    activeRef.current = conv;
    if (mounted.current) setActive(conv);
  }, []);

  const save = useCallback((conv: AiConversation): Promise<void> => {
    if (conv.temporary) return Promise.resolve();
    const operation = (async () => {
      try {
        await saveAiConversation(conv);
        if (mounted.current) {
          const summary = summarizeAiConversation(conv);
          setConversations((list) => [summary, ...list.filter((item) => item.id !== conv.id)]
            .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_AI_CONVERSATIONS));
        }
        if (activeRef.current.id === conv.id && !activeRef.current.temporary) remember(conv.id);
      } catch {
        report("save");
      }
    })();
    // A second navigation can arrive after a stream has stopped but before
    // its final write lands. Reads must wait for that write as well.
    pendingSaves.current = Promise.all([pendingSaves.current, operation]).then(() => undefined);
    return operation;
  }, [report]);

  const showGeneration = useCallback((run: Generation) => {
    if (running.current !== run || run.ended || generation.current !== run.number) return;
    run.conv = {
      ...run.conv,
      messages: run.conv.messages.map((msg) => msg.id === run.messageId ? { ...msg, content: run.full } : msg),
    };
    if (activeRef.current.id === run.conv.id) publish(run.conv);
  }, [publish]);

  const finish = useCallback((run: Generation, outcome: Outcome): Promise<void> => {
    if (run.ended) return run.saved ?? Promise.resolve();
    run.ended = true;
    if (run.timer !== null) clearTimeout(run.timer);
    run.timer = null;
    const isCurrent = running.current === run && generation.current === run.number;
    const stopped = outcome.kind === "stop";
    const configError = outcome.kind === "failure" && outcome.error instanceof AiClientError;
    const content = outcome.kind === "success" ? outcome.content : run.full;
    const messageError = outcome.kind === "failure" && !configError ? detail(outcome.error) : undefined;
    run.conv = {
      ...run.conv,
      updatedAt: Date.now(),
      messages: run.conv.messages.flatMap((msg) => {
        if (msg.id !== run.messageId) return [msg];
        if ((stopped || configError) && !content) return [];
        return [{ ...msg, content, stopped: stopped || undefined, error: messageError,
          model: outcome.kind === "success" ? outcome.model : msg.model }];
      }),
    };
    if (isCurrent) {
      running.current = null;
      if (mounted.current) setStreamingMessageId(null);
      if (activeRef.current.id === run.conv.id) publish(run.conv);
      if (outcome.kind === "failure") report(configError ? "config" : "generate", detail(outcome.error));
    }
    // Finalize synchronously before aborting: late client callbacks cannot
    // rewrite this snapshot or attach their reply to a newly selected chat.
    run.saved = save(run.conv);
    if (stopped) run.controller.abort();
    return run.saved;
  }, [publish, report, save]);

  const stopAndSave = useCallback((): Promise<void> => {
    const run = running.current;
    if (run) void finish(run, { kind: "stop" });
    return pendingSaves.current;
  }, [finish]);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    const initialSelection = selection.current;
    const unsubscribe = subscribeAiLocalSettings(() => {
      setRecentModels(getAiLocalSettings().recentModels);
    });
    (async () => {
      try { await getNode(); } catch { /* The KV read supplies the actionable error. */ }
      try {
        const list = await loadAiIndex();
        if (cancelled) return;
        setConversations(list);
        let id: string | null = null;
        try { id = localStorage.getItem(ACTIVE_KEY); } catch { /* Optional selection restore. */ }
        if (id && list.some((item) => item.id === id) && initialSelection === selection.current) {
          const restored = await loadAiConversation(id);
          if (!cancelled && initialSelection === selection.current && restored && !restored.temporary) publish(restored);
        }
      } catch {
        if (!cancelled) report("load");
      }
      if (!cancelled) {
        readyRef.current = true;
        setReady(true);
      }
    })();
    return () => {
      cancelled = true;
      mounted.current = false;
      invalidateSelection();
      unsubscribe();
      void stopAndSave();
    };
  }, [invalidateSelection, publish, report, stopAndSave]);

  const newConversation = useCallback((opts?: { temporary?: boolean }) => {
    void stopAndSave();
    selection.current++;
    const next = draft(opts?.temporary ?? !!activeRef.current.temporary);
    publish(next);
    if (!next.temporary) remember(null);
    setFailure(null);
  }, [publish, stopAndSave]);

  const selectConversation = useCallback(async (id: string) => {
    const stopped = stopAndSave();
    const ticket = ++selection.current;
    await stopped;
    if (!mounted.current || ticket !== selection.current) return;
    try {
      const conv = await loadAiConversation(id);
      if (!mounted.current || ticket !== selection.current) return;
      if (!conv || conv.temporary) {
        publish(draft());
        remember(null);
      } else {
        publish(conv);
        remember(conv.id);
      }
      setFailure(null);
    } catch {
      if (ticket === selection.current) report("load");
    }
  }, [publish, report, stopAndSave]);

  const generate = useCallback(async (conv: AiConversation) => {
    if (running.current || !mounted.current) return;
    const assistant = createAiMessage("assistant", "", { model: conv.model, effort: conv.effort });
    const run: Generation = {
      number: ++generation.current,
      conv: { ...conv, messages: [...conv.messages, assistant], updatedAt: Date.now() },
      messageId: assistant.id, controller: new AbortController(), full: "", timer: null, ended: false, saved: null,
    };
    running.current = run;
    publish(run.conv);
    setStreamingMessageId(assistant.id);
    setFailure(null);
    try {
      const result = await streamAiReply({
        ref: conv.model, effort: conv.effort, messages: toChatMessages(conv), signal: run.controller.signal,
        onDelta(full) {
          if (run.ended || running.current !== run || generation.current !== run.number) return;
          run.full = full;
          if (run.timer === null) run.timer = setTimeout(() => {
            run.timer = null;
            showGeneration(run);
          }, 50);
        },
      });
      await finish(run, { kind: "success", ...result });
    } catch (error) {
      await finish(run, isAbortError(error) || run.controller.signal.aborted
        ? { kind: "stop" } : { kind: "failure", error });
    }
  }, [finish, publish, showGeneration]);

  const send = useCallback(async (text: string) => {
    const body = text.trim();
    if (!body || running.current || !readyRef.current) return;
    selection.current++;
    const conv = activeRef.current;
    await generate({
      ...conv, title: conv.title || deriveAiTitle(body), updatedAt: Date.now(),
      messages: [...conv.messages, createAiMessage("user", body)],
    });
  }, [generate]);

  const setTemporary = useCallback((on: boolean) => {
    const conv = activeRef.current;
    if (!!conv.temporary === on) return;
    if (conv.messages.length) newConversation({ temporary: on });
    else {
      selection.current++;
      publish({ ...conv, temporary: on });
      if (!on) remember(null);
    }
  }, [newConversation, publish]);

  const changeOptions = useCallback((patch: Partial<Pick<AiConversation, "model" | "effort">>) => {
    selection.current++;
    const next = { ...activeRef.current, ...patch, updatedAt: Date.now() };
    publish(next);
    if (running.current?.conv.id === next.id) running.current.conv = next;
    if (next.messages.length) void save(next);
  }, [publish, save]);

  const setModel = useCallback((ref: ModelRefV1 | undefined) => {
    changeOptions({ model: ref });
    setDefaultChatModel({ ref: ref ?? null });
  }, [changeOptions]);

  const setEffort = useCallback((effort: AiEffort) => {
    changeOptions({ effort });
    setDefaultChatModel({ effort });
  }, [changeOptions]);

  const renameConversation = useCallback(async (id: string, title: string) => {
    const trimmed = Array.from(title.trim()).slice(0, AI_TITLE_MAX).join("");
    if (!trimmed) return;
    if (activeRef.current.id === id) {
      const next = { ...activeRef.current, title: trimmed, updatedAt: Date.now() };
      publish(next);
      if (running.current?.conv.id === id) running.current.conv = next;
      if (next.messages.length) await save(next);
    } else {
      try {
        await renameAiConversation(id, trimmed);
        if (mounted.current) setConversations(await loadAiIndex());
      } catch { report("save"); }
    }
  }, [publish, report, save]);

  const deleteConversation = useCallback(async (id: string) => {
    const isActive = activeRef.current.id === id;
    const wasTemporary = isActive && !!activeRef.current.temporary;
    const stopped = isActive ? stopAndSave() : Promise.resolve();
    if (isActive) newConversation();
    await stopped;
    if (wasTemporary) return;
    try {
      await deleteAiConversation(id);
      if (mounted.current) setConversations((list) => list.filter((item) => item.id !== id));
    } catch { report("save"); }
  }, [newConversation, report, stopAndSave]);

  const regenerate = useCallback(async (messageId: string) => {
    const id = activeRef.current.id;
    const ticket = selection.current;
    await stopAndSave();
    if (!mounted.current || activeRef.current.id !== id || selection.current !== ticket) return;
    const conv = activeRef.current;
    if (conv.messages.find((msg) => msg.id === messageId)?.role !== "assistant") return;
    await generate(withMessagesBefore(conv, messageId));
  }, [generate, stopAndSave]);

  const editMessage = useCallback(async (messageId: string, content: string, opts?: { resend?: boolean }) => {
    const id = activeRef.current.id;
    const ticket = selection.current;
    await stopAndSave();
    if (!mounted.current || activeRef.current.id !== id || selection.current !== ticket) return;
    const conv = activeRef.current;
    const msg = conv.messages.find((item) => item.id === messageId);
    if (!msg) return;
    const edited = withMessageEdited(conv, messageId, content);
    if (opts?.resend && msg.role === "user") await generate(withMessagesThrough(edited, messageId));
    else {
      publish(edited);
      await save(edited);
    }
  }, [generate, publish, save, stopAndSave]);

  const deleteMessage = useCallback(async (messageId: string) => {
    const id = activeRef.current.id;
    const ticket = selection.current;
    await stopAndSave();
    if (!mounted.current || activeRef.current.id !== id || selection.current !== ticket) return;
    const conv = activeRef.current;
    const next = withMessageRemoved(conv, messageId);
    if (next === conv) return;
    publish(next);
    await save(next);
  }, [publish, save, stopAndSave]);

  return {
    ready, error: failure?.error ?? null, errorDetail: failure?.detail ?? null,
    dismissError: () => setFailure(null), conversations, active, streamingMessageId,
    model: active.model, effort: active.effort, recentModels,
    selectConversation, newConversation, setTemporary, renameConversation, deleteConversation,
    setModel, setEffort, send, stop: () => { void stopAndSave(); }, regenerate, editMessage, deleteMessage,
  };
}
