import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Check, ChevronDown, ChevronUp, Copy, Search, Terminal, Trash2, X } from "lucide-preact";
import {
  clearDevLog,
  getDevLogSnapshot,
  subscribeDevLog,
  type DevLogEntry,
  type DevLogLevel,
} from "../lib/devLog";
import { useT } from "../lib/i18n";

const LEVELS: DevLogLevel[] = ["log", "info", "warn", "error", "debug"];

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

/**
 * Developer-mode live log panel: mirrors devLog's ring buffer (console.* calls
 * from the app AND from mistlib-wasm's own tracing output, which goes straight
 * to console.*) in real time. Toggled from Settings; see useDevMode wiring in
 * app.tsx.
 */
export function DevConsole(props: { onClose: () => void }) {
  const t = useT();
  const [entries, setEntries] = useState<DevLogEntry[]>(() => getDevLogSnapshot());
  const [collapsed, setCollapsed] = useState(false);
  const [search, setSearch] = useState("");
  const [activeLevels, setActiveLevels] = useState<Set<DevLogLevel>>(() => new Set(LEVELS));
  const [pinnedToBottom, setPinnedToBottom] = useState(true);
  const [copied, setCopied] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => subscribeDevLog((entry) => setEntries((prev) => [...prev, entry].slice(-500))), []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => activeLevels.has(e.level) && (!q || e.text.toLowerCase().includes(q)));
  }, [entries, activeLevels, search]);

  useEffect(() => {
    if (!pinnedToBottom || collapsed) return;
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [filtered, pinnedToBottom, collapsed]);

  function handleScroll() {
    const body = bodyRef.current;
    if (!body) return;
    const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 24;
    setPinnedToBottom(atBottom);
  }

  function toggleLevel(level: DevLogLevel) {
    setActiveLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  }

  async function copyAll() {
    const text = filtered.map((e) => `[${formatTime(e.ts)}] ${e.level.toUpperCase()} ${e.text}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access denied/unavailable — nothing more we can do here.
    }
  }

  return (
    <div class={`dev-console ${collapsed ? "dev-console--collapsed" : ""}`}>
      <header class="dev-console-header">
        <Terminal size={15} />
        <span class="dev-console-title">{t("devConsole.title")}</span>
        <span class="dev-console-count">{filtered.length}</span>
        <div class="dev-console-header-spacer" />
        <button
          type="button"
          class="dev-console-btn"
          title={copied ? t("common.copied") : t("devConsole.copyAll")}
          aria-label={t("devConsole.copyAll")}
          onClick={copyAll}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
        <button
          type="button"
          class="dev-console-btn"
          title={t("devConsole.clear")}
          aria-label={t("devConsole.clear")}
          onClick={() => {
            clearDevLog();
            setEntries([]);
          }}
        >
          <Trash2 size={14} />
        </button>
        <button
          type="button"
          class="dev-console-btn"
          title={collapsed ? t("devConsole.expand") : t("devConsole.collapse")}
          aria-label={collapsed ? t("devConsole.expand") : t("devConsole.collapse")}
          onClick={() => setCollapsed((c) => !c)}
        >
          {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        <button
          type="button"
          class="dev-console-btn"
          title={t("common.close")}
          aria-label={t("common.close")}
          onClick={props.onClose}
        >
          <X size={14} />
        </button>
      </header>

      {!collapsed && (
        <>
          <div class="dev-console-toolbar">
            <div class="dev-console-search">
              <Search size={13} />
              <input
                type="text"
                value={search}
                placeholder={t("devConsole.searchPlaceholder")}
                onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
              />
            </div>
            <div class="dev-console-levels">
              {LEVELS.map((level) => (
                <button
                  key={level}
                  type="button"
                  class={`dev-console-level dev-console-level--${level} ${
                    activeLevels.has(level) ? "dev-console-level--active" : ""
                  }`}
                  aria-pressed={activeLevels.has(level)}
                  onClick={() => toggleLevel(level)}
                >
                  {level.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div class="dev-console-body" ref={bodyRef} onScroll={handleScroll}>
            {filtered.length === 0 ? (
              <div class="dev-console-empty">{t("devConsole.empty")}</div>
            ) : (
              filtered.map((e) => (
                <div key={e.id} class={`dev-console-line dev-console-line--${e.level}`}>
                  <span class="dev-console-line-time">{formatTime(e.ts)}</span>
                  <span class="dev-console-line-level">{e.level.toUpperCase()}</span>
                  <span class="dev-console-line-text">{e.text}</span>
                </div>
              ))
            )}
          </div>

          {!pinnedToBottom && (
            <button
              type="button"
              class="dev-console-jump"
              onClick={() => {
                setPinnedToBottom(true);
                const body = bodyRef.current;
                if (body) body.scrollTop = body.scrollHeight;
              }}
            >
              {t("devConsole.newLogs")} ↓
            </button>
          )}
        </>
      )}
    </div>
  );
}
