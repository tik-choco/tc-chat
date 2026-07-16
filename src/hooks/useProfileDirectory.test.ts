import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/preact";
import { useProfileDirectory } from "./useProfileDirectory";
import {
  createDidIdentity,
  ensureDidIdentity,
  signStringWithDidIdentity,
} from "../crypto/didIdentity";
import type { Profile } from "../lib/profileStore";

const DIRECTORY_KEY = "tc-chat:profile-directory:v2";

const sendMessage = vi.fn();
let eventListener:
  | ((eventType: number, fromId: string, payload: unknown, evtRoomId?: string) => void)
  | null = null;
const EVENT_PEER_CONNECTED = 5;

vi.mock("../lib/mistClient", () => ({
  getNode: vi.fn(async () => ({ sendMessage })),
  subscribeEvent: vi.fn(
    (listener: (eventType: number, fromId: string, payload: unknown, evtRoomId?: string) => void) => {
      eventListener = listener;
      return () => {
        eventListener = null;
      };
    },
  ),
  isRawEvent: vi.fn((eventType: number) => eventType === 0),
  decodeRawPayload: vi.fn((payload: unknown) => payload),
  EVENT_PEER_CONNECTED: 5,
  DELIVERY_RELIABLE: 1,
}));

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
}

async function createRemotePeer() {
  const identity = await createDidIdentity();
  return {
    did: identity.did,
    sign: (fields: Record<string, unknown>) =>
      signStringWithDidIdentity(identity, stableStringify(fields)),
  };
}

describe("useProfileDirectory", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    eventListener = null;
  });

  async function localProfile(): Promise<Profile> {
    // Sign broadcasts with the app's real local identity so fromId matches.
    const identity = await ensureDidIdentity();
    return { did: identity.did, displayName: "Alice", bio: "", avatar: "cid-avatar", vrm: "" };
  }

  function findAnnounce() {
    return sendMessage.mock.calls.find(
      ([, msg]) => (msg as { type?: string })?.type === "tc-chat:profile",
    );
  }

  it("announces the local profile to the room shortly after joining", async () => {
    const me = await localProfile();
    renderHook(() => useProfileDirectory("r1", me, me.displayName));

    await waitFor(() => expect(findAnnounce()).toBeTruthy());
    const announce = findAnnounce()!;
    expect(announce[0]).toBeNull(); // broadcast
    expect((announce[1] as { fromId: string }).fromId).toBe(me.did);
    expect((announce[1] as { displayName: string }).displayName).toBe("Alice");
  });

  it("adds a correctly signed peer profile to the directory", async () => {
    const me = await localProfile();
    const peer = await createRemotePeer();
    const { result } = renderHook(() => useProfileDirectory("r1", me, me.displayName));

    const unsigned = {
      type: "tc-chat:profile",
      fromId: peer.did,
      displayName: "Bob",
      avatarCid: "cid-bob",
      updatedAt: 1000,
    };
    eventListener?.(0, "peer-transport", { ...unsigned, signature: await peer.sign(unsigned) });

    await waitFor(() => expect(result.current.directory[peer.did]?.displayName).toBe("Bob"));
    expect(result.current.directory[peer.did].avatarCid).toBe("cid-bob");
  });

  it("rejects a forged profile (signed by someone other than the claimed DID)", async () => {
    const me = await localProfile();
    const attacker = await createRemotePeer();
    const victim = await createRemotePeer();
    const { result } = renderHook(() => useProfileDirectory("r1", me, me.displayName));

    const unsigned = {
      type: "tc-chat:profile",
      fromId: victim.did, // claims to be the victim
      displayName: "Hacked",
      avatarCid: "",
      updatedAt: 1000,
    };
    // ...but signed with the attacker's key.
    eventListener?.(0, "peer-transport", { ...unsigned, signature: await attacker.sign(unsigned) });
    // Give the async verification time to run and (correctly) reject it.
    await new Promise((r) => setTimeout(r, 60));

    expect(result.current.directory[victim.did]).toBeUndefined();
  });

  it("re-announces (targeted) to a peer that connects", async () => {
    const me = await localProfile();
    renderHook(() => useProfileDirectory("r1", me, me.displayName));
    await waitFor(() => expect(findAnnounce()).toBeTruthy());
    sendMessage.mockClear();

    eventListener?.(EVENT_PEER_CONNECTED, "new-peer", null);
    await waitFor(() => {
      const targeted = sendMessage.mock.calls.find(([to]) => to === "new-peer");
      expect(targeted).toBeTruthy();
      expect((targeted![1] as { type: string }).type).toBe("tc-chat:profile");
    });
  });

  it("does not leak a profile learned in one room into another room's directory", async () => {
    const me = await localProfile();
    const peer = await createRemotePeer();
    const { result, rerender } = renderHook(
      ({ roomId }: { roomId: string }) => useProfileDirectory(roomId, me, me.displayName),
      { initialProps: { roomId: "r1" } },
    );

    const unsigned = {
      type: "tc-chat:profile",
      fromId: peer.did,
      displayName: "Bob",
      avatarCid: "cid-bob",
      updatedAt: 1000,
    };
    eventListener?.(0, "peer-transport", { ...unsigned, signature: await peer.sign(unsigned) });
    await waitFor(() => expect(result.current.directory[peer.did]?.displayName).toBe("Bob"));

    rerender({ roomId: "r2" });

    expect(result.current.directory[peer.did]).toBeUndefined();
  });

  it("directoryFor still returns a room's learned profiles even while a different room is active", async () => {
    const me = await localProfile();
    const peer = await createRemotePeer();
    const { result, rerender } = renderHook(
      ({ roomId }: { roomId: string }) => useProfileDirectory(roomId, me, me.displayName),
      { initialProps: { roomId: "r1" } },
    );

    const unsigned = {
      type: "tc-chat:profile",
      fromId: peer.did,
      displayName: "Bob",
      avatarCid: "cid-bob",
      updatedAt: 1000,
    };
    eventListener?.(0, "peer-transport", { ...unsigned, signature: await peer.sign(unsigned) });
    await waitFor(() => expect(result.current.directory[peer.did]?.displayName).toBe("Bob"));

    rerender({ roomId: "r2" });

    expect(result.current.directoryFor("r1")[peer.did]?.displayName).toBe("Bob");
  });

  it("self-merges using localDisplayName, not localProfile.displayName, when they differ", async () => {
    const me = await localProfile(); // displayName "Alice"
    const { result } = renderHook(() => useProfileDirectory("r1", me, "RoomNickname"));

    await waitFor(() => expect(result.current.directory[me.did]?.displayName).toBe("RoomNickname"));
  });

  it("persists the room-scoped store under the tc-chat:profile-directory:v2 key", async () => {
    const me = await localProfile();
    renderHook(() => useProfileDirectory("r1", me, me.displayName));

    await waitFor(() => {
      const raw = localStorage.getItem(DIRECTORY_KEY);
      expect(raw).toBeTruthy();
      const store = JSON.parse(raw!) as Record<string, Record<string, unknown>>;
      expect(store.r1?.[me.did]).toBeTruthy();
    });
    // Old flat v1 key must be left untouched (not migrated, not written to).
    expect(localStorage.getItem("tc-chat:profile-directory:v1")).toBeNull();
  });
});
