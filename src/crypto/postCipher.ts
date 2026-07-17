// Per-post content encryption (AES-256-GCM) for relay-cached post bodies.
//
// Post bodies are encrypted BEFORE storage_add, so everything at rest —
// browser OPFS block stores, native block stores (mistlib's NativeBlockStore
// writes every block, including blocks fetched on behalf of other peers,
// verbatim to plain files on disk) — is opaque ciphertext. The random content
// key travels inside the *signed* wire (`enc` field): every room member
// necessarily holds the wire, so decryption is transparent to them, but a
// disk image alone (without the room's wire stream) yields nothing. The wire
// signature covers `enc`, so a relay cannot substitute a key.
//
// Blob layout: 12-byte random IV || ciphertext || 16-byte GCM tag. The IV
// lives in the blob rather than the wire so a single post key can safely
// encrypt several blobs (body JSON + thumbnail bytes) with distinct IVs.
import { base64ToBytes, bytesToBase64, toArrayBuffer } from "./cryptoEncoding";

/** Content-key envelope carried on the signed wire alongside the CID. */
export interface PostEnc {
  v: 1;
  alg: "A256GCM";
  /** base64 of the raw 32-byte AES key. */
  key: string;
}

const IV_BYTES = 12;
const KEY_BYTES = 32;

export function generatePostEnc(): PostEnc {
  const key = crypto.getRandomValues(new Uint8Array(KEY_BYTES));
  return { v: 1, alg: "A256GCM", key: bytesToBase64(key) };
}

export function isPostEnc(value: unknown): value is PostEnc {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.v === 1 && candidate.alg === "A256GCM" && typeof candidate.key === "string";
}

async function importPostKey(enc: PostEnc): Promise<CryptoKey> {
  const raw = base64ToBytes(enc.key);
  if (raw.length !== KEY_BYTES) throw new Error("postCipher: invalid key length");
  return crypto.subtle.importKey("raw", toArrayBuffer(raw), { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/** Encrypts plaintext into an IV-prefixed blob suitable for storage_add. */
export async function encryptPostBytes(enc: PostEnc, plain: Uint8Array): Promise<Uint8Array> {
  const key = await importPostKey(enc);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, toArrayBuffer(plain));
  const blob = new Uint8Array(IV_BYTES + cipher.byteLength);
  blob.set(iv, 0);
  blob.set(new Uint8Array(cipher), IV_BYTES);
  return blob;
}

/** Decrypts an IV-prefixed blob produced by encryptPostBytes. */
export async function decryptPostBytes(enc: PostEnc, blob: Uint8Array): Promise<Uint8Array> {
  if (blob.length <= IV_BYTES) throw new Error("postCipher: blob too short");
  const key = await importPostKey(enc);
  const iv = blob.slice(0, IV_BYTES);
  const cipher = blob.slice(IV_BYTES);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(cipher),
  );
  return new Uint8Array(plain);
}
