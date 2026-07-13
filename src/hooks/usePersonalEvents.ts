import { useEffect, useState } from "preact/hooks";
import { getNode } from "../lib/mistClient";
import {
  addPersonalEvent,
  loadPersonalEvents,
  removePersonalEvent,
  updatePersonalEvent,
  type PersonalEvent,
} from "../lib/personalCalendarStore";

export function usePersonalEvents() {
  const [events, setEvents] = useState<PersonalEvent[]>([]);

  // Personal events live in mistlib's OPFS KV store, which needs the wasm
  // runtime initialized first (see getNode()) — so, unlike the old
  // localStorage-backed version, the initial load is async.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await getNode();
      } catch {
        // Fall through and try the KV read anyway; it'll just fail below.
      }
      const loaded = await loadPersonalEvents();
      if (!cancelled) setEvents(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function addEvent(input: Omit<PersonalEvent, "id" | "createdAt">) {
    setEvents(await addPersonalEvent(input));
  }

  async function editEvent(id: string, patch: Partial<Omit<PersonalEvent, "id" | "createdAt">>) {
    setEvents(await updatePersonalEvent(id, patch));
  }

  async function removeEvent(id: string) {
    setEvents(await removePersonalEvent(id));
  }

  return { events, addEvent, editEvent, removeEvent };
}
