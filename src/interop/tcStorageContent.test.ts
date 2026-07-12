import { describe, it, expect } from "vitest";
import { resolveTcStorageFileContent } from "./tcStorageContent";
import { bytesToBase64, toArrayBuffer } from "../crypto/cryptoEncoding";
import type { TcStorageFileEntry } from "./tcStorageFiles";

// Test-side twin of tc-storage's encryptJson (crypto.ts): PBKDF2-SHA256 →
// AES-256-GCM over the JSON bundle, wrapped in the versioned envelope. Kept
// at the real 210k iterations' *shape* but a small count so tests stay fast —
// the resolver honors the envelope's own `iterations` field.
async function encryptBundle(bundle: unknown, passphrase: string): Promise<Uint8Array> {
  const subtle = globalThis.crypto.subtle;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const iterations = 100000; // resolver reads this from the envelope
  const baseKey = await subtle.importKey(
    "raw",
    toArrayBuffer(new TextEncoder().encode(passphrase)),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const key = await subtle.deriveKey(
    { name: "PBKDF2", salt: toArrayBuffer(salt), iterations, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const cipher = await subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(new TextEncoder().encode(JSON.stringify(bundle))),
  );
  const envelope = {
    version: 1,
    algorithm: "AES-GCM",
    kdf: "PBKDF2-SHA256",
    iterations,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    cipherText: bytesToBase64(new Uint8Array(cipher)),
  };
  return new TextEncoder().encode(JSON.stringify(envelope));
}

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

function pngDataUrl(): string {
  return `data:image/png;base64,${bytesToBase64(PNG_BYTES)}`;
}

function entry(overrides: Partial<TcStorageFileEntry> = {}): TcStorageFileEntry {
  return {
    fileId: "file-1",
    folderId: "folder-1",
    name: "cat.png",
    mimeType: "image/png",
    size: PNG_BYTES.byteLength,
    cid: "cid-1",
    folderName: "写真",
    ...overrides,
  };
}

function fakeKeys(records: Record<string, unknown>): Pick<Storage, "getItem"> {
  return { getItem: (key) => (key in records ? JSON.stringify(records[key]) : null) };
}

describe("resolveTcStorageFileContent", () => {
  it("decrypts a folder-keyed envelope to the file's plaintext bytes", async () => {
    const envelope = await encryptBundle(
      { version: 1, file: { name: "cat.png", mimeType: "image/png", dataUrl: pngDataUrl() } },
      "folder-pass",
    );
    const result = await resolveTcStorageFileContent(entry(), {
      getBytes: async () => envelope,
      storage: fakeKeys({ "tc-storage-folder-keys-v1": { "folder-1": "folder-pass" } }),
    });
    expect(Array.from(result.bytes)).toEqual(Array.from(PNG_BYTES));
    expect(result.mimeType).toBe("image/png");
  });

  it("falls back to the per-file share key when the folder key is wrong", async () => {
    const envelope = await encryptBundle(
      { version: 1, file: { name: "cat.png", dataUrl: pngDataUrl() } },
      "share-pass",
    );
    const result = await resolveTcStorageFileContent(entry(), {
      getBytes: async () => envelope,
      storage: fakeKeys({
        "tc-storage-folder-keys-v1": { "folder-1": "wrong-pass" },
        "tc-storage-file-share-keys-v1": { "file-1": "share-pass" },
      }),
    });
    expect(Array.from(result.bytes)).toEqual(Array.from(PNG_BYTES));
  });

  it("passes non-envelope content through untouched with the entry's mime type", async () => {
    const result = await resolveTcStorageFileContent(entry(), {
      getBytes: async () => PNG_BYTES,
      storage: fakeKeys({}),
    });
    expect(Array.from(result.bytes)).toEqual(Array.from(PNG_BYTES));
    expect(result.mimeType).toBe("image/png");
  });

  it("throws when the content is an envelope but no local key opens it", async () => {
    const envelope = await encryptBundle(
      { version: 1, file: { name: "cat.png", dataUrl: pngDataUrl() } },
      "secret-pass",
    );
    await expect(
      resolveTcStorageFileContent(entry(), {
        getBytes: async () => envelope,
        storage: fakeKeys({}),
      }),
    ).rejects.toThrow(/no usable tc-storage key/);
  });
});
