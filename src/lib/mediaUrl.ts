// Resolves a mistlib storage CID to a browser blob: URL, cached per CID so the
// same content is fetched once and reused (avatars, images). mistlib storage is
// content-addressed, so a CID→bytes mapping is immutable and safe to cache for
// the page lifetime.
import { storage_get } from "./mistClient";

const cache = new Map<string, string>();

export async function resolveStorageUrl(cid: string, type?: string): Promise<string> {
  const cached = cache.get(cid);
  if (cached) return cached;
  const bytes = await storage_get(cid);
  const url = URL.createObjectURL(
    new Blob([bytes.slice().buffer], type ? { type } : undefined),
  );
  cache.set(cid, url);
  return url;
}
