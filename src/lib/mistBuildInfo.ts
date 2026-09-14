import * as engine from '@tik-choco/mistlib';

declare const __MISTLIB_SOURCE__: 'local' | 'registry';
export type BuildInfo = { version: string; commit: string; dirty: boolean; profile: string; target: string };
export type BuildSnapshot = {
  source: 'local' | 'registry' | 'unknown';
  state: 'waiting' | 'reported' | 'unverified' | 'load-error';
  info: BuildInfo | null;
};
let snapshot: BuildSnapshot = {
  source: typeof __MISTLIB_SOURCE__ === 'undefined' ? 'unknown' : __MISTLIB_SOURCE__,
  state: 'waiting', info: null,
};
const listeners = new Set<() => void>();
export const getMistBuildSnapshot = () => snapshot;
export function subscribeMistBuild(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function publish(state: BuildSnapshot['state'], info: BuildInfo | null = null) {
  snapshot = { ...snapshot, state, info };
  listeners.forEach(listener => listener());
}

// Whitelist fields: never copy arbitrary diagnostics, paths or errors to the UI.
export function parseBuildInfo(raw: unknown): BuildInfo | null {
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!value || typeof value !== 'object') return null;
    const fields = ['version', 'commit', 'profile', 'target'] as const;
    if (fields.some(key => typeof value[key] !== 'string' || !/^[a-zA-Z0-9.+_-]{1,128}$/.test(value[key]))) return null;
    if (typeof value.dirty !== 'boolean') return null;
    return { version: value.version, commit: value.commit, dirty: value.dirty, profile: value.profile, target: value.target };
  } catch { return null; }
}

// Called only after the app's existing node initialized this same engine module.
// A runtime report is not an artifact-integrity verification.
export function captureMistBuildInfo() {
  try {
    const api = engine as unknown as Record<string, unknown>;
    const getInfo = api['get_build_info'];
    const info = typeof getInfo === 'function' ? parseBuildInfo(getInfo()) : null;
    publish(info ? 'reported' : 'unverified', info);
  } catch { publish('unverified'); }
}
export const markMistLoadError = () => publish('load-error');
