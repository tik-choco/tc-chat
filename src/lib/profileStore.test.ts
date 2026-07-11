import { describe, it, expect, beforeEach } from "vitest";
import { readSharedProfile, publishSharedProfile } from "./profileStore";
import type { SharedStorageBackend } from "../crypto/didIdentity";

const SHARED_CID_KEY = "tc-shared-profile-cid-v1";
const enc = new TextEncoder();
const dec = new TextDecoder();

function makeBackend(): SharedStorageBackend {
  const store = new Map<string, Uint8Array>();
  let n = 0;
  return {
    store: async (bytes: Uint8Array) => {
      const cid = `cid-${++n}`;
      store.set(cid, bytes);
      return cid;
    },
    retrieve: async (cid: string) => store.get(cid),
  };
}

async function seed(backend: SharedStorageBackend, record: unknown) {
  const cid = await backend.store(enc.encode(JSON.stringify(record)));
  localStorage.setItem(SHARED_CID_KEY, cid);
}

async function readCurrentRecord(backend: SharedStorageBackend) {
  const cid = localStorage.getItem(SHARED_CID_KEY)!;
  return JSON.parse(dec.decode((await backend.retrieve(cid))!));
}

describe("profileStore shared interop", () => {
  beforeEach(() => localStorage.clear());

  it("reads a tc-vrsns2-style record tolerantly (name → displayName, surfaces vrm)", async () => {
    const backend = makeBackend();
    await seed(backend, {
      version: 1,
      name: "Neo",
      did: "did:key:zx",
      updatedAt: "t",
      vrm: "vrm-cid",
    });

    const profile = await readSharedProfile("did:key:zx", backend);
    expect(profile?.displayName).toBe("Neo");
    expect(profile?.vrm).toBe("vrm-cid");
  });

  it("publishes an interoperable superset and preserves foreign fields (vrm)", async () => {
    const backend = makeBackend();
    // Pre-existing record written by tc-vrsns2 (has a VRM avatar CID).
    await seed(backend, { version: 1, name: "Old", did: "did:key:zx", updatedAt: "t0", vrm: "vrm-1" });

    await publishSharedProfile(
      { did: "did:key:zx", displayName: "Alice", bio: "hi", avatar: "img-cid", vrm: "" },
      backend,
    );

    const rec = await readCurrentRecord(backend);
    expect(rec.display_name).toBe("Alice");
    expect(rec.name).toBe("Alice"); // tc-vrsns2 reads `name`
    expect(rec.bio).toBe("hi");
    expect(rec.avatar).toBe("img-cid");
    expect(rec.did).toBe("did:key:zx");
    expect(rec.version).toBe(1);
    expect(typeof rec.updatedAt).toBe("string");
    expect(rec.vrm).toBe("vrm-1"); // preserved, not clobbered
  });

  it("round-trips its own writes", async () => {
    const backend = makeBackend();
    await publishSharedProfile(
      { did: "d", displayName: "Bob", bio: "", avatar: "a", vrm: "" },
      backend,
    );
    const profile = await readSharedProfile("d", backend);
    expect(profile?.displayName).toBe("Bob");
    expect(profile?.avatar).toBe("a");
  });
});
