import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const storage_get = vi.fn();
vi.mock("./mistClient", () => ({
  storage_get: (cid: string) => storage_get(cid),
}));

import { resolveStorageUrl, invalidateStorageUrl } from "./mediaUrl";
import { generatePostEnc, encryptPostBytes } from "../crypto/postCipher";

let createObjectURLSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  storage_get.mockReset();
  // happy-dom doesn't implement URL.createObjectURL — stub it so resolution
  // succeeds, and capture the Blob passed in so tests can inspect its bytes.
  createObjectURLSpy = vi.fn((_blob: Blob) => `blob:${Math.random().toString(36).slice(2)}`);
  URL.createObjectURL = createObjectURLSpy as unknown as typeof URL.createObjectURL;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("resolveStorageUrl", () => {
  it("resolves a plaintext cid to a blob URL and caches it by cid", async () => {
    storage_get.mockResolvedValueOnce(new Uint8Array([1, 2, 3]));
    const url1 = await resolveStorageUrl("plain-cid");
    expect(url1).toMatch(/^blob:/);
    expect(storage_get).toHaveBeenCalledTimes(1);

    const url2 = await resolveStorageUrl("plain-cid");
    expect(url2).toBe(url1);
    // No second fetch — served from cache.
    expect(storage_get).toHaveBeenCalledTimes(1);
  });

  it("decrypts an encrypted blob (real postCipher round-trip) before creating the object URL", async () => {
    const enc = generatePostEnc();
    const plain = new TextEncoder().encode("secret bytes for a media body");
    const cipherBlob = await encryptPostBytes(enc, plain);
    storage_get.mockResolvedValueOnce(cipherBlob);

    const url = await resolveStorageUrl("enc-cid", enc);
    expect(url).toMatch(/^blob:/);

    const passedBlob = createObjectURLSpy.mock.calls[0][0] as Blob;
    const roundTripped = new Uint8Array(await passedBlob.arrayBuffer());
    expect(roundTripped).toEqual(plain);
  });

  it("retries transient storage_get failures with backoff, then succeeds", async () => {
    vi.useFakeTimers();
    storage_get
      .mockRejectedValueOnce(new Error("transient 1"))
      .mockRejectedValueOnce(new Error("transient 2"))
      .mockResolvedValueOnce(new Uint8Array([9, 9, 9]));

    const promise = resolveStorageUrl("retry-cid");
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(2000);
    const url = await promise;

    expect(url).toMatch(/^blob:/);
    expect(storage_get).toHaveBeenCalledTimes(3);
  });

  it("gives up after 3 attempts and does not cache the failure — a later call retries", async () => {
    vi.useFakeTimers();
    storage_get.mockRejectedValue(new Error("down"));

    // Attach the rejection handler synchronously (before advancing fake
    // timers) so Node never sees the promise as transiently unhandled —
    // otherwise it fires a benign-but-noisy PromiseRejectionHandledWarning
    // since the promise settles mid-way through the timer advances below.
    const p1 = resolveStorageUrl("fail-cid");
    const rejection1 = expect(p1).rejects.toThrow("down");
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(2000);
    await rejection1;
    expect(storage_get).toHaveBeenCalledTimes(3);

    storage_get.mockClear();
    storage_get.mockRejectedValue(new Error("down again"));
    const p2 = resolveStorageUrl("fail-cid");
    const rejection2 = expect(p2).rejects.toThrow("down again");
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(2000);
    await rejection2;
    // A fresh set of 3 attempts, proving the earlier failure wasn't cached.
    expect(storage_get).toHaveBeenCalledTimes(3);
  });

  it("does not retry a decrypt failure — one storage_get call, hard failure", async () => {
    const wrongKey = generatePostEnc();
    const otherKey = generatePostEnc();
    const cipherBlob = await encryptPostBytes(otherKey, new TextEncoder().encode("hello"));
    storage_get.mockResolvedValueOnce(cipherBlob);

    await expect(resolveStorageUrl("decrypt-fail-cid", wrongKey)).rejects.toThrow();
    expect(storage_get).toHaveBeenCalledTimes(1);
  });

  it("dedupes concurrent callers for the same cid into a single storage_get", async () => {
    let releaseResult: (bytes: Uint8Array) => void = () => {};
    storage_get.mockImplementationOnce(
      () =>
        new Promise<Uint8Array>((resolve) => {
          releaseResult = resolve;
        }),
    );

    const p1 = resolveStorageUrl("dedup-cid");
    const p2 = resolveStorageUrl("dedup-cid");
    releaseResult(new Uint8Array([1]));
    const [url1, url2] = await Promise.all([p1, p2]);

    expect(url1).toBe(url2);
    expect(storage_get).toHaveBeenCalledTimes(1);
  });

  it("invalidateStorageUrl clears the cache so the next resolve re-fetches", async () => {
    storage_get.mockResolvedValueOnce(new Uint8Array([1]));
    const url1 = await resolveStorageUrl("invalidate-cid");
    expect(storage_get).toHaveBeenCalledTimes(1);

    invalidateStorageUrl("invalidate-cid");

    storage_get.mockResolvedValueOnce(new Uint8Array([2]));
    const url2 = await resolveStorageUrl("invalidate-cid");
    expect(storage_get).toHaveBeenCalledTimes(2);
    expect(url2).not.toBe(url1);
  });
});
