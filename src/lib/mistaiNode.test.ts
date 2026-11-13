import { beforeEach, describe, expect, it, vi } from "vitest";
import { EVENT_RAW as AI_RAW, EVENT_PEER_CONNECTED as AI_CONNECTED, EVENT_PEER_DISCONNECTED as AI_DISCONNECTED, getRoomConsumers } from "@tik-choco/mistai";
import { acquireExtraRoom, getNode, subscribeRoomEvent, EVENT_RAW, EVENT_PEER_CONNECTED, EVENT_PEER_DISCONNECTED } from "./mistClient";
import { aiRooms, createMistaiNode } from "./mistaiNode";

vi.mock("./mistClient", () => ({
  getNode: vi.fn(),
  acquireExtraRoom: vi.fn(),
  subscribeRoomEvent: vi.fn(),
  // Deliberately differ from mistai's codes so forwarding unmapped fails.
  EVENT_RAW: 100,
  EVENT_PEER_CONNECTED: 102,
  EVENT_PEER_DISCONNECTED: 103,
}));

type Listener = Parameters<typeof subscribeRoomEvent>[1];
const listeners = new Map<string, Set<Listener>>();
const node = { sendMessage: vi.fn(), leaveRoom: vi.fn(), onEvent: vi.fn() };

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const ready = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { ready, resolve, reject, release: vi.fn() };
}

async function tick() {
  await Promise.resolve();
  await Promise.resolve();
}

function emit(room: string, event: number, payload: unknown = "payload") {
  for (const listener of listeners.get(room) ?? []) void listener(event, "peer", payload, room);
}

