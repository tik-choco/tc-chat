import { describe, it, expect, beforeEach } from "vitest";
import {
  createDidIdentity,
  didKeyFromEd25519PublicKey,
  ed25519PublicKeyFromDidKey,
  ensureDidIdentity,
  ensureSharedDidIdentity,
  isEd25519DidKey,
  loadStoredDidIdentity,
  signStringWithDidIdentity,
  verifyStringWithDid,
  type DidIdentity,
  type SharedStorageBackend,
} from "./didIdentity";

function fakeBackend(): SharedStorageBackend & { records: Map<string, Uint8Array> } {
  const records = new Map<string, Uint8Array>();
  let nextId = 0;
  return {
    records,
    store: async (bytes) => {
      const cid = `cid-${nextId++}`;
      records.set(cid, bytes);
      return cid;
    },
    retrieve: async (cid) => records.get(cid),
  };
}

describe("didIdentity (ported from tc-storage)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("derives a did:key from raw ed25519 public key bytes and back (compatible with tc-storage's fixed vector)", () => {
    const publicKey = new Uint8Array(32);
    publicKey[0] = 1;
    publicKey[31] = 255;

    const did = didKeyFromEd25519PublicKey(publicKey);

    expect(did).toBe("did:key:z6MkeXATEjyXENzBXBxgC5EHk2JE5aqd7qMGGtDpLUH1e2X8");
    expect(isEd25519DidKey(did)).toBe(true);
    expect(ed25519PublicKeyFromDidKey(did)).toEqual(publicKey);
  });

  it("rejects malformed or non-Ed25519 DIDs", () => {
    expect(ed25519PublicKeyFromDidKey("not-a-did")).toBeUndefined();
    expect(isEd25519DidKey("did:key:not-ed25519")).toBe(false);
  });

  it("signs and verifies payloads, and rejects tampered ones", async () => {
    const identity = await createDidIdentity();
    const signature = await signStringWithDidIdentity(identity, "tc-chat payload");

    expect(await verifyStringWithDid(identity.did, "tc-chat payload", signature)).toBe(true);
    expect(await verifyStringWithDid(identity.did, "tampered payload", signature)).toBe(false);
  });

  it("rejects a signature checked against a different DID", async () => {
    const identity = await createDidIdentity();
    const other = await createDidIdentity();
    const signature = await signStringWithDidIdentity(identity, "payload");

    expect(other.did).not.toBe(identity.did);
    expect(await verifyStringWithDid(other.did, "payload", signature)).toBe(false);
  });

  it("ensureDidIdentity persists the private key in localStorage and reuses it", async () => {
    const first = await ensureDidIdentity();
    const second = await ensureDidIdentity();
    expect(second.did).toBe(first.did);

    const stored = loadStoredDidIdentity();
    expect(stored?.did).toBe(first.did);
  });

  it("namespaces its localStorage key separately from tc-storage's identity", async () => {
    // tc-chat and tc-storage must not clobber each other's identity when run
    // against the same browser profile/origin.
    await ensureDidIdentity();
    expect(localStorage.getItem("tc-chat-did-identity-v1")).not.toBeNull();
    expect(localStorage.getItem("tc-storage-did-identity-v1")).toBeNull();
  });

  describe("ensureSharedDidIdentity", () => {
    it("adopts the shared identity when the shared store already has one, mirroring it locally", async () => {
      const backend = fakeBackend();
      const shared = await createDidIdentity();
      const cid = await backend.store(new TextEncoder().encode(JSON.stringify(shared)));
      localStorage.setItem("tc-shared-did-identity-cid-v1", cid);

      // A different local identity must be overridden by the shared one.
      const localOnly = await createDidIdentity();
      localStorage.setItem("tc-chat-did-identity-v1", JSON.stringify(localOnly));

      const resolved = await ensureSharedDidIdentity({ backend });

      expect(resolved.did).toBe(shared.did);
      expect(resolved.did).not.toBe(localOnly.did);
      const mirrored = loadStoredDidIdentity();
      expect(mirrored?.did).toBe(shared.did);
    });

    it("promotes the local mirror to the shared store when the shared store is empty", async () => {
      const backend = fakeBackend();
      const local = await ensureDidIdentity();

      const resolved = await ensureSharedDidIdentity({ backend });

      expect(resolved.did).toBe(local.did);
      const cid = localStorage.getItem("tc-shared-did-identity-cid-v1");
      expect(cid).not.toBeNull();
      const stored = await backend.retrieve(cid!);
      const parsed = JSON.parse(new TextDecoder().decode(stored)) as DidIdentity;
      expect(parsed.did).toBe(local.did);
    });

    it("mints and shares a new identity when neither the shared store nor the local mirror has one", async () => {
      const backend = fakeBackend();

      const resolved = await ensureSharedDidIdentity({ backend });

      expect(loadStoredDidIdentity()?.did).toBe(resolved.did);
      const cid = localStorage.getItem("tc-shared-did-identity-cid-v1");
      expect(cid).not.toBeNull();
      const stored = await backend.retrieve(cid!);
      const parsed = JSON.parse(new TextDecoder().decode(stored)) as DidIdentity;
      expect(parsed.did).toBe(resolved.did);
    });

    it("falls back to the local-only identity when the shared backend throws", async () => {
      const failingBackend: SharedStorageBackend = {
        store: async () => {
          throw new Error("shared store unavailable");
        },
        retrieve: async () => {
          throw new Error("shared store unavailable");
        },
      };

      const resolved = await ensureSharedDidIdentity({ backend: failingBackend });

      expect(loadStoredDidIdentity()?.did).toBe(resolved.did);
    });
  });
});
