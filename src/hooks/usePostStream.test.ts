import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/preact";
import { usePostStream } from "./usePostStream";
import { createDidIdentity, signStringWithDidIdentity } from "../crypto/didIdentity";
import { decryptPostBytes, encryptPostBytes, generatePostEnc, isPostEnc } from "../crypto/postCipher";

type EventListener = (
  eventType: number,
  fromId: string,
  payload: unknown,
  roomId?: string,
) => void;

const sendMessage = vi.fn();
const storage_add = vi.fn(async (_name: string, _bytes: Uint8Array) => "cid-new");
let storedBytes: Uint8Array | null = null;
let eventListener: EventListener | null = null;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// cid -> a storage_get() fetch a test wants to hold open and release later
// (to reproduce the post-hydration-vs-delete race). Any cid without an entry
// here resolves immediately from `storedBytes`, same as before — this must
// stay the default so every pre-existing test keeps working unmodified.
const heldStorageGets = new Map<string, Deferred<Uint8Array>>();

/** Makes storage_get(cid) hang until the test calls the returned resolve(). */
function holdStorageGet(cid: string): Deferred<Uint8Array> {
  const deferred = createDeferred<Uint8Array>();
  heldStorageGets.set(cid, deferred);
  return deferred;
}

vi.mock("../lib/mistClient", () => ({
  getNode: vi.fn(async () => ({ nodeId: "self-id", sendMessage })),
  subscribeEvent: vi.fn((listener: EventListener) => {
    eventListener = listener;
    return () => {
      eventListener = null;
    };
  }),
  isRawEvent: vi.fn((eventType: number) => eventType === 0),
  decodeRawPayload: vi.fn((payload: unknown) => payload),
  storage_add: (name: string, bytes: Uint8Array) => storage_add(name, bytes),
  storage_get: vi.fn(async (cid: string) => {
    const held = heldStorageGets.get(cid);
    if (held) return held.promise;
    return storedBytes ?? new Uint8Array();
  }),
  DELIVERY_RELIABLE: 1,
}));

// relay-cache policy is another worker's module (currently a no-op stub);
// mock it here so these tests can both assert usePostStream calls it
// correctly AND control shouldRelayRoom's answer per test without depending
// on the stub's real (eventually GLOBAL_ROOM_ID-gated) implementation.
const relayShouldRelayRoom = vi.fn((_roomId: string) => false);
const relayNoteBody = vi.fn(
  async (_roomId: string, _postId: string, _cid: string, _byteLength: number) => {},
);
const relayReleasePost = vi.fn(async (_roomId: string, _postId: string) => {});
const relaySweepRoom = vi.fn(async (_roomId: string) => {});

