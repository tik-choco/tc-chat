// Resolves a mistlib storage CID to a browser blob: URL, cached per CID so the
// same content is fetched once and reused across every consumer (chat media,
// board/project/gallery thumbnails, the shared Lightbox). mistlib storage is
// content-addressed, so a CID→bytes mapping is immutable and safe to cache for
// the page lifetime.
//
// Bodies that carry an `enc` envelope (see ../crypto/postCipher) are encrypted
// at rest: the fetched bytes are IV||ciphertext and must be decrypted with the
// post's content key before they're usable. Legacy posts have no `enc` and the
// fetched bytes are the plain content as-is.
//
// storage_get has no retry of its own, and a swarm fetch can transiently fail
// (content not local yet, a relay hop drops, the author is momentarily
// unreachable) — this resolver retries the fetch a bounded number of times
// with backoff before giving up. Decryption failure is NOT retried: a bad key
// or corrupt ciphertext will never succeed on a later attempt, unlike a
// transient fetch failure.
//
// A failed resolution is never cached — the entry is dropped so a later call
// (e.g. a user-triggered retry once the poster is back online) starts fresh
// instead of being stuck replaying the same failure forever. Concurrent
// callers asking for the same cid while a resolution is in flight share the
// one outstanding promise instead of issuing duplicate fetches.
import { storage_get } from "./mistClient";
import { decryptPostBytes, type PostEnc } from "../crypto/postCipher";

const cache = new Map<string, string>();
const inFlight = new Map<string, Promise<string>>();

// Gaps between the 3 total storage_get attempts: attempt 1 immediately,
// attempt 2 after ~500ms, attempt 3 after ~2000ms more.
const RETRY_DELAYS_MS = [500, 2000];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchBytesWithRetry(cid: string): Promise<Uint8Array> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await storage_get(cid);
    } catch (error) {
      lastError = error;
      if (attempt < RETRY_DELAYS_MS.length) await delay(RETRY_DELAYS_MS[attempt]);
    }
  }
  throw lastError;
}

async function resolveInner(cid: string, enc?: PostEnc): Promise<string> {
  const bytes = await fetchBytesWithRetry(cid);
  // Decryption is a single hard attempt — no retry loop around it.
  const plain = enc ? await decryptPostBytes(enc, bytes) : bytes;
  return URL.createObjectURL(new Blob([plain.slice().buffer]));
}

/**
 * Resolves `cid` to a blob: URL, decrypting first when `enc` is present.
 * Cached by cid for the page lifetime on success; a failure is never cached,
 * so calling this again (see invalidateStorageUrl for an explicit reset)
 * naturally retries.
 */
export async function resolveStorageUrl(cid: string, enc?: PostEnc): Promise<string> {
  const cached = cache.get(cid);
  if (cached) return cached;

  const pending = inFlight.get(cid);
  if (pending) return pending;

  const promise = resolveInner(cid, enc)
    .then((url) => {
      cache.set(cid, url);
      inFlight.delete(cid);
      return url;
    })
    .catch((error: unknown) => {
      // Not cached, and no longer in flight — the next resolveStorageUrl
      // call for this cid (e.g. a retry click) starts a fresh attempt.
      inFlight.delete(cid);
      throw error;
    });
  inFlight.set(cid, promise);
  return promise;
}

/**
 * Drops any cached/in-flight resolution for `cid`, so the next
 * resolveStorageUrl(cid, ...) call re-fetches from scratch. Used by retry
 * affordances after a failed load (the poster may be back online now).
 */
export function invalidateStorageUrl(cid: string): void {
  cache.delete(cid);
  inFlight.delete(cid);
}
