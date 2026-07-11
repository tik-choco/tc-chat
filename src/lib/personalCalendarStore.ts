// Local-only persistence for the personal calendar — unlike the room
// calendar (see chatStore.ts's "calendar" surface), these events are never
// broadcast to any room's swarm; they exist purely in this device's
// localStorage and are invisible to anyone else.
import { newId } from "./util";

export interface PersonalEvent {
  id: string;
  title: string;
  startsAt: number;
  endsAt?: number;
  notes?: string;
  createdAt: number;
}

const PERSONAL_EVENTS_KEY = "tc-chat:personal-events";

export function loadPersonalEvents(): PersonalEvent[] {
  try {
    const raw = localStorage.getItem(PERSONAL_EVENTS_KEY);
    return raw ? (JSON.parse(raw) as PersonalEvent[]) : [];
  } catch {
    return [];
  }
}

function savePersonalEvents(events: PersonalEvent[]): void {
  localStorage.setItem(PERSONAL_EVENTS_KEY, JSON.stringify(events));
}

export function addPersonalEvent(input: Omit<PersonalEvent, "id" | "createdAt">): PersonalEvent[] {
  const events = loadPersonalEvents();
  const next = [...events, { ...input, id: newId(), createdAt: Date.now() }];
  savePersonalEvents(next);
  return next;
}

export function updatePersonalEvent(
  id: string,
  patch: Partial<Omit<PersonalEvent, "id" | "createdAt">>,
): PersonalEvent[] {
  const events = loadPersonalEvents();
  const next = events.map((e) => (e.id === id ? { ...e, ...patch } : e));
  savePersonalEvents(next);
  return next;
}

export function removePersonalEvent(id: string): PersonalEvent[] {
  const next = loadPersonalEvents().filter((e) => e.id !== id);
  savePersonalEvents(next);
  return next;
}
