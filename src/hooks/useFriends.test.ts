import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/preact";
import { useFriends } from "./useFriends";
import {
  createDidIdentity,
  ensureDidIdentity,
  signStringWithDidIdentity,
} from "../crypto/didIdentity";

type EventListener = (
  eventType: number,
  fromId: string,
  payload: unknown,
  roomId?: string,
) => void;

const EVENT_PEER_CONNECTED = 5;
const sendMessage = vi.fn();
let eventListener: EventListener | null = null;

vi.mock("../lib/mistClient", () => ({
  getNode: vi.fn(async () => ({ sendMessage })),
  subscribeEvent: vi.fn((listener: EventListener) => {
    eventListener = listener;
    return () => {
      eventListener = null;
    };
  }),
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

function findByType(type: string) {
  return sendMessage.mock.calls.filter(([, msg]) => (msg as { type?: string })?.type === type);
}

describe("useFriends", () => {
  let selfDid: string;

  beforeEach(async () => {
    localStorage.clear();
    vi.clearAllMocks();
    eventListener = null;
    // Sign broadcasts with the app's real local identity so fromId matches.
    const identity = await ensureDidIdentity();
    selfDid = identity.did;
  });

  it("sendFriendRequest persists pending-out and broadcasts a signed request with toDid", async () => {
    const peer = await createRemotePeer();
    const { result } = renderHook(() => useFriends("r1", selfDid, "Alice"));

    await act(async () => {
      await result.current.sendFriendRequest(peer.did, "Bob");
    });

    expect(result.current.friends).toHaveLength(1);
    expect(result.current.friends[0]).toMatchObject({ did: peer.did, status: "pending-out" });

    const requests = findByType("tc-chat:friend-request");
    expect(requests).toHaveLength(1);
    const [target, wire, , channelId] = requests[0];
    expect(target).toBeNull();
    expect((wire as { toDid: string }).toDid).toBe(peer.did);
    expect((wire as { fromId: string }).fromId).toBe(selfDid);
    expect(typeof (wire as { signature: string }).signature).toBe("string");
    expect(channelId).toBe("r1");
  });

  it("receiving a valid friend-request adds pending-in", async () => {
    const peer = await createRemotePeer();
    const { result } = renderHook(() => useFriends("r1", selfDid, "Alice"));

    const unsigned = {
      type: "tc-chat:friend-request",
      fromId: peer.did,
      toDid: selfDid,
      name: "Bob",
      sentAt: Date.now(),
    };
    await act(async () => {
      eventListener?.(0, "peer-transport", { ...unsigned, signature: await peer.sign(unsigned) }, "r1");
    });

    await waitFor(() =>
      expect(result.current.friends).toContainEqual(
        expect.objectContaining({ did: peer.did, status: "pending-in", name: "Bob" }),
      ),
    );
  });

  it("receiving a friend-request while pending-out promotes to accepted and emits a response", async () => {
    const peer = await createRemotePeer();
    const { result } = renderHook(() => useFriends("r1", selfDid, "Alice"));

    await act(async () => {
      await result.current.sendFriendRequest(peer.did, "Bob");
    });
    sendMessage.mockClear();

    const unsigned = {
      type: "tc-chat:friend-request",
      fromId: peer.did,
      toDid: selfDid,
      name: "Bob",
      sentAt: Date.now(),
    };
    await act(async () => {
      eventListener?.(0, "peer-transport", { ...unsigned, signature: await peer.sign(unsigned) }, "r1");
    });

    await waitFor(() =>
      expect(result.current.friends).toContainEqual(
        expect.objectContaining({ did: peer.did, status: "accepted" }),
      ),
    );
    const responses = findByType("tc-chat:friend-response");
    expect(responses).toHaveLength(1);
    expect((responses[0][1] as { accept: boolean }).accept).toBe(true);
    expect((responses[0][1] as { toDid: string }).toDid).toBe(peer.did);
  });

  it("a friend-response accept promotes pending-out to accepted", async () => {
    const peer = await createRemotePeer();
    const { result } = renderHook(() => useFriends("r1", selfDid, "Alice"));

    await act(async () => {
      await result.current.sendFriendRequest(peer.did, "Bob");
    });

    const unsigned = {
      type: "tc-chat:friend-response",
      fromId: peer.did,
      toDid: selfDid,
      accept: true,
      name: "Bob",
      sentAt: Date.now(),
    };
    await act(async () => {
      eventListener?.(0, "peer-transport", { ...unsigned, signature: await peer.sign(unsigned) }, "r1");
    });

    await waitFor(() =>
      expect(result.current.friends).toContainEqual(
        expect.objectContaining({ did: peer.did, status: "accepted" }),
      ),
    );
  });

  it("a friend-response decline removes a pending-out entry", async () => {
    const peer = await createRemotePeer();
    const { result } = renderHook(() => useFriends("r1", selfDid, "Alice"));

    await act(async () => {
      await result.current.sendFriendRequest(peer.did, "Bob");
    });
    expect(result.current.friends).toHaveLength(1);

    const unsigned = {
      type: "tc-chat:friend-response",
      fromId: peer.did,
      toDid: selfDid,
      accept: false,
      name: "Bob",
      sentAt: Date.now(),
    };
    await act(async () => {
      eventListener?.(0, "peer-transport", { ...unsigned, signature: await peer.sign(unsigned) }, "r1");
    });

    await waitFor(() => expect(result.current.friends).toHaveLength(0));
  });

  it("a friend-cancel wire removes a pending-in entry", async () => {
    const peer = await createRemotePeer();
    const { result } = renderHook(() => useFriends("r1", selfDid, "Alice"));

    const request = {
      type: "tc-chat:friend-request",
      fromId: peer.did,
      toDid: selfDid,
      name: "Bob",
      sentAt: Date.now(),
    };
    await act(async () => {
      eventListener?.(0, "peer-transport", { ...request, signature: await peer.sign(request) }, "r1");
    });
    await waitFor(() => expect(result.current.friends).toHaveLength(1));

    const cancel = {
      type: "tc-chat:friend-cancel",
      fromId: peer.did,
      toDid: selfDid,
      sentAt: Date.now(),
    };
    await act(async () => {
      eventListener?.(0, "peer-transport", { ...cancel, signature: await peer.sign(cancel) }, "r1");
    });

    await waitFor(() => expect(result.current.friends).toHaveLength(0));
  });

  it("ignores a wire addressed to a different toDid", async () => {
    const peer = await createRemotePeer();
    const other = await createRemotePeer();
    const { result } = renderHook(() => useFriends("r1", selfDid, "Alice"));

    const unsigned = {
      type: "tc-chat:friend-request",
      fromId: peer.did,
      toDid: other.did, // not us
      name: "Bob",
      sentAt: Date.now(),
    };
    await act(async () => {
      eventListener?.(0, "peer-transport", { ...unsigned, signature: await peer.sign(unsigned) }, "r1");
    });
    await new Promise((r) => setTimeout(r, 30));

    expect(result.current.friends).toHaveLength(0);
  });

  it("ignores a wire that fails signature verification", async () => {
    const peer = await createRemotePeer();
    const attacker = await createRemotePeer();
    const { result } = renderHook(() => useFriends("r1", selfDid, "Alice"));

    const unsigned = {
      type: "tc-chat:friend-request",
      fromId: peer.did, // claims to be peer
      toDid: selfDid,
      name: "Bob",
      sentAt: Date.now(),
    };
    // ...but signed by the attacker's key.
    await act(async () => {
      eventListener?.(0, "peer-transport", { ...unsigned, signature: await attacker.sign(unsigned) }, "r1");
    });
    await new Promise((r) => setTimeout(r, 30));

    expect(result.current.friends).toHaveLength(0);
  });

  it("ignores an event delivered on a different room's channel", async () => {
    const peer = await createRemotePeer();
    const { result } = renderHook(() => useFriends("r1", selfDid, "Alice"));

    const unsigned = {
      type: "tc-chat:friend-request",
      fromId: peer.did,
      toDid: selfDid,
      name: "Bob",
      sentAt: Date.now(),
    };
    await act(async () => {
      eventListener?.(0, "peer-transport", { ...unsigned, signature: await peer.sign(unsigned) }, "other-room");
    });
    await new Promise((r) => setTimeout(r, 30));

    expect(result.current.friends).toHaveLength(0);
  });

  it("acceptFriendRequest promotes a pending-in entry and broadcasts an accept response", async () => {
    const peer = await createRemotePeer();
    const { result } = renderHook(() => useFriends("r1", selfDid, "Alice"));

    const request = {
      type: "tc-chat:friend-request",
      fromId: peer.did,
      toDid: selfDid,
      name: "Bob",
      sentAt: Date.now(),
    };
    await act(async () => {
      eventListener?.(0, "peer-transport", { ...request, signature: await peer.sign(request) }, "r1");
    });
    await waitFor(() => expect(result.current.friends).toHaveLength(1));
    sendMessage.mockClear();

    await act(async () => {
      await result.current.acceptFriendRequest(peer.did);
    });

    expect(result.current.friends[0].status).toBe("accepted");
    const responses = findByType("tc-chat:friend-response");
    expect(responses).toHaveLength(1);
    expect((responses[0][1] as { accept: boolean }).accept).toBe(true);
  });

  it("cancelFriendRequest removes a pending-out entry and broadcasts a cancel wire", async () => {
    const peer = await createRemotePeer();
    const { result } = renderHook(() => useFriends("r1", selfDid, "Alice"));

    await act(async () => {
      await result.current.sendFriendRequest(peer.did, "Bob");
    });
    sendMessage.mockClear();

    await act(async () => {
      await result.current.cancelFriendRequest(peer.did);
    });

    expect(result.current.friends).toHaveLength(0);
    const cancels = findByType("tc-chat:friend-cancel");
    expect(cancels).toHaveLength(1);
    expect((cancels[0][1] as { toDid: string }).toDid).toBe(peer.did);
  });

  it("removeFriend removes locally without sending a wire", async () => {
    const peer = await createRemotePeer();
    const { result } = renderHook(() => useFriends("r1", selfDid, "Alice"));

    await act(async () => {
      await result.current.sendFriendRequest(peer.did, "Bob");
    });
    sendMessage.mockClear();

    act(() => {
      result.current.removeFriend(peer.did);
    });

    expect(result.current.friends).toHaveLength(0);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("re-sends pending-out requests targeted at a newly connected peer", async () => {
    const peer = await createRemotePeer();
    const { result } = renderHook(() => useFriends("r1", selfDid, "Alice"));

    await act(async () => {
      await result.current.sendFriendRequest(peer.did, "Bob");
    });
    sendMessage.mockClear();

    await act(async () => {
      eventListener?.(EVENT_PEER_CONNECTED, "new-peer-transport", null, "r1");
      await new Promise((r) => setTimeout(r, 650));
    });

    const targeted = sendMessage.mock.calls.find(
      ([to, msg]) => to === "new-peer-transport" && (msg as { type?: string })?.type === "tc-chat:friend-request",
    );
    expect(targeted).toBeTruthy();
  });
});
