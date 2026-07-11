import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/preact";
import { useMessageAlerts } from "./useMessageAlerts";
import {
  createDidIdentity,
  ensureDidIdentity,
  signStringWithDidIdentity,
} from "../crypto/didIdentity";
import { appendPost, loadPosts, loadWireLog } from "../lib/chatStore";
import type { Friend } from "../lib/friendsStore";

type EventListener = (
  eventType: number,
  fromId: string,
  payload: unknown,
  roomId?: string,
) => void;

const sendMessage = vi.fn();
const joinRoomAsync = vi.fn(async () => {});
let eventListener: EventListener | null = null;

vi.mock("../lib/mistClient", () => ({
  getNode: vi.fn(async () => ({ sendMessage, joinRoomAsync })),
  subscribeEvent: vi.fn((listener: EventListener) => {
    eventListener = listener;
    return () => {
      eventListener = null;
    };
  }),
  isRawEvent: vi.fn((eventType: number) => eventType === 0),
  decodeRawPayload: vi.fn((payload: unknown) => payload),
  storage_get: vi.fn(async () =>
    new TextEncoder().encode(JSON.stringify({ text: "hello there" })),
  ),
  EVENT_PEER_CONNECTED: 5,
  DELIVERY_RELIABLE: 1,
}));

// Minimal Notification stand-in — jsdom has none. Instances are collected so
// tests can assert on what would have been shown.
class FakeNotification {
  static permission: NotificationPermission = "granted";
  static instances: FakeNotification[] = [];
  static requestPermission = vi.fn(async () => FakeNotification.permission);
  onclick: (() => void) | null = null;
  close = vi.fn();
  title: string;
  options?: { body?: string; tag?: string };
  constructor(title: string, options?: { body?: string; tag?: string }) {
    this.title = title;
    this.options = options;
    FakeNotification.instances.push(this);
  }
}

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

async function signedChatPost(
  peer: Awaited<ReturnType<typeof createRemotePeer>>,
  overrides: Record<string, unknown> = {},
) {
  const unsigned = {
    type: "tc-chat:post",
    surface: "chat",
    id: `post-${Math.random().toString(36).slice(2)}`,
    parentId: null,
    fromId: peer.did,
    fromName: "Bob",
    timestamp: Date.now(),
    kind: "text",
    cid: "cid-1",
    ...overrides,
  };
  return { ...unsigned, signature: await peer.sign(unsigned) };
}

async function signedDeleteWire(
  peer: Awaited<ReturnType<typeof createRemotePeer>>,
  targetId: string,
  overrides: Record<string, unknown> = {},
) {
  const unsigned = {
    type: "tc-chat:post-delete",
    id: `del-${Math.random().toString(36).slice(2)}`,
    surface: "chat",
    targetId,
    fromId: peer.did,
    fromName: "Bob",
    timestamp: Date.now(),
    ...overrides,
  };
  return { ...unsigned, signature: await peer.sign(unsigned) };
}

async function signedEditWire(
  peer: Awaited<ReturnType<typeof createRemotePeer>>,
  targetId: string,
  overrides: Record<string, unknown> = {},
) {
  const unsigned = {
    type: "tc-chat:post-edit",
    id: `edit-${Math.random().toString(36).slice(2)}`,
    surface: "chat",
    targetId,
    cid: "cid-1",
    fromId: peer.did,
    fromName: "Bob",
    timestamp: Date.now(),
    ...overrides,
  };
  return { ...unsigned, signature: await peer.sign(unsigned) };
}

/** Stores a background chat post directly (bypassing the wire path) so a
 * delete/edit test has something to target. */
function seedPost(roomId: string, fromId: string, overrides: Record<string, unknown> = {}) {
  const id = `seed-${Math.random().toString(36).slice(2)}`;
  appendPost({
    id,
    roomId,
    surface: "chat",
    parentId: null,
    fromId,
    fromName: "Bob",
    timestamp: Date.now(),
    kind: "text",
    cid: "cid-1",
    text: "original",
    reactions: [],
    ...overrides,
  });
  return id;
}

