import { describe, it, expect, beforeEach } from "vitest";
import {
  addPersonalEvent,
  loadPersonalEvents,
  removePersonalEvent,
  updatePersonalEvent,
} from "./personalCalendarStore";

describe("personalCalendarStore", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("adds an event with a generated id and createdAt", () => {
    addPersonalEvent({ title: "Dentist", startsAt: 1000 });
    const events = loadPersonalEvents();
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe("Dentist");
    expect(events[0].startsAt).toBe(1000);
    expect(typeof events[0].id).toBe("string");
    expect(typeof events[0].createdAt).toBe("number");
  });

  it("updates an event by id, leaving others untouched", () => {
    addPersonalEvent({ title: "Dentist", startsAt: 1000 });
    addPersonalEvent({ title: "Gym", startsAt: 2000 });
    const [first] = loadPersonalEvents();
    updatePersonalEvent(first.id, { title: "Dentist (rescheduled)", startsAt: 1500 });

    const events = loadPersonalEvents();
    expect(events.find((e) => e.id === first.id)?.title).toBe("Dentist (rescheduled)");
    expect(events.find((e) => e.id === first.id)?.startsAt).toBe(1500);
    expect(events.find((e) => e.title === "Gym")?.startsAt).toBe(2000);
  });

  it("removes an event by id", () => {
    addPersonalEvent({ title: "Dentist", startsAt: 1000 });
    const [event] = loadPersonalEvents();
    removePersonalEvent(event.id);
    expect(loadPersonalEvents()).toHaveLength(0);
  });
});
