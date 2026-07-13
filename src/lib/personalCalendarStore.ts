// Local-only persistence for the personal calendar — unlike the room
// calendar (see chatStore.ts's "calendar" surface), these events are never
// broadcast to any room's swarm; they exist purely on this device and are
// invisible to anyone else.
//
// This is unbounded, ever-growing user content (free-text notes, no natural
// cap to enforce), so it's backed by mistlib's OPFS KV (storage_kv_set/
// storage_kv_get) rather than localStorage — see mistClient.ts. Earlier
// versions of the app kept this same data at the same key in localStorage;
// migrateLegacy() moves it into the KV store once, on first load after
// upgrading, and only clears the old copy once the move has actually landed.
import { newId } from "./util";
import { storage_kv_set, storage_kv_get } from "./mistClient";

export interface PersonalEvent {
  id: string;
  title: string;
  startsAt: number;
  endsAt?: number;
  notes?: string;
  createdAt: number;
}

const KEY = "tc-chat:personal-events";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function loadLegacy(): PersonalEvent[] | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PersonalEvent[]) : null;
  } catch {
    return null;
  }
}

async function readKv(): Promise<PersonalEvent[] | null> {
  try {
    const bytes = await storage_kv_get(KEY);
    if (!bytes) return null;
    return JSON.parse(decoder.decode(bytes)) as PersonalEvent[];
  } catch {
    return null;
  }
}

/**
 * One-time migration: if the KV store has nothing yet but a legacy
 * localStorage copy exists, move it over. The old key is only removed after
 * the KV write succeeds, so a failed migration (e.g. mistlib not ready yet)
 * leaves the legacy data intact for the next attempt instead of losing it.
 */
async function migrateLegacy(): Promise<PersonalEvent[] | null> {
  const legacy = loadLegacy();
  if (!legacy) return null;
  try {
    await storage_kv_set(KEY, encoder.encode(JSON.stringify(legacy)));
    localStorage.removeItem(KEY);
  } catch (error) {
    console.warn("tc-chat: failed to migrate personal events to OPFS storage", error);
  }
  return legacy;
}

export async function loadPersonalEvents(): Promise<PersonalEvent[]> {
  const fromKv = await readKv();
  if (fromKv) return fromKv;
  return (await migrateLegacy()) ?? [];
}

async function savePersonalEvents(events: PersonalEvent[]): Promise<void> {
  try {
    await storage_kv_set(KEY, encoder.encode(JSON.stringify(events)));
  } catch (error) {
    console.warn("tc-chat: failed to persist personal events", error);
  }
}

export async function addPersonalEvent(
  input: Omit<PersonalEvent, "id" | "createdAt">,
): Promise<PersonalEvent[]> {
  const events = await loadPersonalEvents();
  const next = [...events, { ...input, id: newId(), createdAt: Date.now() }];
  await savePersonalEvents(next);
  return next;
}

export async function updatePersonalEvent(
  id: string,
  patch: Partial<Omit<PersonalEvent, "id" | "createdAt">>,
): Promise<PersonalEvent[]> {
  const events = await loadPersonalEvents();
  const next = events.map((e) => (e.id === id ? { ...e, ...patch } : e));
  await savePersonalEvents(next);
  return next;
}

export async function removePersonalEvent(id: string): Promise<PersonalEvent[]> {
  const next = (await loadPersonalEvents()).filter((e) => e.id !== id);
  await savePersonalEvents(next);
  return next;
}
