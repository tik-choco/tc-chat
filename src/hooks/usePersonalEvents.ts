import { useState } from "preact/hooks";
import {
  addPersonalEvent,
  loadPersonalEvents,
  removePersonalEvent,
  updatePersonalEvent,
  type PersonalEvent,
} from "../lib/personalCalendarStore";

export function usePersonalEvents() {
  const [events, setEvents] = useState<PersonalEvent[]>(() => loadPersonalEvents());

  function addEvent(input: Omit<PersonalEvent, "id" | "createdAt">) {
    setEvents(addPersonalEvent(input));
  }

  function editEvent(id: string, patch: Partial<Omit<PersonalEvent, "id" | "createdAt">>) {
    setEvents(updatePersonalEvent(id, patch));
  }

  function removeEvent(id: string) {
    setEvents(removePersonalEvent(id));
  }

  return { events, addEvent, editEvent, removeEvent };
}