describe("useMessageAlerts", () => {
  let selfDid: string;

  beforeEach(async () => {
    localStorage.clear();
    vi.clearAllMocks();
    eventListener = null;
    FakeNotification.instances = [];
    FakeNotification.permission = "granted";
    vi.stubGlobal("Notification", FakeNotification);
    const identity = await ensureDidIdentity();
    selfDid = identity.did;
  });

  function friendFixture(did: string): Friend {
    return { did, name: "Bob", addedAt: 1, roomId: "dm-1", status: "accepted" };
  }

  it("counts a verified message from a non-active room as unread", async () => {
    const peer = await createRemotePeer();
    const { result } = renderHook(() => useMessageAlerts("room-a", selfDid, []));

    const wire = await signedChatPost(peer);
    await act(async () => {
      eventListener?.(0, "transport", wire, "room-b");
    });

    await waitFor(() => expect(result.current.unread["room-b"]).toBe(1));
  });

  it("ignores messages in the active room while the tab is visible", async () => {
    const peer = await createRemotePeer();
    const { result } = renderHook(() => useMessageAlerts("room-a", selfDid, []));

    const wire = await signedChatPost(peer);
    await act(async () => {
      eventListener?.(0, "transport", wire, "room-a");
      await new Promise((r) => setTimeout(r, 30));
    });

    expect(result.current.unread["room-a"]).toBeUndefined();
  });

  it("ignores our own messages and unsigned/forged wires", async () => {
    const peer = await createRemotePeer();
    const attacker = await createRemotePeer();
    const { result } = renderHook(() => useMessageAlerts("room-a", selfDid, []));

    const own = await signedChatPost(peer, { fromId: selfDid });
    const forgedUnsigned = {
      type: "tc-chat:post",
      surface: "chat",
      id: "forged",
      parentId: null,
      fromId: peer.did,
      fromName: "Bob",
      timestamp: Date.now(),
      kind: "text",
      cid: "cid-1",
    };
    const forged = { ...forgedUnsigned, signature: await attacker.sign(forgedUnsigned) };
    await act(async () => {
      eventListener?.(0, "transport", own, "room-b");
      eventListener?.(0, "transport", forged, "room-b");
      await new Promise((r) => setTimeout(r, 30));
    });

    expect(result.current.unread["room-b"]).toBeUndefined();
  });

  it("counts a duplicate wire only once", async () => {
    const peer = await createRemotePeer();
    const { result } = renderHook(() => useMessageAlerts("room-a", selfDid, []));

    const wire = await signedChatPost(peer);
    await act(async () => {
      eventListener?.(0, "transport", wire, "room-b");
      eventListener?.(0, "transport", wire, "room-b");
    });

    await waitFor(() => expect(result.current.unread["room-b"]).toBe(1));
    await new Promise((r) => setTimeout(r, 30));
    expect(result.current.unread["room-b"]).toBe(1);
  });

  it("persists a background DM message and raises a notification with a text snippet", async () => {
    const peer = await createRemotePeer();
    renderHook(() => useMessageAlerts("room-a", selfDid, [friendFixture(peer.did)]));

    const wire = await signedChatPost(peer);
    await act(async () => {
      eventListener?.(0, "transport", wire, "dm-1");
    });

    await waitFor(() => expect(FakeNotification.instances).toHaveLength(1));
    expect(FakeNotification.instances[0].title).toBe("Bob");
    expect(FakeNotification.instances[0].options?.body).toBe("hello there");
    const stored = loadPosts("chat", "dm-1");
    expect(stored).toContainEqual(
      expect.objectContaining({ id: wire.id, fromId: peer.did, text: "hello there" }),
    );
  });

  it("raises no notification without permission", async () => {
    const peer = await createRemotePeer();
    FakeNotification.permission = "default";
    const { result } = renderHook(() =>
      useMessageAlerts("room-a", selfDid, [friendFixture(peer.did)]),
    );

    const wire = await signedChatPost(peer);
    await act(async () => {
      eventListener?.(0, "transport", wire, "dm-1");
    });

    // The unread badge still counts even though nothing pops up.
    await waitFor(() => expect(result.current.unread["dm-1"]).toBe(1));
    expect(FakeNotification.instances).toHaveLength(0);
  });

  it("clears a room's unread count when it becomes the active room", async () => {
    const peer = await createRemotePeer();
    const { result, rerender } = renderHook(
      ({ active }: { active: string }) => useMessageAlerts(active, selfDid, []),
      { initialProps: { active: "room-a" } },
    );

    const wire = await signedChatPost(peer);
    await act(async () => {
      eventListener?.(0, "transport", wire, "room-b");
    });
    await waitFor(() => expect(result.current.unread["room-b"]).toBe(1));

    rerender({ active: "room-b" });
    await waitFor(() => expect(result.current.unread["room-b"]).toBeUndefined());
  });

  it("tombstones a post and logs the wire when a background-room delete arrives", async () => {
    const peer = await createRemotePeer();
    const targetId = seedPost("dm-1", peer.did);
    renderHook(() => useMessageAlerts("room-a", selfDid, [friendFixture(peer.did)]));

    const wire = await signedDeleteWire(peer, targetId);
    await act(async () => {
      eventListener?.(0, "transport", wire, "dm-1");
    });

    await waitFor(() => {
      const stored = loadPosts("chat", "dm-1").find((p) => p.id === targetId);
      expect(stored?.deleted).toBe(true);
    });
    const stored = loadPosts("chat", "dm-1").find((p) => p.id === targetId);
    expect(stored?.text).toBeUndefined();
    expect(loadWireLog("dm-1")).toContainEqual(expect.objectContaining({ id: wire.id }));
  });

  it("leaves an active-room delete alone (usePostStream owns it)", async () => {
    const peer = await createRemotePeer();
    const targetId = seedPost("room-a", peer.did);
    renderHook(() => useMessageAlerts("room-a", selfDid, [friendFixture(peer.did)]));

    const wire = await signedDeleteWire(peer, targetId);
    await act(async () => {
      eventListener?.(0, "transport", wire, "room-a");
      await new Promise((r) => setTimeout(r, 30));
    });

    const stored = loadPosts("chat", "room-a").find((p) => p.id === targetId);
    expect(stored?.deleted).toBeFalsy();
    expect(stored?.text).toBe("original");
    expect(loadWireLog("room-a")).not.toContainEqual(expect.objectContaining({ id: wire.id }));
  });

  it("discards a delete with an invalid signature", async () => {
    const peer = await createRemotePeer();
    const attacker = await createRemotePeer();
    const targetId = seedPost("dm-1", peer.did);
    renderHook(() => useMessageAlerts("room-a", selfDid, [friendFixture(peer.did)]));

    const unsigned = {
      type: "tc-chat:post-delete",
      id: "forged-delete",
      surface: "chat",
      targetId,
      fromId: peer.did,
      fromName: "Bob",
      timestamp: Date.now(),
    };
    const forged = { ...unsigned, signature: await attacker.sign(unsigned) };
    await act(async () => {
      eventListener?.(0, "transport", forged, "dm-1");
      await new Promise((r) => setTimeout(r, 30));
    });

    const stored = loadPosts("chat", "dm-1").find((p) => p.id === targetId);
    expect(stored?.deleted).toBeFalsy();
    expect(loadWireLog("dm-1")).not.toContainEqual(expect.objectContaining({ id: "forged-delete" }));
  });

  it("updates a post's text from a background-room edit", async () => {
    const peer = await createRemotePeer();
    const targetId = seedPost("dm-1", peer.did);
    renderHook(() => useMessageAlerts("room-a", selfDid, [friendFixture(peer.did)]));

    const wire = await signedEditWire(peer, targetId);
    await act(async () => {
      eventListener?.(0, "transport", wire, "dm-1");
    });

    await waitFor(() => {
      const stored = loadPosts("chat", "dm-1").find((p) => p.id === targetId);
      expect(stored?.text).toBe("hello there");
    });
    const stored = loadPosts("chat", "dm-1").find((p) => p.id === targetId);
    expect(stored?.editedAt).toBe(wire.timestamp);
    expect(loadWireLog("dm-1")).toContainEqual(expect.objectContaining({ id: wire.id }));
  });

  it("applies a self-authored delete from another device in a background room", async () => {
    const identity = await ensureDidIdentity();
    const selfPeer = {
      did: identity.did,
      sign: (fields: Record<string, unknown>) =>
        signStringWithDidIdentity(identity, stableStringify(fields)),
    };
    const targetId = seedPost("dm-1", selfDid);
    renderHook(() => useMessageAlerts("room-a", selfDid, [friendFixture("did:key:zBob")]));

    const wire = await signedDeleteWire(selfPeer, targetId);
    await act(async () => {
      eventListener?.(0, "transport", wire, "dm-1");
    });

    await waitFor(() => {
      const stored = loadPosts("chat", "dm-1").find((p) => p.id === targetId);
      expect(stored?.deleted).toBe(true);
    });
  });

  it("joins every accepted friend's DM room in the background (pending ones excluded)", async () => {
    const pending: Friend = {
      did: "did:key:zPending",
      name: "Carol",
      addedAt: 1,
      roomId: "dm-pending",
      status: "pending-out",
    };
    renderHook(() =>
      useMessageAlerts("room-a", selfDid, [friendFixture("did:key:zBob"), pending]),
    );

    await waitFor(() => expect(joinRoomAsync).toHaveBeenCalledWith("dm-1"));
    expect(joinRoomAsync).not.toHaveBeenCalledWith("dm-pending");
  });
});
