// Mirrors every console.* call — ours and mistlib-wasm's own tracing output,
// which is written straight to console.* — into an in-memory ring buffer so
// the in-app developer console (see DevConsole.tsx) can show detailed logs
// in real time without needing devtools open.

export type DevLogLevel = "log" | "info" | "warn" | "error" | "debug";

export interface DevLogEntry {
  id: number;
  ts: number;
  level: DevLogLevel;
  text: string;
}

const MAX_ENTRIES = 500;
const LEVELS: DevLogLevel[] = ["log", "info", "warn", "error", "debug"];

const buffer: DevLogEntry[] = [];
const listeners = new Set<(entry: DevLogEntry) => void>();
let nextId = 0;
let installed = false;

function formatArg(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.stack ?? value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function push(level: DevLogLevel, args: unknown[]) {
  const entry: DevLogEntry = { id: nextId++, ts: Date.now(), level, text: args.map(formatArg).join(" ") };
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) buffer.shift();
  listeners.forEach((l) => l(entry));
}

/**
 * Patches the global console methods to also capture into the ring buffer.
 * Idempotent (safe to import/call from multiple places) and cheap enough to
 * run for the whole session — the developer-mode setting only gates whether
 * the panel is shown, not whether capturing happens, so turning it on shows
 * recent history immediately instead of just logs from that point onward.
 */
export function installDevLogCapture() {
  if (installed || typeof console === "undefined") return;
  installed = true;
  for (const level of LEVELS) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      push(level, args);
    };
  }
}

export function getDevLogSnapshot(): DevLogEntry[] {
  return buffer.slice();
}

/** Returns an unsubscribe function. */
export function subscribeDevLog(listener: (entry: DevLogEntry) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function clearDevLog() {
  buffer.length = 0;
}

installDevLogCapture();
