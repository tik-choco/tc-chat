import { describe, it, expect, beforeEach, vi } from "vitest";

const kvStore = new Map<string, Uint8Array>();

vi.mock("./mistClient", () => ({
  storage_kv_set: vi.fn(async (key: string, data: Uint8Array) => {
    kvStore.set(key, data);
  }),
  storage_kv_get: vi.fn(async (key: string) => kvStore.get(key)),
}));

import {
  addPersonalEvent,
  loadPersonalEvents,
  removePersonalEvent,
  updatePersonalEvent,
} from "./personalCalendarStore";

const LEGACY_KEY = "tc-chat:personal-events";

describe("personalCalendarStore", () => {
  beforeEach(() => {
    localStorage.clear();
    kvStore.clear();
  });

  it("adds an event with a generated id and createdAt", async () => {
    await addPersonalEvent({ title: "Dentist", startsAt: 1000 });
    const events = await loadPersonalEvents();
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe("Dentist");
    expect(events[0].startsAt).toBe(1000);
    expect(typeof events[0].id).toBe("string");
    expect(typeof events[0].createdAt).toBe("number");
  });

  it("updates an event by id, leaving others untouched", async () => {
    await addPersonalEvent({ title: "Dentist", startsAt: 1000 });
    await addPersonalEvent({ title: "Gym", startsAt: 2000 });
    const [first] = await loadPersonalEvents();
    await updatePersonalEvent(first.id, { title: "Dentist (rescheduled)", startsAt: 1500 });

    const events = await loadPersonalEvents();
    expect(events.find((e) => e.id === first.id)?.title).toBe("Dentist (rescheduled)");
    expect(events.find((e) => e.id === first.id)?.startsAt).toBe(1500);
    expect(events.find((e) => e.title === "Gym")?.startsAt).toBe(2000);
  });

  it("removes an event by id", async () => {
    await addPersonalEvent({ title: "Dentist", startsAt: 1000 });
    const [event] = await loadPersonalEvents();
    await removePersonalEvent(event.id);
    expect(await loadPersonalEvents()).toHaveLength(0);
  });

  it("migrates a legacy localStorage copy into the KV store on first load, then clears it", async () => {
    localStorage.setItem(
      LEGACY_KEY,
      JSON.stringify([{ id: "legacy-1", title: "Legacy", startsAt: 500, createdAt: 100 }]),
    );

    const events = await loadPersonalEvents();

    expect(events).toHaveLength(1);
    expect(events[0].title).toBe("Legacy");
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    expect(kvStore.has(LEGACY_KEY)).toBe(true);
  });

  it("prefers the KV store over a legacy copy once migrated", async () => {
    localStorage.setItem(
      LEGACY_KEY,
      JSON.stringify([{ id: "legacy-1", title: "Legacy", startsAt: 500, createdAt: 100 }]),
    );
    await loadPersonalEvents(); // triggers migration
    await addPersonalEvent({ title: "Fresh", startsAt: 900 });

    const events = await loadPersonalEvents();
    expect(events.map((e) => e.title).sort()).toEqual(["Fresh", "Legacy"]);
  });
});