describe("mistaiNode", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    listeners.clear();
    vi.mocked(getNode).mockResolvedValue(node as unknown as Awaited<ReturnType<typeof getNode>>);
    vi.mocked(acquireExtraRoom).mockImplementation(() => ({ ready: Promise.resolve(), release: vi.fn() }));
    vi.mocked(subscribeRoomEvent).mockImplementation((room, listener) => {
      const group = listeners.get(room) ?? new Set<Listener>();
      group.add(listener);
      listeners.set(room, group);
      return () => { group.delete(listener); };
    });
  });

  it("registers default room consumers without starting the node", () => {
    expect(getRoomConsumers()).toBe(aiRooms);
    expect(aiRooms.nodeScope).toBe(createMistaiNode);
    expect(aiRooms.nodeIdStorageKey).toBe("tc-chat:mistai-node-id");
    createMistaiNode("ignored");
    expect(getNode).not.toHaveBeenCalled();
    expect(acquireExtraRoom).not.toHaveBeenCalled();
  });

  it("requires init before joining and reuses the existing singleton node", async () => {
    const handle = createMistaiNode("ignored");
    expect(() => handle.joinRoom("room")).toThrow("before init()");
    await handle.init();
    expect(getNode).toHaveBeenCalledOnce();
    expect(node.onEvent).not.toHaveBeenCalled();
  });

  it("acquires one lease and subscription per room per handle", async () => {
    const first = createMistaiNode("one");
    const second = createMistaiNode("two");
    await first.init();
    await second.init();
    first.joinRoom("room");
    first.joinRoom("room");
    second.joinRoom("room");
    expect(vi.mocked(acquireExtraRoom).mock.calls).toEqual([["room"], ["room"]]);
    expect(subscribeRoomEvent).toHaveBeenCalledTimes(2);
    first.leaveRoom();
    expect(listeners.get("room")?.size).toBe(1);
    expect(node.leaveRoom).not.toHaveBeenCalled();
  });

  it("maps only supported events, includes the room id, and keeps subscriptions scoped", async () => {
    const first = createMistaiNode("one");
    const second = createMistaiNode("two");
    const received = vi.fn();
    const other = vi.fn();
    first.onEvent(received);
    second.onEvent(other);
    await first.init();
    await second.init();
    first.joinRoom("a");
    second.joinRoom("b");
    const payload = new Uint8Array([42]);
    emit("a", EVENT_RAW, payload);
    emit("a", EVENT_PEER_CONNECTED);
    emit("a", EVENT_PEER_DISCONNECTED);
    emit("a", 999);
    expect(received.mock.calls).toEqual([
      [AI_RAW, "peer", payload, "a"],
      [AI_CONNECTED, "peer", "payload", "a"],
      [AI_DISCONNECTED, "peer", "payload", "a"],
    ]);
    expect(other).not.toHaveBeenCalled();
    first.leaveRoom();
    emit("a", EVENT_RAW);
    expect(received).toHaveBeenCalledTimes(3);
  });

  it("replaces a handle's own event handler without replacing the real dispatcher", async () => {
    const handle = createMistaiNode("one");
    await handle.init();
    handle.joinRoom("a");
    const oldHandler = vi.fn();
    const newHandler = vi.fn();
    handle.onEvent(oldHandler);
    handle.onEvent(newHandler);
    emit("a", EVENT_RAW);
    expect(oldHandler).not.toHaveBeenCalled();
    expect(newHandler).toHaveBeenCalledWith(AI_RAW, "peer", "payload", "a");
    expect(node.onEvent).not.toHaveBeenCalled();
  });

  it("queues sends until ready and flushes them in order with recipient and delivery", async () => {
    const lease = deferred();
    vi.mocked(acquireExtraRoom).mockReturnValue(lease);
    const handle = createMistaiNode("one");
    await handle.init();
    handle.joinRoom("a");
    const first = new Uint8Array([1]);
    const second = new Uint8Array([2]);
    handle.sendMessage("recipient", first, 1);
    handle.sendMessage(null, second, 0, "a");
    expect(node.sendMessage).not.toHaveBeenCalled();
    lease.resolve();
    await tick();
    expect(node.sendMessage.mock.calls).toEqual([
      ["recipient", first, 1, "a"], [null, second, 0, "a"],
    ]);
    handle.sendMessage(undefined, first);
    expect(node.sendMessage).toHaveBeenLastCalledWith(undefined, first, undefined, "a");
  });

  it("bounds the join queue to the newest 32 sends", async () => {
    const lease = deferred();
    vi.mocked(acquireExtraRoom).mockReturnValue(lease);
    const handle = createMistaiNode("one");
    await handle.init();
    handle.joinRoom("a");
    for (let i = 0; i < 40; i++) handle.sendMessage(null, new Uint8Array([i]));
    lease.resolve();
    await tick();
    expect(node.sendMessage).toHaveBeenCalledTimes(32);
    expect(node.sendMessage.mock.calls.map(call => (call[1] as Uint8Array)[0])).toEqual(
      Array.from({ length: 32 }, (_, i) => i + 8),
    );
  });

  it("routes omitted room ids to the last joined room and falls back when it leaves", async () => {
    const handle = createMistaiNode("one");
    await handle.init();
    handle.joinRoom("a");
    handle.joinRoom("b");
    await tick();
    const payload = new Uint8Array([1]);
    handle.sendMessage(null, payload);
    expect(node.sendMessage).toHaveBeenLastCalledWith(null, payload, undefined, "b");
    handle.sendMessage(null, payload, 0, "a");
    expect(node.sendMessage).toHaveBeenLastCalledWith(null, payload, 0, "a");
    handle.leaveRoom("b");
    handle.sendMessage(null, payload);
    expect(node.sendMessage).toHaveBeenLastCalledWith(null, payload, undefined, "a");
    handle.sendMessage(null, payload, 0, "not-joined");
    expect(node.sendMessage).toHaveBeenCalledTimes(3);
  });

  it("releases only its own leases, once each, for explicit and all-room leave", async () => {
    const a = deferred();
    const b = deferred();
    vi.mocked(acquireExtraRoom).mockReturnValueOnce(a).mockReturnValueOnce(b);
    const handle = createMistaiNode("one");
    await handle.init();
    handle.joinRoom("a");
    handle.joinRoom("b");
    handle.leaveRoom("a");
    expect(a.release).toHaveBeenCalledOnce();
    expect(b.release).not.toHaveBeenCalled();
    expect(listeners.get("a")?.size).toBe(0);
    expect(listeners.get("b")?.size).toBe(1);
    handle.leaveRoom();
    handle.leaveRoom();
    expect(a.release).toHaveBeenCalledOnce();
    expect(b.release).toHaveBeenCalledOnce();
    expect(listeners.get("b")?.size).toBe(0);
    expect(node.leaveRoom).not.toHaveBeenCalled();
  });

  it("drops a departed room's pending sends even if its join later finishes", async () => {
    const lease = deferred();
    vi.mocked(acquireExtraRoom).mockReturnValue(lease);
    const handle = createMistaiNode("one");
    await handle.init();
    handle.joinRoom("a");
    handle.sendMessage(null, new Uint8Array([1]));
    handle.leaveRoom();
    lease.resolve();
    await tick();
    handle.sendMessage(null, new Uint8Array([2]));
    expect(node.sendMessage).not.toHaveBeenCalled();
  });

  it.each(["resolve", "reject"] as const)("ignores a stale join's %s after leave and rejoin", async outcome => {
    const oldLease = deferred();
    const newLease = deferred();
    vi.mocked(acquireExtraRoom).mockReturnValueOnce(oldLease).mockReturnValueOnce(newLease);
    const handle = createMistaiNode("one");
    await handle.init();
    handle.joinRoom("a");
    handle.sendMessage(null, new Uint8Array([1]));
    handle.leaveRoom("a");
    handle.joinRoom("a");
    const current = new Uint8Array([2]);
    handle.sendMessage(null, current);
    if (outcome === "resolve") oldLease.resolve();
    else oldLease.reject(new Error("stale failure"));
    await tick();
    expect(node.sendMessage).not.toHaveBeenCalled();
    expect(newLease.release).not.toHaveBeenCalled();
    newLease.resolve();
    await tick();
    expect(node.sendMessage.mock.calls).toEqual([[null, current, undefined, "a"]]);
  });

  it("cleans up a failed join and discards its pending queue", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const lease = deferred();
    vi.mocked(acquireExtraRoom).mockReturnValue(lease);
    const handle = createMistaiNode("one");
    await handle.init();
    handle.joinRoom("a");
    handle.sendMessage(null, new Uint8Array([1]));
    lease.reject(new Error("join failed"));
    await tick();
    expect(lease.release).toHaveBeenCalledOnce();
    expect(listeners.get("a")?.size).toBe(0);
    expect(node.sendMessage).not.toHaveBeenCalled();
    debug.mockRestore();
  });

  it("swallows Room not joined transients while propagating other immediate send errors", async () => {
    const handle = createMistaiNode("one");
    await handle.init();
    handle.joinRoom("a");
    await tick();
    node.sendMessage.mockImplementationOnce(() => { throw new Error("Room not joined: a"); });
    expect(() => handle.sendMessage(null, new Uint8Array())).not.toThrow();
    node.sendMessage.mockImplementationOnce(() => { throw "Room not joined"; });
    expect(() => handle.sendMessage(null, new Uint8Array())).not.toThrow();
    node.sendMessage.mockImplementationOnce(() => { throw new Error("unexpected"); });
    expect(() => handle.sendMessage(null, new Uint8Array())).toThrow("unexpected");
  });

  it("continues flushing queued messages if a send fails", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const lease = deferred();
    vi.mocked(acquireExtraRoom).mockReturnValue(lease);
    const handle = createMistaiNode("one");
    await handle.init();
    handle.joinRoom("a");
    handle.sendMessage(null, new Uint8Array([1]));
    handle.sendMessage(null, new Uint8Array([2]));
    node.sendMessage.mockImplementationOnce(() => { throw new Error("Room not joined"); });
    lease.resolve();
    await tick();
    expect(node.sendMessage).toHaveBeenCalledTimes(2);
    debug.mockRestore();
  });
});