vi.mock("../lib/relayCache", () => ({
  shouldRelayRoom: (roomId: string) => relayShouldRelayRoom(roomId),
  AUTO_FETCH_MAX_BYTES: 8 * 1024 * 1024,
  noteBody: (roomId: string, postId: string, cid: string, byteLength: number) =>
    relayNoteBody(roomId, postId, cid, byteLength),
  releasePost: (roomId: string, postId: string) => relayReleasePost(roomId, postId),
  sweepRoom: (roomId: string) => relaySweepRoom(roomId),
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

describe("usePostStream", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    eventListener = null;
    storedBytes = null;
    heldStorageGets.clear();
    // vi.clearAllMocks() clears call history but NOT a base vi.fn() factory
    // implementation set at declaration time — reassert the default here so
    // a mockReturnValue(true) in one test can't leak into the next.
    relayShouldRelayRoom.mockImplementation(() => false);
  });

  it("createPost (board/project): encrypts the JSON body before storage_add, broadcasts a signed post wire with surface + enc", async () => {
    const { result } = renderHook(() => usePostStream("room-1", "board", "Alice"));

    await act(async () => {
      await result.current.createPost({
        parentId: null,
        kind: "project",
        title: "Frontend dev wanted",
        text: "Looking for a Preact dev",
        roles: ["frontend"],
        tags: ["preact"],
      });
    });

    expect(storage_add).toHaveBeenCalledTimes(1);
    const [name, bytes] = storage_add.mock.calls[0];
    // Generic storage name — no filename/type leaks into the plaintext manifest.
    expect(name).toBe("enc.bin");

    const [, wire] = sendMessage.mock.calls[0];
    expect(wire.type).toBe("tc-chat:post");
    expect(wire.surface).toBe("board");
    expect(wire.parentId).toBeNull();
    expect(wire).not.toHaveProperty("title");
    expect(typeof wire.signature).toBe("string");
    expect(isPostEnc(wire.enc)).toBe(true);

    // The stored bytes are ciphertext — decrypting with the wire's enc
    // recovers the plaintext JSON manifest.
    const decrypted = await decryptPostBytes(wire.enc, bytes as Uint8Array);
    expect(JSON.parse(new TextDecoder().decode(decrypted))).toEqual({
      title: "Frontend dev wanted",
      text: "Looking for a Preact dev",
      roles: ["frontend"],
      tags: ["preact"],
    });

    expect(result.current.nodes).toHaveLength(1);
    expect(result.current.nodes[0].title).toBe("Frontend dev wanted");
    expect(result.current.nodes[0].enc).toEqual(wire.enc);
  });

  it("createPost carries parentId for comments", async () => {
    const { result } = renderHook(() => usePostStream("room-1", "board", "Alice"));
    await act(async () => {
      await result.current.createPost({ parentId: "root-1", kind: "text", text: "nice!" });
    });
    expect(sendMessage.mock.calls[0][1].parentId).toBe("root-1");
    expect(result.current.nodes[0].parentId).toBe("root-1");
  });

  it("createMedia (chat): stores encrypted file bytes and puts metadata on the wire (no JSON body)", async () => {
    const { result } = renderHook(() => usePostStream("room-1", "chat", "Alice"));
    await act(async () => {
      await result.current.createMedia(new File([new Uint8Array([1, 2, 3])], "pic.png", { type: "image/png" }));
    });
    const [, wire] = sendMessage.mock.calls[0];
    expect(wire.surface).toBe("chat");
    expect(wire.kind).toBe("media");
    expect(wire.mimeType).toBe("image/png");
    expect(wire.fileName).toBe("pic.png");
    // fileSize stays the PLAINTEXT size — wire metadata visibility is
    // unchanged by design; only the body bytes are protected at rest.
    expect(wire.fileSize).toBe(3);
    expect(isPostEnc(wire.enc)).toBe(true);
    const [name] = storage_add.mock.calls[0];
    expect(name).toBe("enc.bin");
    expect(result.current.nodes[0].fileName).toBe("pic.png");
  });

  it("createPost (calendar/event): allows a title-only event with no description text", async () => {
    const { result } = renderHook(() => usePostStream("room-1", "calendar", "Alice"));

    await act(async () => {
      await result.current.createPost({
        parentId: null,
        kind: "event",
        title: "Standup",
        startsAt: 12345,
        location: "Room A",
      });
    });

    expect(storage_add).toHaveBeenCalledTimes(1);
    const [, bytes] = storage_add.mock.calls[0];
    const [, wire] = sendMessage.mock.calls[0];
    const decrypted = await decryptPostBytes(wire.enc, bytes as Uint8Array);
    expect(JSON.parse(new TextDecoder().decode(decrypted))).toEqual({
      title: "Standup",
      startsAt: 12345,
      location: "Room A",
    });
    expect(result.current.nodes).toHaveLength(1);
    expect(result.current.nodes[0].startsAt).toBe(12345);
    expect(result.current.nodes[0].text).toBeUndefined();
  });

  it("createPost rejects a post with neither text nor title", async () => {
    const { result } = renderHook(() => usePostStream("room-1", "calendar", "Alice"));
    await act(async () => {
      await result.current.createPost({ parentId: null, kind: "event", startsAt: 1 });
    });
    expect(storage_add).not.toHaveBeenCalled();
    expect(result.current.nodes).toHaveLength(0);
  });

  it("editPost (calendar/event): allows editing an event's date without touching text", async () => {
    const { result } = renderHook(() => usePostStream("room-1", "calendar", "Alice"));
    await act(async () => {
      await result.current.createPost({ parentId: null, kind: "event", title: "Standup", startsAt: 1000 });
    });
    const id = result.current.nodes[0].id;

    await act(async () => {
      await result.current.editPost(id, { startsAt: 2000, location: "Room B" });
    });

    expect(result.current.nodes[0].startsAt).toBe(2000);
    expect(result.current.nodes[0].location).toBe("Room B");
    expect(result.current.nodes[0].title).toBe("Standup"); // untouched fields survive the edit
  });

  it("ignores empty body text", async () => {
    const { result } = renderHook(() => usePostStream("room-1", "chat", "Alice"));
    await act(async () => {
      await result.current.createPost({ parentId: null, kind: "text", text: "  " });
    });
    expect(storage_add).not.toHaveBeenCalled();
    expect(result.current.nodes).toHaveLength(0);
  });

  it("hydrates a correctly signed incoming post for the matching surface (legacy plaintext wire, no enc)", async () => {
    storedBytes = new TextEncoder().encode(JSON.stringify({ title: "Designer wanted", text: "UI" }));
    const peer = await createRemotePeer();
    const { result } = renderHook(() => usePostStream("room-1", "board", "Alice"));

    const unsigned = {
      type: "tc-chat:post",
      surface: "board",
      id: "node-1",
      parentId: null,
      fromId: peer.did,
      fromName: "Bob",
      timestamp: 123,
      kind: "project",
      cid: "cid-remote",
    };
    await act(async () => {
      eventListener?.(0, peer.did, { ...unsigned, signature: await peer.sign(unsigned) });
    });
    await waitFor(() => expect(result.current.nodes).toHaveLength(1));
    expect(result.current.nodes[0].fromName).toBe("Bob");
    expect(result.current.nodes[0].title).toBe("Designer wanted");
    expect(result.current.nodes[0].enc).toBeUndefined();
  });

  it("round-trips an encrypted structured post: wire carries enc, hydrate decrypts the body", async () => {
    const peer = await createRemotePeer();
    const enc = generatePostEnc();
    const plainBody = { title: "Secret project", text: "shh, don't tell" };
    storedBytes = await encryptPostBytes(enc, new TextEncoder().encode(JSON.stringify(plainBody)));
    const { result } = renderHook(() => usePostStream("room-1", "board", "Alice"));

    const unsigned = {
      type: "tc-chat:post",
      surface: "board",
      id: "enc-node-1",
      parentId: null,
      fromId: peer.did,
      fromName: "Bob",
      timestamp: 123,
      kind: "project",
      cid: "cid-enc",
      enc,
    };
    await act(async () => {
      eventListener?.(0, peer.did, { ...unsigned, signature: await peer.sign(unsigned) });
    });
    await waitFor(() => expect(result.current.nodes).toHaveLength(1));
    expect(result.current.nodes[0].title).toBe("Secret project");
    expect(result.current.nodes[0].text).toBe("shh, don't tell");
    expect(result.current.nodes[0].enc).toEqual(enc);
  });

  it("discards a post wire with a malformed enc instead of crashing (treated as a body-fetch failure)", async () => {
    storedBytes = new TextEncoder().encode(JSON.stringify({ text: "hi" }));
    const peer = await createRemotePeer();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = renderHook(() => usePostStream("room-1", "board", "Alice"));

    const unsigned = {
      type: "tc-chat:post",
      surface: "board",
      id: "bad-enc-1",
      parentId: null,
      fromId: peer.did,
      fromName: "Bob",
      timestamp: 123,
      kind: "text",
      cid: "cid-remote",
      enc: { v: 1, alg: "A256GCM" }, // missing `key` -> fails isPostEnc
    };
    await act(async () => {
      eventListener?.(0, peer.did, { ...unsigned, signature: await peer.sign(unsigned) });
    });
    await waitFor(() => expect(warnSpy).toHaveBeenCalled());
    // No crash, and no node is appended for the undecryptable body.
    expect(result.current.nodes).toHaveLength(0);
    warnSpy.mockRestore();
  });

  it("media/file wires within the auto-fetch cap eagerly pull bytes and pin them (relay rooms only)", async () => {
    relayShouldRelayRoom.mockReturnValue(true);
    storedBytes = new Uint8Array([9, 9, 9]);
    const peer = await createRemotePeer();
    const { result } = renderHook(() => usePostStream("room-1", "chat", "Alice"));

    const unsigned = {
      type: "tc-chat:post",
      surface: "chat",
      id: "media-1",
      parentId: null,
      fromId: peer.did,
      fromName: "Bob",
      timestamp: 123,
      kind: "media",
      cid: "cid-media",
      mimeType: "image/png",
      fileName: "pic.png",
      fileSize: 3,
    };
    await act(async () => {
      eventListener?.(0, peer.did, { ...unsigned, signature: await peer.sign(unsigned) });
    });
    await waitFor(() => expect(result.current.nodes).toHaveLength(1));
    await waitFor(() =>
      expect(relayNoteBody).toHaveBeenCalledWith("room-1", "media-1", "cid-media", 3),
    );
  });

  it("does not eagerly fetch media/file bytes when the room isn't relay-eligible", async () => {
    relayShouldRelayRoom.mockReturnValue(false);
    storedBytes = new Uint8Array([9, 9, 9]);
    const peer = await createRemotePeer();
    const { result } = renderHook(() => usePostStream("room-1", "chat", "Alice"));

    const unsigned = {
      type: "tc-chat:post",
      surface: "chat",
      id: "media-2",
      parentId: null,
      fromId: peer.did,
      fromName: "Bob",
      timestamp: 123,
      kind: "media",
      cid: "cid-media-2",
      mimeType: "image/png",
      fileName: "pic.png",
      fileSize: 3,
    };
    await act(async () => {
      eventListener?.(0, peer.did, { ...unsigned, signature: await peer.sign(unsigned) });
    });
    await waitFor(() => expect(result.current.nodes).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 30));
    expect(relayNoteBody).not.toHaveBeenCalled();
  });

  it("broadcasts posts scoped to the room's swarm topic (the raw room id)", async () => {
    const { result } = renderHook(() => usePostStream("room-1", "chat", "Alice"));
    await act(async () => {
      await result.current.createPost({ parentId: null, kind: "text", text: "hi" });
    });
    // sendMessage(target, wire, delivery, roomId) — 4th arg is the room scope.
    const call = sendMessage.mock.calls[0];
    expect(call[3]).toBe("room-1");
  });

  it("ignores a post that arrived on another room's channel", async () => {
    storedBytes = new TextEncoder().encode(JSON.stringify({ text: "leak" }));
    const peer = await createRemotePeer();
    const { result } = renderHook(() => usePostStream("room-1", "chat", "Alice"));

    const unsigned = {
      type: "tc-chat:post",
      surface: "chat",
      id: "leak-1",
      parentId: null,
      fromId: peer.did,
      fromName: "Bob",
      timestamp: 123,
      kind: "text",
      cid: "cid-remote",
    };
    await act(async () => {
      // Delivered on a DIFFERENT room's swarm topic — must not leak into room-1.
      eventListener?.(0, peer.did, { ...unsigned, signature: await peer.sign(unsigned) }, "other-room");
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(result.current.nodes).toHaveLength(0);

    // The same wire on room-1's own channel is accepted.
    await act(async () => {
      eventListener?.(0, peer.did, { ...unsigned, signature: await peer.sign(unsigned) }, "room-1");
    });
    await waitFor(() => expect(result.current.nodes).toHaveLength(1));
  });

  it("ignores a post addressed to the other surface", async () => {
    storedBytes = new TextEncoder().encode(JSON.stringify({ text: "hi" }));
    const peer = await createRemotePeer();
    const { result } = renderHook(() => usePostStream("room-1", "board", "Alice"));

    const unsigned = {
      type: "tc-chat:post",
      surface: "chat", // different surface
      id: "node-x",
      parentId: null,
      fromId: peer.did,
      fromName: "Bob",
      timestamp: 123,
      kind: "text",
      cid: "cid-remote",
    };
    await act(async () => {
      eventListener?.(0, peer.did, { ...unsigned, signature: await peer.sign(unsigned) });
    });
    // Give it a tick; it should not be added to this (board) stream.
    await new Promise((r) => setTimeout(r, 30));
    expect(result.current.nodes).toHaveLength(0);
  });

  it("discards a tampered post wire (fromName rewritten after signing)", async () => {
    storedBytes = new TextEncoder().encode(JSON.stringify({ text: "hi" }));
    const peer = await createRemotePeer();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = renderHook(() => usePostStream("room-1", "board", "Alice"));

    const unsigned = {
      type: "tc-chat:post",
      surface: "board",
      id: "node-2",
      parentId: null,
      fromId: peer.did,
      fromName: "Bob",
      timestamp: 123,
      kind: "text",
      cid: "cid-remote",
    };
    await act(async () => {
      eventListener?.(0, peer.did, { ...unsigned, fromName: "Eve", signature: await peer.sign(unsigned) });
    });
    await waitFor(() => expect(warnSpy).toHaveBeenCalled());
    expect(result.current.nodes).toHaveLength(0);
    warnSpy.mockRestore();
  });

  it("locally toggling a reaction broadcasts an add then a remove", async () => {
    const { result } = renderHook(() => usePostStream("room-1", "chat", "Alice"));
    await act(async () => {
      await result.current.createPost({ parentId: null, kind: "text", text: "hi" });
    });
    const id = result.current.nodes[0].id;

    await act(async () => {
      await result.current.toggleReaction(id, "🎉");
    });
    expect(result.current.nodes[0].reactions).toHaveLength(1);
    expect(sendMessage.mock.calls.at(-1)![1].op).toBe("add");

    await act(async () => {
      await result.current.toggleReaction(id, "🎉");
    });
    expect(result.current.nodes[0].reactions).toHaveLength(0);
    expect(sendMessage.mock.calls.at(-1)![1].op).toBe("remove");
  });

  it("editPost broadcasts a signed room-scoped post-edit wire reusing the post's enc and updates the node", async () => {
    const { result } = renderHook(() => usePostStream("room-1", "chat", "Alice"));
    await act(async () => {
      await result.current.createPost({ parentId: null, kind: "text", text: "before" });
    });
    const id = result.current.nodes[0].id;
    const createWire = sendMessage.mock.calls[0][1];

    await act(async () => {
      await result.current.editPost(id, { text: "after" });
    });

    // The edited body is re-stored (post body + edit body = 2 adds).
    expect(storage_add).toHaveBeenCalledTimes(2);
    const [, bytes] = storage_add.mock.calls[1];
    const call = sendMessage.mock.calls.at(-1)!;
    const wire = call[1];
    const decrypted = await decryptPostBytes(wire.enc, bytes as Uint8Array);
    expect(JSON.parse(new TextDecoder().decode(decrypted)).text).toBe("after");

    expect(wire.type).toBe("tc-chat:post-edit");
    expect(wire.surface).toBe("chat");
    expect(wire.targetId).toBe(id);
    expect(wire.cid).toBe("cid-new");
    expect(typeof wire.signature).toBe("string");
    expect(isPostEnc(wire.enc)).toBe(true);
    // The post's one content key is reused across edits (blobs carry their
    // own IVs), so a thumbnail carried over unchanged stays decryptable.
    expect(wire.enc.key).toBe(createWire.enc.key);
    expect(call[3]).toBe("room-1"); // room-scoped send

    expect(result.current.nodes[0].text).toBe("after");
    expect(result.current.nodes[0].editedAt).toBe(wire.timestamp);
    expect(result.current.nodes[0].enc).toEqual(wire.enc);
  });

  it("deletePost broadcasts a signed post-delete wire, tombstones the node, and releases the relay pin", async () => {
    const { result } = renderHook(() => usePostStream("room-1", "chat", "Alice"));
    await act(async () => {
      await result.current.createPost({ parentId: null, kind: "text", text: "bye" });
    });
    const id = result.current.nodes[0].id;
    await act(async () => {
      await result.current.toggleReaction(id, "👍");
    });

    await act(async () => {
      await result.current.deletePost(id);
    });

    const call = sendMessage.mock.calls.at(-1)!;
    expect(call[1].type).toBe("tc-chat:post-delete");
    expect(call[1].targetId).toBe(id);
    expect(typeof call[1].signature).toBe("string");
    expect(call[3]).toBe("room-1");
    expect(relayReleasePost).toHaveBeenCalledWith("room-1", id);

    const tomb = result.current.nodes[0];
    expect(tomb.deleted).toBe(true);
    expect(tomb.text).toBeUndefined();
    expect(tomb.reactions).toHaveLength(0);
  });

  it("refuses to edit or delete someone else's post (no wire sent)", async () => {
    storedBytes = new TextEncoder().encode(JSON.stringify({ text: "theirs" }));
    const peer = await createRemotePeer();
    const { result } = renderHook(() => usePostStream("room-1", "chat", "Alice"));

    const unsigned = {
      type: "tc-chat:post",
      surface: "chat",
      id: "their-post",
      parentId: null,
      fromId: peer.did,
      fromName: "Bob",
      timestamp: 123,
      kind: "text",
      cid: "cid-remote",
    };
    await act(async () => {
      eventListener?.(0, peer.did, { ...unsigned, signature: await peer.sign(unsigned) });
    });
    await waitFor(() => expect(result.current.nodes).toHaveLength(1));

    const callsBefore = sendMessage.mock.calls.length;
    await act(async () => {
      await result.current.editPost("their-post", { text: "hijacked" });
      await result.current.deletePost("their-post");
    });
    expect(sendMessage.mock.calls.length).toBe(callsBefore);
    expect(result.current.nodes[0].text).toBe("theirs");
    expect(result.current.nodes[0].deleted).toBeUndefined();
  });

  it("applies an incoming edit signed by the post's real author", async () => {
    storedBytes = new TextEncoder().encode(JSON.stringify({ text: "v1" }));
    const peer = await createRemotePeer();
    const { result } = renderHook(() => usePostStream("room-1", "chat", "Alice"));

    const post = {
      type: "tc-chat:post",
      surface: "chat",
      id: "p1",
      parentId: null,
      fromId: peer.did,
      fromName: "Bob",
      timestamp: 123,
      kind: "text",
      cid: "cid-v1",
    };
    await act(async () => {
      eventListener?.(0, peer.did, { ...post, signature: await peer.sign(post) });
    });
    await waitFor(() => expect(result.current.nodes).toHaveLength(1));

    storedBytes = new TextEncoder().encode(JSON.stringify({ text: "v2" }));
    const edit = {
      type: "tc-chat:post-edit",
      id: "e1",
      surface: "chat",
      targetId: "p1",
      cid: "cid-v2",
      fromId: peer.did,
      fromName: "Bob",
      timestamp: 456,
    };
    await act(async () => {
      eventListener?.(0, peer.did, { ...edit, signature: await peer.sign(edit) });
    });
    await waitFor(() => expect(result.current.nodes[0].text).toBe("v2"));
    expect(result.current.nodes[0].cid).toBe("cid-v2");
    expect(result.current.nodes[0].editedAt).toBe(456);
  });

  it("applies an incoming delete signed by the post's real author and releases the relay pin", async () => {
    storedBytes = new TextEncoder().encode(JSON.stringify({ text: "doomed" }));
    const peer = await createRemotePeer();
    const { result } = renderHook(() => usePostStream("room-1", "chat", "Alice"));

    const post = {
      type: "tc-chat:post",
      surface: "chat",
      id: "p2",
      parentId: null,
      fromId: peer.did,
      fromName: "Bob",
      timestamp: 123,
      kind: "text",
      cid: "cid-remote",
    };
    await act(async () => {
      eventListener?.(0, peer.did, { ...post, signature: await peer.sign(post) });
    });
    await waitFor(() => expect(result.current.nodes).toHaveLength(1));

    const del = {
      type: "tc-chat:post-delete",
      id: "d1",
      surface: "chat",
      targetId: "p2",
      fromId: peer.did,
      fromName: "Bob",
      timestamp: 456,
    };
    await act(async () => {
      eventListener?.(0, peer.did, { ...del, signature: await peer.sign(del) });
    });
    await waitFor(() => expect(result.current.nodes[0].deleted).toBe(true));
    expect(result.current.nodes[0].text).toBeUndefined();
    expect(relayReleasePost).toHaveBeenCalledWith("room-1", "p2");
  });

  it("REJECTS an incoming delete whose fromId is not the target post's author (and does not release its pin)", async () => {
    storedBytes = new TextEncoder().encode(JSON.stringify({ text: "mine" }));
    const author = await createRemotePeer();
    const attacker = await createRemotePeer();
    const { result } = renderHook(() => usePostStream("room-1", "chat", "Alice"));

    const post = {
      type: "tc-chat:post",
      surface: "chat",
      id: "p3",
      parentId: null,
      fromId: author.did,
      fromName: "Bob",
      timestamp: 123,
      kind: "text",
      cid: "cid-remote",
    };
    await act(async () => {
      eventListener?.(0, author.did, { ...post, signature: await author.sign(post) });
    });
    await waitFor(() => expect(result.current.nodes).toHaveLength(1));

    // The attacker's wire is VALIDLY signed — over their own DID. Only the
    // author-match check in applyPostDelete stands between them and the post.
    const del = {
      type: "tc-chat:post-delete",
      id: "d2",
      surface: "chat",
      targetId: "p3",
      fromId: attacker.did,
      fromName: "Eve",
      timestamp: 456,
    };
    await act(async () => {
      eventListener?.(0, attacker.did, { ...del, signature: await attacker.sign(del) });
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(result.current.nodes[0].deleted).toBeUndefined();
    expect(result.current.nodes[0].text).toBe("mine");
    expect(relayReleasePost).not.toHaveBeenCalled();
  });

  it("REJECTS an incoming edit whose fromId is not the target post's author", async () => {
    storedBytes = new TextEncoder().encode(JSON.stringify({ text: "mine" }));
    const author = await createRemotePeer();
    const attacker = await createRemotePeer();
    const { result } = renderHook(() => usePostStream("room-1", "chat", "Alice"));

    const post = {
      type: "tc-chat:post",
      surface: "chat",
      id: "p4",
      parentId: null,
      fromId: author.did,
      fromName: "Bob",
      timestamp: 123,
      kind: "text",
      cid: "cid-remote",
    };
    await act(async () => {
      eventListener?.(0, author.did, { ...post, signature: await author.sign(post) });
    });
    await waitFor(() => expect(result.current.nodes).toHaveLength(1));

    storedBytes = new TextEncoder().encode(JSON.stringify({ text: "pwned" }));
    const edit = {
      type: "tc-chat:post-edit",
      id: "e2",
      surface: "chat",
      targetId: "p4",
      cid: "cid-evil",
      fromId: attacker.did,
      fromName: "Eve",
      timestamp: 456,
    };
    await act(async () => {
      eventListener?.(0, attacker.did, { ...edit, signature: await attacker.sign(edit) });
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(result.current.nodes[0].text).toBe("mine");
    expect(result.current.nodes[0].editedAt).toBeUndefined();
  });

  it("discards an edit wire with a tampered signature", async () => {
    storedBytes = new TextEncoder().encode(JSON.stringify({ text: "v1" }));
    const peer = await createRemotePeer();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = renderHook(() => usePostStream("room-1", "chat", "Alice"));

    const post = {
      type: "tc-chat:post",
      surface: "chat",
      id: "p5",
      parentId: null,
      fromId: peer.did,
      fromName: "Bob",
      timestamp: 123,
      kind: "text",
      cid: "cid-remote",
    };
    await act(async () => {
      eventListener?.(0, peer.did, { ...post, signature: await peer.sign(post) });
    });
    await waitFor(() => expect(result.current.nodes).toHaveLength(1));

    const edit = {
      type: "tc-chat:post-edit",
      id: "e3",
      surface: "chat",
      targetId: "p5",
      cid: "cid-v2",
      fromId: peer.did,
      fromName: "Bob",
      timestamp: 456,
    };
    await act(async () => {
      // The targetId is rewritten after signing — verifyWire must reject it.
      eventListener?.(0, peer.did, { ...edit, targetId: "p5", cid: "cid-other", signature: await peer.sign(edit) });
    });
    await waitFor(() => expect(warnSpy).toHaveBeenCalled());
    expect(result.current.nodes[0].text).toBe("v1");
    warnSpy.mockRestore();
  });

  it("clears nodes when roomId becomes null", async () => {
    const { result, rerender } = renderHook(
      ({ roomId }: { roomId: string | null }) => usePostStream(roomId, "board", "Alice"),
      { initialProps: { roomId: "room-1" as string | null } },
    );
    await act(async () => {
      await result.current.createPost({ parentId: null, kind: "text", text: "t" });
    });
    expect(result.current.nodes).toHaveLength(1);
    rerender({ roomId: null });
    expect(result.current.nodes).toHaveLength(0);
  });

  it("sweeps the room's relay pin index once on mount", async () => {
    renderHook(() => usePostStream("room-1", "chat", "Alice"));
    await waitFor(() => expect(relaySweepRoom).toHaveBeenCalledWith("room-1"));
  });

  // --- pending-tombstone race: a delete wire finishing before the post it
  // targets has finished hydrating (storage_get is slow; the delete handler
  // doesn't wait on anything comparable). See chatStore's pending-deletes map.

  it("tombstones a post whose delete raced ahead of its hydration", async () => {
    const peer = await createRemotePeer();
    const { result } = renderHook(() => usePostStream("room-1", "chat", "Alice"));

    const held = holdStorageGet("cid-race");
    const post = {
      type: "tc-chat:post",
      surface: "chat",
      id: "race-1",
      parentId: null,
      fromId: peer.did,
      fromName: "Bob",
      timestamp: 123,
      kind: "text",
      cid: "cid-race",
    };
    await act(async () => {
      eventListener?.(0, peer.did, { ...post, signature: await peer.sign(post) });
    });

    const del = {
      type: "tc-chat:post-delete",
      id: "race-del-1",
      surface: "chat",
      targetId: "race-1",
      fromId: peer.did,
      fromName: "Bob",
      timestamp: 456,
    };
    await act(async () => {
      eventListener?.(0, peer.did, { ...del, signature: await peer.sign(del) });
    });
    // The delete has fully processed by now, but the post's body fetch is
    // still held open — the node must not exist yet (nothing to no-op onto).
    await new Promise((r) => setTimeout(r, 30));
    expect(result.current.nodes).toHaveLength(0);

    await act(async () => {
      held.resolve(new TextEncoder().encode(JSON.stringify({ text: "doomed" })));
    });

    await waitFor(() => expect(result.current.nodes).toHaveLength(1));
    expect(result.current.nodes[0].deleted).toBe(true);
    expect(result.current.nodes[0].text).toBeUndefined();
    expect(result.current.nodes[0].cid).toBe("");
  });

  it("history-replay order (post then delete back-to-back) never resurrects the post", async () => {
    const peer = await createRemotePeer();
    const { result } = renderHook(() => usePostStream("room-1", "chat", "Alice"));

    const held = holdStorageGet("cid-replay");
    const post = {
      type: "tc-chat:post",
      surface: "chat",
      id: "replay-1",
      parentId: null,
      fromId: peer.did,
      fromName: "Bob",
      timestamp: 123,
      kind: "text",
      cid: "cid-replay",
    };
    const del = {
      type: "tc-chat:post-delete",
      id: "replay-del-1",
      surface: "chat",
      targetId: "replay-1",
      fromId: peer.did,
      fromName: "Bob",
      timestamp: 456,
    };
    // Sign both wires up front so dispatching them has no awaits in between —
    // mimics useHistorySync replaying the wire log back-to-back.
    const signedPost = { ...post, signature: await peer.sign(post) };
    const signedDel = { ...del, signature: await peer.sign(del) };

    await act(async () => {
      eventListener?.(0, peer.did, signedPost);
      eventListener?.(0, peer.did, signedDel);
    });
    // Give the delete (no slow fetch on its path) time to fully apply while
    // the post's body fetch is still held open.
    await new Promise((r) => setTimeout(r, 30));

    await act(async () => {
      held.resolve(new TextEncoder().encode(JSON.stringify({ text: "doomed" })));
    });

    await waitFor(() => expect(result.current.nodes).toHaveLength(1));
    expect(result.current.nodes[0].deleted).toBe(true);
    expect(result.current.nodes[0].text).toBeUndefined();
  });

  it("a raced delete from a NON-author cannot tombstone the post", async () => {
    const author = await createRemotePeer();
    const attacker = await createRemotePeer();
    const { result } = renderHook(() => usePostStream("room-1", "chat", "Alice"));

    const held = holdStorageGet("cid-race-2");
    const post = {
      type: "tc-chat:post",
      surface: "chat",
      id: "race-2",
      parentId: null,
      fromId: author.did,
      fromName: "Bob",
      timestamp: 123,
      kind: "text",
      cid: "cid-race-2",
    };
    await act(async () => {
      eventListener?.(0, author.did, { ...post, signature: await author.sign(post) });
    });

    // Validly signed over the attacker's OWN did — but they are not the
    // target post's author.
    const del = {
      type: "tc-chat:post-delete",
      id: "race-del-2",
      surface: "chat",
      targetId: "race-2",
      fromId: attacker.did,
      fromName: "Eve",
      timestamp: 456,
    };
    await act(async () => {
      eventListener?.(0, attacker.did, { ...del, signature: await attacker.sign(del) });
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(result.current.nodes).toHaveLength(0);

    await act(async () => {
      held.resolve(new TextEncoder().encode(JSON.stringify({ text: "mine" })));
    });

    await waitFor(() => expect(result.current.nodes).toHaveLength(1));
    expect(result.current.nodes[0].deleted).toBeFalsy();
    expect(result.current.nodes[0].text).toBe("mine");
  });
});
