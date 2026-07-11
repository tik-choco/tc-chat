import { describe, it, expect, beforeEach } from "vitest";
import {
  acceptFriend,
  computeDmRoomId,
  loadFriends,
  removeFriend,
  upsertRequest,
} from "./friendsStore";

describe("friendsStore", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("loads an empty list when nothing is stored", () => {
    expect(loadFriends()).toEqual([]);
  });

  it("migrates legacy entries stored without a status to accepted", () => {
    localStorage.setItem(
      "tc-chat:friends",
      JSON.stringify([{ did: "did:key:bob", name: "Bob", addedAt: 1, roomId: "dm-abc" }]),
    );
    expect(loadFriends()).toEqual([
      { did: "did:key:bob", name: "Bob", addedAt: 1, roomId: "dm-abc", status: "accepted" },
    ]);
  });

  describe("upsertRequest", () => {
    it("adds a new outgoing request as pending-out", () => {
      const next = upsertRequest("did:key:bob", "Bob", "dm-abc", "out");
      expect(next).toHaveLength(1);
      expect(next[0]).toMatchObject({ did: "did:key:bob", status: "pending-out" });
    });

    it("adds a new incoming request as pending-in", () => {
      const next = upsertRequest("did:key:bob", "Bob", "dm-abc", "in");
      expect(next).toHaveLength(1);
      expect(next[0]).toMatchObject({ did: "did:key:bob", status: "pending-in" });
    });

    it("promotes pending-out to accepted when the peer's request arrives", () => {
      upsertRequest("did:key:bob", "Bob", "dm-abc", "out");
      const next = upsertRequest("did:key:bob", "Bob", "dm-abc", "in");
      expect(next).toHaveLength(1);
      expect(next[0].status).toBe("accepted");
    });

    it("promotes pending-in to accepted when we send our own request back", () => {
      upsertRequest("did:key:bob", "Bob", "dm-abc", "in");
      const next = upsertRequest("did:key:bob", "Bob", "dm-abc", "out");
      expect(next).toHaveLength(1);
      expect(next[0].status).toBe("accepted");
    });

    it("leaves an accepted friend unchanged", () => {
      upsertRequest("did:key:bob", "Bob", "dm-abc", "out");
      upsertRequest("did:key:bob", "Bob", "dm-abc", "in");
      const next = upsertRequest("did:key:bob", "Bob (renamed)", "dm-xyz", "out");
      expect(next[0]).toMatchObject({ name: "Bob", roomId: "dm-abc", status: "accepted" });
    });

    it("ignores a duplicate request in the same direction", () => {
      upsertRequest("did:key:bob", "Bob", "dm-abc", "out");
      const next = upsertRequest("did:key:bob", "Bob (renamed)", "dm-xyz", "out");
      expect(next).toHaveLength(1);
      expect(next[0]).toMatchObject({ name: "Bob", roomId: "dm-abc", status: "pending-out" });
    });
  });

  describe("acceptFriend", () => {
    it("marks a pending entry accepted", () => {
      upsertRequest("did:key:bob", "Bob", "dm-abc", "in");
      const next = acceptFriend("did:key:bob");
      expect(next[0].status).toBe("accepted");
    });

    it("is idempotent when called again on an already-accepted entry", () => {
      upsertRequest("did:key:bob", "Bob", "dm-abc", "in");
      acceptFriend("did:key:bob");
      const next = acceptFriend("did:key:bob");
      expect(next).toHaveLength(1);
      expect(next[0].status).toBe("accepted");
    });

    it("is a no-op when the did is absent", () => {
      expect(acceptFriend("did:key:missing")).toEqual([]);
    });
  });

  describe("removeFriend", () => {
    it("removes a friend by did", () => {
      upsertRequest("did:key:bob", "Bob", "dm-abc", "out");
      upsertRequest("did:key:carol", "Carol", "dm-def", "out");
      removeFriend("did:key:bob");
      expect(loadFriends().map((f) => f.did)).toEqual(["did:key:carol"]);
    });

    it("is a no-op when the did is absent", () => {
      upsertRequest("did:key:carol", "Carol", "dm-def", "out");
      const next = removeFriend("did:key:missing");
      expect(next.map((f) => f.did)).toEqual(["did:key:carol"]);
    });
  });

  it("computeDmRoomId is deterministic and symmetric regardless of argument order", async () => {
    const a = await computeDmRoomId("did:key:alice", "did:key:bob");
    const b = await computeDmRoomId("did:key:bob", "did:key:alice");
    expect(a).toBe(b);
    expect(a).toMatch(/^dm-[0-9a-f]{32}$/);
  });

  it("computeDmRoomId differs for a different pair", async () => {
    const ab = await computeDmRoomId("did:key:alice", "did:key:bob");
    const ac = await computeDmRoomId("did:key:alice", "did:key:carol");
    expect(ab).not.toBe(ac);
  });
});
