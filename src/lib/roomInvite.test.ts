import { describe, it, expect, vi, beforeEach } from "vitest";

const sendMessage = vi.fn();
const isRoomJoined = vi.fn((_roomId: string) => true);
const joinRoomAsync = vi.fn(async (_roomId: string) => {});
let storedBytes: Uint8Array | null = null;

vi.mock("./mistClient", () => ({
  getNode: vi.fn(async () => ({ sendMessage, isRoomJoined, joinRoomAsync })),
  storage_add: vi.fn(async (_name: string, bytes: Uint8Array) => {
    storedBytes = bytes;
    return "cid-invite";
  }),
  DELIVERY_RELIABLE: 1,
}));

import { buildInviteUrl, sendInviteDm, MAX_INVITE_NAME } from "./roomInvite";
import { verifyWire } from "./wireSign";
import { decryptPostBytes, isPostEnc } from "../crypto/postCipher";
import { loadPosts, loadWireLog } from "./chatStore";

const BASE = "https://example.test/tc-chat/";

describe("buildInviteUrl", () => {
  it("deep-links the room in the hash and carries its name", () => {
    expect(buildInviteUrl("room-1", "みんなの部屋", BASE)).toBe(
      `${BASE}?name=${encodeURIComponent("みんなの部屋")}#/room-1`,
    );
  });

  it("omits the name when it adds nothing over the id", () => {
    expect(buildInviteUrl("room-1", "room-1", BASE)).toBe(`${BASE}#/room-1`);
    expect(buildInviteUrl("room-1", "   ", BASE)).toBe(`${BASE}#/room-1`);
    expect(buildInviteUrl("room-1", undefined, BASE)).toBe(`${BASE}#/room-1`);
  });

  it("caps the name so a long label can't bloat the link (and its QR)", () => {
    const long = "あ".repeat(MAX_INVITE_NAME + 20);
    const url = buildInviteUrl("room-1", long, BASE);
    expect(url).toBe(`${BASE}?name=${encodeURIComponent("あ".repeat(MAX_INVITE_NAME))}#/room-1`);
  });

  it("percent-encodes the room id, so it round-trips through the hash codec", () => {
    expect(buildInviteUrl("a/b c", "x", BASE)).toBe(`${BASE}?name=x#/a%2Fb%20c`);
  });
});

describe("sendInviteDm", () => {
  beforeEach(() => {
    localStorage.clear();
    sendMessage.mockClear();
    joinRoomAsync.mockClear();
    isRoomJoined.mockReturnValue(true);
    storedBytes = null;
  });

  it("broadcasts a signed, encrypted text post scoped to the DM room", async () => {
    await sendInviteDm("dm-abc", "ぼく", "「部屋」に招待します\nhttps://example.test/#/room-1");

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [target, wire, delivery, roomId] = sendMessage.mock.calls[0];
    expect(target).toBeNull();
    expect(delivery).toBe(1);
    expect(roomId).toBe("dm-abc"); // room-scoped: never leaks to another swarm

    expect(wire.type).toBe("tc-chat:post");
    expect(wire.surface).toBe("chat");
    expect(wire.kind).toBe("text");
    expect(wire.parentId).toBeNull();
    expect(await verifyWire(wire)).toBe(true);

    // The body is encrypted at rest under the wire's own content key.
    expect(isPostEnc(wire.enc)).toBe(true);
    const plain = await decryptPostBytes(wire.enc, storedBytes!);
    expect(JSON.parse(new TextDecoder().decode(plain))).toEqual({
      text: "「部屋」に招待します\nhttps://example.test/#/room-1",
    });
  });

  it("persists the sent invite locally so it's there when the DM is opened", async () => {
    await sendInviteDm("dm-abc", "ぼく", "invite text");

    const posts = loadPosts("chat", "dm-abc");
    expect(posts).toHaveLength(1);
    expect(posts[0].text).toBe("invite text");
    expect(posts[0].kind).toBe("text");
    // Logged too, so history sync can replay it to the friend.
    expect(loadWireLog("dm-abc").filter((w) => w.type === "tc-chat:post")).toHaveLength(1);
  });

  it("joins the DM swarm first when it isn't joined yet", async () => {
    isRoomJoined.mockReturnValue(false);
    await sendInviteDm("dm-abc", "ぼく", "invite text");
    expect(joinRoomAsync).toHaveBeenCalledWith("dm-abc");
  });

  it("doesn't rejoin a swarm that's already joined", async () => {
    await sendInviteDm("dm-abc", "ぼく", "invite text");
    expect(joinRoomAsync).not.toHaveBeenCalled();
  });
});
