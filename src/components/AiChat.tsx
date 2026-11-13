import { useEffect, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import {
  Check,
  Copy,
  Ghost,
  History,
  Menu,
  Pencil,
  RefreshCw,
  Send,
  Settings,
  Sparkles,
  Square,
  SquarePen,
  Trash2,
  X,
} from "lucide-preact";
import { LlmSettings, ModelPicker, useLlmConfig } from "@tik-choco/mistai/preact";
import type { LlmSettingsLocale } from "@tik-choco/mistai/preact";
import "@tik-choco/mistai/ui.css";
import "../styles/aiChat.css";
import { useAiChat } from "../hooks/useAiChat";
import { AI_CHAT_TASK_ID, aiLocalSettingsAdapter } from "../lib/aiLocalSettings";
import {
  AI_EFFORTS,
  isAiEffort,
  type AiConversationSummary,
  type AiEffort,
  type AiMessage,
} from "../lib/aiChatTypes";
import { useLocale, useT, type Locale, type TFunc } from "../lib/i18n";
import { formatTime } from "../lib/util";
import { MarkdownView } from "./MarkdownView";
import { ConfirmDialog } from "./ConfirmDialog";

/** Narrow-screen breakpoint shared with styles/responsive.css. */
const NARROW_QUERY = "(max-width: 768px)";

function isNarrow(): boolean {
  try {
    return typeof window !== "undefined" && !!window.matchMedia?.(NARROW_QUERY).matches;
  } catch {
    return false;
  }
}

/** tc-chat's UI locale -> the locales mistai's settings modal ships. */
function settingsLocale(locale: Locale): LlmSettingsLocale {
  if (locale === "ja") return "ja";
  if (locale === "zh") return "zh-CN";
  return "en";
}

const EFFORT_KEYS: Record<AiEffort, string> = {
  none: "ai.effortNone",
  minimal: "ai.effortMinimal",
  low: "ai.effortLow",
  medium: "ai.effortMedium",
  high: "ai.effortHigh",
  xhigh: "ai.effortXhigh",
  max: "ai.effortMax",
};

function effortLabel(t: TFunc, effort: AiEffort): string {
  return t(EFFORT_KEYS[effort]);
}

/** Today -> HH:MM, otherwise a short month/day, in the UI locale. */
function formatShortTime(ts: number, locale: Locale): string {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return formatTime(ts);
  try {
    return d.toLocaleDateString(locale, { month: "short", day: "numeric" });
  } catch {
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }
}

// ---------------------------------------------------------------------------
// History pane
// ---------------------------------------------------------------------------

function HistoryRow(props: {
  summary: AiConversationSummary;
  active: boolean;
  locale: Locale;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onRequestDelete: (id: string) => void;
}) {
  const { summary, active, locale, onSelect, onRename, onRequestDelete } = props;
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(summary.title);
  // Enter and blur both commit; this stops the blur that follows an Enter (or
  // an Escape) from committing a second time / un-cancelling.
  const doneRef = useRef(false);
  const title = summary.title || t("ai.newChatTitle");

  function begin() {
    doneRef.current = false;
    setDraft(summary.title);
    setEditing(true);
  }

  function commit() {
    if (doneRef.current) return;
    doneRef.current = true;
    const next = draft.trim();
    if (next && next !== summary.title) onRename(summary.id, next);
    setEditing(false);
  }

  function cancel() {
    doneRef.current = true;
    setEditing(false);
  }

  return (
    <li>
      <div class={`ai-history-row${active ? " ai-history-row--active" : ""}`}>
        {editing ? (
          <input
            class="ai-rename-input"
            type="text"
            value={draft}
            aria-label={t("ai.renameLabel")}
            autofocus
            onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
            onBlur={commit}
            onKeyDown={(e) => {
              // IME composition commits with Enter; that must not also rename.
              if (e.isComposing || e.keyCode === 229) return;
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancel();
              }
            }}
          />
        ) : (
          <>
            <button
              type="button"
              class="ai-history-item"
              aria-current={active ? "true" : undefined}
              onClick={() => onSelect(summary.id)}
            >
              <span class="ai-history-item-title">{title}</span>
              <span class="ai-history-item-time">{formatShortTime(summary.updatedAt, locale)}</span>
            </button>
            <span class="ai-history-actions">
              <button
                type="button"
                class="ai-history-btn"
                title={t("ai.rename")}
                aria-label={t("ai.rename")}
                onClick={begin}
              >
                <Pencil size={14} />
              </button>
              <button
                type="button"
                class="ai-history-btn ai-history-btn--danger"
                title={t("ai.delete")}
                aria-label={t("ai.delete")}
                onClick={() => onRequestDelete(summary.id)}
              >
                <Trash2 size={14} />
              </button>
            </span>
          </>
        )}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// One message
// ---------------------------------------------------------------------------

function MessageItem(props: {
  message: AiMessage;
  streaming: boolean;
  onEdit: (id: string, content: string, opts?: { resend?: boolean }) => void;
  onRegenerate: (id: string) => void;
  onRequestDelete: (id: string) => void;
}) {
  const { message, streaming, onEdit, onRegenerate, onRequestDelete } = props;
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isUser = message.role === "user";

  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );

  function beginEdit() {
    setDraft(message.content);
    setEditing(true);
  }

  function save(resend: boolean) {
    // A blank body would leave an empty bubble that can't be told apart from a
    // failed generation; deleting is the way to remove a message.
    if (!draft.trim()) return;
    if (resend) onEdit(message.id, draft, { resend: true });
    else onEdit(message.id, draft);
    setEditing(false);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be denied (insecure context / permissions); the text is
      // still selectable, so failing quietly is the right degradation.
    }
  }

  const modelLabel = message.model?.model;

  return (
    <article
      class={`ai-msg ai-msg--${isUser ? "user" : "assistant"}`}
      data-message-id={message.id}
      aria-busy={streaming ? "true" : undefined}
    >
      {!isUser && (modelLabel || message.effort) && (
        <div class="ai-msg-meta">
          {modelLabel && <span class="ai-msg-model">{modelLabel}</span>}
          {message.effort && <span class="ai-msg-effort">{effortLabel(t, message.effort)}</span>}
        </div>
      )}

      {editing ? (
        <div class="ai-edit">
          <textarea
            class="ai-edit-input"
            value={draft}
            rows={4}
            autofocus
            aria-label={t("ai.edit")}
            onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditing(false);
            }}
          />
          <div class="ai-edit-actions">
            <button type="button" class="btn-ghost" onClick={() => setEditing(false)}>
              {t("ai.cancel")}
            </button>
            <button type="button" class="btn-ghost" disabled={!draft.trim()} onClick={() => save(false)}>
              {t("ai.save")}
            </button>
            {isUser && (
              <button type="button" class="send-btn" disabled={!draft.trim()} onClick={() => save(true)}>
                {t("ai.saveResend")}
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          {(message.content || streaming) && (
            <div class={`ai-msg-body${isUser ? "" : " md-body"}`}>
              {isUser ? message.content : <MarkdownView text={message.content} />}
              {streaming && <span class="ai-caret" role="status" aria-label={t("ai.generating")} />}
            </div>
          )}

          {message.stopped && <p class="ai-msg-note">{t("ai.stopped")}</p>}
          {message.error && (
            <p class="ai-msg-note ai-msg-note--error" role="alert">
              <span>
                {t("ai.errGenerate")} {message.error}
              </span>
              <button type="button" class="ai-msg-retry" onClick={() => onRegenerate(message.id)}>
                {t("ai.retry")}
              </button>
            </p>
          )}
          {message.editedAt !== undefined && <p class="ai-msg-note">{t("ai.edited")}</p>}

          {!streaming && (
            <div class="ai-msg-actions" role="group" aria-label={t("ai.messageActions")}>
              <button
                type="button"
                class="ai-msg-action"
                title={copied ? t("ai.copied") : t("ai.copy")}
                aria-label={copied ? t("ai.copied") : t("ai.copy")}
                onClick={copy}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </button>
              <button
                type="button"
                class="ai-msg-action"
                title={t("ai.edit")}
                aria-label={t("ai.edit")}
                onClick={beginEdit}
              >
                <Pencil size={14} />
              </button>
              {!isUser && (
                <button
                  type="button"
                  class="ai-msg-action"
                  title={t("ai.regenerate")}
                  aria-label={t("ai.regenerate")}
                  onClick={() => onRegenerate(message.id)}
                >
                  <RefreshCw size={14} />
                </button>
              )}
              <button
                type="button"
                class="ai-msg-action ai-msg-action--danger"
                title={t("ai.delete")}
                aria-label={t("ai.delete")}
                onClick={() => onRequestDelete(message.id)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          )}
        </>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

export function AiChat(props: { onOpenSidebar: () => void }) {
  const { onOpenSidebar } = props;
  const t = useT();
  const { locale } = useLocale();
  const chat = useAiChat();
  const { config } = useLlmConfig();
  const { active } = chat;

  const [draft, setDraft] = useState("");
  const [historyOpen, setHistoryOpen] = useState(() => !isNarrow());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pendingDeleteMessage, setPendingDeleteMessage] = useState<string | null>(null);
  const [pendingDeleteConversation, setPendingDeleteConversation] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  // Follow the stream only while the reader is already at the bottom, so
  // scrolling up to re-read an earlier reply isn't fought by every token.
  const stickRef = useRef(true);

  const last = active.messages[active.messages.length - 1];
  const lastLength = last ? last.content.length : 0;

  // A different conversation always opens at the bottom.
  useEffect(() => {
    stickRef.current = true;
  }, [active.id]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [active.id, active.messages.length, lastLength]);

  // Autosize the composer to its content (capped by CSS max-height).
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  function onScroll() {
    const el = scrollRef.current;
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  const streaming = chat.streamingMessageId !== null;
  const hasProvider = config.providers.some((p) => p.enabled !== false);

  function submit() {
    // Enter while a reply is streaming must not drop the draft: send() is a
    // no-op then, so leave the text where it is for after Stop.
    if (streaming || !draft.trim()) return;
    void chat.send(draft);
    setDraft("");
    stickRef.current = true;
  }

  function onSubmit(e: JSX.TargetedEvent<HTMLFormElement>) {
    e.preventDefault();
    submit();
  }

  function selectConversation(id: string) {
    void chat.selectConversation(id);
    if (isNarrow()) setHistoryOpen(false);
  }

  function newConversation() {
    chat.newConversation();
    if (isNarrow()) setHistoryOpen(false);
    inputRef.current?.focus();
  }

  const errorText =
    chat.error === "load"
      ? t("ai.errLoad")
      : chat.error === "save"
        ? t("ai.errSave")
        : chat.error === "config"
          ? t("ai.errConfig")
          : chat.error === "generate"
            ? t("ai.errGenerate")
            : null;

  const showDetail = (chat.error === "generate" || chat.error === "config") && chat.errorDetail;

  return (
    <div class="room-content ai-chat">
      <header class="ai-header">
        <button
          type="button"
          class="room-tabs-menu"
          aria-label={t("chat.openMenu")}
          onClick={onOpenSidebar}
        >
          <Menu size={22} />
        </button>
        <span class="ai-header-mark">
          <Sparkles size={18} />
        </span>
        <span class="ai-header-text">
          <span class="ai-title">{active.title || t("ai.newChatTitle")}</span>
          <span class="ai-subtitle">{t("ai.subtitle")}</span>
        </span>
        {active.temporary && (
          <span class="ai-badge">
            <Ghost size={12} aria-hidden="true" /> {t("ai.temporaryBadge")}
          </span>
        )}
        <span class="ai-header-actions">
          <button
            type="button"
            class="icon-btn ai-header-btn"
            title={historyOpen ? t("ai.historyClose") : t("ai.history")}
            aria-label={historyOpen ? t("ai.historyClose") : t("ai.history")}
            aria-pressed={historyOpen}
            onClick={() => setHistoryOpen((v) => !v)}
          >
            <History size={18} />
          </button>
          <button
            type="button"
            class="icon-btn ai-header-btn"
            title={t("ai.newChat")}
            aria-label={t("ai.newChat")}
            onClick={newConversation}
          >
            <SquarePen size={18} />
          </button>
          <button
            type="button"
            class="icon-btn ai-header-btn"
            title={active.temporary ? t("ai.temporaryOff") : t("ai.temporaryOn")}
            aria-label={active.temporary ? t("ai.temporaryOff") : t("ai.temporaryOn")}
            aria-pressed={!!active.temporary}
            onClick={() => chat.setTemporary(!active.temporary)}
          >
            <Ghost size={18} />
          </button>
          <button
            type="button"
            class="icon-btn ai-header-btn"
            title={t("ai.settings")}
            aria-label={t("ai.settings")}
            onClick={() => setSettingsOpen(true)}
          >
            <Settings size={18} />
          </button>
        </span>
      </header>

      <div class="ai-body">
        {historyOpen && (
          <>
            <button
              type="button"
              class="ai-history-backdrop"
              tabIndex={-1}
              aria-label={t("ai.historyClose")}
              onClick={() => setHistoryOpen(false)}
            />
            <nav class="ai-history" aria-label={t("ai.historyList")}>
              <div class="ai-history-head">
                <span>{t("ai.history")}</span>
                <button
                  type="button"
                  class="ai-history-btn"
                  title={t("ai.historyClose")}
                  aria-label={t("ai.historyClose")}
                  onClick={() => setHistoryOpen(false)}
                >
                  <X size={14} />
                </button>
              </div>
              {chat.conversations.length === 0 ? (
                <p class="ai-history-empty">{t("ai.historyEmpty")}</p>
              ) : (
                <ul class="ai-history-list">
                  {chat.conversations.map((c) => (
                    <HistoryRow
                      key={c.id}
                      summary={c}
                      active={c.id === active.id}
                      locale={locale}
                      onSelect={selectConversation}
                      onRename={(id, title) => void chat.renameConversation(id, title)}
                      onRequestDelete={setPendingDeleteConversation}
                    />
                  ))}
                </ul>
              )}
            </nav>
          </>
        )}

        <div class="ai-main">
          {errorText && (
            <div class="ai-error" role="alert">
              <span class="ai-error-text">
                {errorText}
                {showDetail && <span class="ai-error-detail">{chat.errorDetail}</span>}
              </span>
              {chat.error === "config" && (
                <button type="button" class="ai-error-link" onClick={() => setSettingsOpen(true)}>
                  {t("ai.openSettings")}
                </button>
              )}
              <button
                type="button"
                class="ai-error-close"
                aria-label={t("ai.dismiss")}
                title={t("ai.dismiss")}
                onClick={chat.dismissError}
              >
                <X size={14} />
              </button>
            </div>
          )}

          <div class="ai-scroll" ref={scrollRef} onScroll={onScroll}>
            {active.messages.length === 0 ? (
              <div class="ai-empty">
                <span class="ai-empty-mark">{active.temporary ? <Ghost size={22} /> : <Sparkles size={22} />}</span>
                {hasProvider ? (
                  <>
                    <p class="ai-empty-title">{t("ai.emptyTitle")}</p>
                    <p class="ai-empty-body">
                      {active.temporary ? t("ai.emptyTemporary") : t("ai.emptyBody")}
                    </p>
                  </>
                ) : (
                  <>
                    <p class="ai-empty-title">{t("ai.noProviderTitle")}</p>
                    <p class="ai-empty-body">{t("ai.noProviderBody")}</p>
                    <button type="button" class="send-btn" onClick={() => setSettingsOpen(true)}>
                      <Settings size={15} /> {t("ai.openSettings")}
                    </button>
                  </>
                )}
              </div>
            ) : (
              <div class="ai-thread">
                {active.messages.map((m) => (
                  <MessageItem
                    key={m.id}
                    message={m}
                    streaming={m.id === chat.streamingMessageId}
                    onEdit={(id, content, opts) =>
                      void (opts ? chat.editMessage(id, content, opts) : chat.editMessage(id, content))
                    }
                    onRegenerate={(id) => void chat.regenerate(id)}
                    onRequestDelete={setPendingDeleteMessage}
                  />
                ))}
              </div>
            )}
          </div>

          <form class="ai-composer" onSubmit={onSubmit}>
            <div class="ai-composer-box">
              <textarea
                ref={inputRef}
                class="ai-input"
                rows={1}
                value={draft}
                placeholder={t("ai.placeholder")}
                aria-label={t("ai.placeholder")}
                onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
                onKeyDown={(e) => {
                  // IME composition (e.g. Japanese kana->kanji) commits via
                  // Enter — that keystroke must not also send the message.
                  if (e.isComposing || e.keyCode === 229) return;
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
              />
              {/* .mistai-surface scopes mistai's picker styles + font to this
                  row; its menus portal to <body> and bring their own scope. */}
              <div class="ai-toolbar mistai-surface">
                <ModelPicker
                  providers={config.providers}
                  value={chat.model}
                  inheritedValue={config.defaultModel}
                  recent={chat.recentModels}
                  label={t("ai.model")}
                  // Shown as "<clearLabel> · <model>" while the conversation
                  // follows the shared default model rather than its own pick.
                  clearLabel={t("ai.modelDefault")}
                  onChange={chat.setModel}
                />
                <label class="ai-effort">
                  <span>{t("ai.effort")}</span>
                  <select
                    class="ai-effort-select"
                    value={chat.effort}
                    aria-label={t("ai.effort")}
                    onChange={(e) => {
                      const value = (e.target as HTMLSelectElement).value;
                      if (isAiEffort(value)) chat.setEffort(value);
                    }}
                  >
                    {AI_EFFORTS.map((effort) => (
                      <option key={effort} value={effort}>
                        {effortLabel(t, effort)}
                      </option>
                    ))}
                  </select>
                </label>
                <span class="ai-toolbar-spacer" />
                {streaming ? (
                  <button type="button" class="ai-stop" onClick={chat.stop}>
                    <Square size={13} /> {t("ai.stop")}
                  </button>
                ) : (
                  <button type="submit" class="send-btn ai-send" disabled={!draft.trim()}>
                    <Send size={15} /> {t("ai.send")}
                  </button>
                )}
              </div>
            </div>
          </form>
        </div>
      </div>

      {pendingDeleteMessage && (
        <ConfirmDialog
          title={t("ai.deleteMessageTitle")}
          message={t("ai.deleteMessageBody")}
          confirmLabel={t("ai.delete")}
          cancelLabel={t("ai.cancel")}
          tone="danger"
          onConfirm={() => {
            void chat.deleteMessage(pendingDeleteMessage);
            setPendingDeleteMessage(null);
          }}
          onCancel={() => setPendingDeleteMessage(null)}
        />
      )}

      {pendingDeleteConversation && (
        <ConfirmDialog
          title={t("ai.deleteConfirmTitle")}
          message={t("ai.deleteConfirmBody")}
          confirmLabel={t("ai.delete")}
          cancelLabel={t("ai.cancel")}
          tone="danger"
          onConfirm={() => {
            void chat.deleteConversation(pendingDeleteConversation);
            setPendingDeleteConversation(null);
          }}
          onCancel={() => setPendingDeleteConversation(null)}
        />
      )}

      {/* LlmSettings draws its own overlay (a fixed .mistai-settings-layer,
          raised above tc-chat's drawers in aiChat.css) when given onClose. */}
      {settingsOpen && (
        <LlmSettings
          tasks={[
            {
              id: AI_CHAT_TASK_ID,
              label: t("ai.taskChat"),
              tip: t("ai.taskChatTip"),
              reasoning: true,
            },
          ]}
          localSettings={aiLocalSettingsAdapter}
          locale={settingsLocale(locale)}
          title={t("ai.settings")}
          initialTab="connection"
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
