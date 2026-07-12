// Resolves a tc-storage file entry to its PLAINTEXT bytes.
//
// tc-storage never puts raw file bytes into mistlib storage: every file CID
// (FileRecord.lastCid / lastShareCid) points at a JSON `EncryptedPayload`
// envelope — AES-256-GCM over a `FileBundle` whose `file.dataUrl` holds the
// actual content, keyed by a passphrase derived with PBKDF2-SHA256 (see
// tc-storage/src/crypto/crypto.ts and storage/mistStorage.ts). So attaching a
// tc-storage file "by CID" would hand peers ciphertext they can never decrypt.
//
// The passphrases live in tc-storage's same-origin localStorage:
//   - "tc-storage-folder-keys-v1"      folderId -> folder passphrase (lastCid)
//   - "tc-storage-file-share-keys-v1"  fileId -> share passphrase (lastShareCid)
// Both candidates are tried, since the snapshot entry doesn't record which of
// the two CIDs it exposed. Content that is NOT an envelope (bytes some other
// app stored raw under a CID) passes through untouched.
import { storage_get } from "../lib/mistClient";
import { base64ToBytes, toArrayBuffer } from "../crypto/cryptoEncoding";
import type { TcStorageFileEntry } from "./tcStorageFiles";

const FOLDER_KEYS_KEY = "tc-storage-folder-keys-v1";
const FILE_SHARE_KEYS_KEY = "tc-storage-file-share-keys-v1";

/** Mirror of tc-storage's AesGcmPayload (crypto.ts). */
interface EncryptedPayload {
  version: 1;
  algorithm: "AES-GCM";
  kdf: "PBKDF2-SHA256";
  iterations: number;
  salt: string;
  iv: string;
  cipherText: string;
}

/** The subset of tc-storage's FileBundle this module reads after decryption. */
interface FileBundle {
  file?: { dataUrl?: string; mimeType?: string };
}

export interface TcStorageFileContent {
  bytes: Uint8Array;
  mimeType: string;
}

/** Injectable I/O so tests don't need mistlib or a real localStorage. */
export interface TcStorageContentDeps {
  getBytes?: (cid: string) => Promise<Uint8Array>;
  storage?: Pick<Storage, "getItem">;
}

function parseEnvelope(bytes: Uint8Array): EncryptedPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const p = parsed as Partial<EncryptedPayload>;
  if (p.version !== 1 || p.algorithm !== "AES-GCM" || p.kdf !== "PBKDF2-SHA256") return null;
  if (
    typeof p.iterations !== "number" ||
    typeof p.salt !== "string" ||
    typeof p.iv !== "string" ||
    typeof p.cipherText !== "string"
  ) {
    return null;
  }
  return p as EncryptedPayload;
}

function loadKeyRecord(storage: Pick<Storage, "getItem">, key: string): Record<string, string> {
  try {
    const raw = storage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (!parsed || typeof parsed !== "object") return {};
    const record: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string" && v) record[k] = v;
    }
    return record;
  } catch {
    return {};
  }
}

async function decryptEnvelope(payload: EncryptedPayload, passphrase: string): Promise<Uint8Array> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Web Crypto API unavailable");
  const baseKey = await subtle.importKey(
    "raw",
    toArrayBuffer(new TextEncoder().encode(passphrase.trim())),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const key = await subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: toArrayBuffer(base64ToBytes(payload.salt)),
      iterations: payload.iterations,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  const decrypted = await subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(base64ToBytes(payload.iv)) },
    key,
    toArrayBuffer(base64ToBytes(payload.cipherText)),
  );
  return new Uint8Array(decrypted);
}

function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; mimeType: string } | null {
  const comma = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || comma < 0) return null;
  const header = dataUrl.slice(5, comma); // e.g. "image/png;base64"
  const body = dataUrl.slice(comma + 1);
  const mimeType = header.split(";")[0] ?? "";
  const bytes = header.includes(";base64")
    ? base64ToBytes(body)
    : new TextEncoder().encode(decodeURIComponent(body));
  return { bytes, mimeType };
}

/**
 * Fetches a tc-storage entry's CID and returns the file's plaintext bytes,
 * decrypting the tc-storage envelope with whichever local key fits (folder key
 * first, per-file share key second). Non-envelope content is returned as-is.
 * Throws when the content is an envelope but no local key can open it — the
 * caller must NOT fall back to posting the ciphertext CID.
 */
export async function resolveTcStorageFileContent(
  entry: TcStorageFileEntry,
  deps: TcStorageContentDeps = {},
): Promise<TcStorageFileContent> {
  const getBytes = deps.getBytes ?? storage_get;
  const storage = deps.storage ?? localStorage;

  const raw = await getBytes(entry.cid);
  const envelope = parseEnvelope(raw);
  if (!envelope) return { bytes: raw, mimeType: entry.mimeType };

  const candidates = [
    loadKeyRecord(storage, FOLDER_KEYS_KEY)[entry.folderId],
    loadKeyRecord(storage, FILE_SHARE_KEYS_KEY)[entry.fileId],
  ].filter((k): k is string => Boolean(k));

  for (const passphrase of candidates) {
    let bundle: FileBundle;
    try {
      const plain = await decryptEnvelope(envelope, passphrase);
      bundle = JSON.parse(new TextDecoder().decode(plain)) as FileBundle;
    } catch {
      continue; // wrong key for this envelope — try the next candidate
    }
    const dataUrl = bundle.file?.dataUrl;
    const decoded = dataUrl ? dataUrlToBytes(dataUrl) : null;
    if (!decoded) break; // decrypted fine but no content — nothing else will open it
    return { bytes: decoded.bytes, mimeType: decoded.mimeType || entry.mimeType };
  }
  throw new Error(`no usable tc-storage key for file ${entry.fileId}`);
}
