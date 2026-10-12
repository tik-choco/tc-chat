import { beforeEach, expect, it, vi } from 'vitest';
import { ensureDidIdentity } from '../crypto/didIdentity';
import { signWireFields } from '../lib/wireSign';
import { generatePostEnc } from '../crypto/postCipher';
import { collectCheckpoint, encodeCheckpoint, emptyCheckpoint, fitCheckpoint, MAX_RAW, MAX_PLAIN, mergeCheckpoints, parseCheckpoint, toBase64 } from './checkpoint';

beforeEach(() => localStorage.clear());
async function post(id: string) {
  const identity = await ensureDidIdentity();
  const fields = { type: 'tc-chat:post', id, fromId: identity.did, fromName: 'A', timestamp: 1,
    surface: 'chat', parentId: null, kind: 'file', cid: id, fileSize: 2 * 1024 * 1024, enc: generatePostEnc() };
  return { ...fields, signature: await signWireFields(fields) };
}
it('fits the union of two individually admissible checkpoints to the raw budget', async () => {
  const a = emptyCheckpoint('r'), b = emptyCheckpoint('r');
  const bytes = toBase64(new Uint8Array(2 * 1024 * 1024));
  for (let i = 0; i < 12; i++) {
    const c = i < 6 ? a : b, id = 'file-' + i;
    c.buckets.chat.push(await post(id));
    c.blobs.push({ cid: id, name: 'enc.bin', bytes });
  }
  await parseCheckpoint(encodeCheckpoint(a), 'r');
  await parseCheckpoint(encodeCheckpoint(b), 'r');
  const merged = await mergeCheckpoints(a, b);
  // Collection also normalizes a retained oversized CAS union before encoding.
  const storageGet = vi.fn(async () => { throw new Error('remote bodies already available'); });
  const collected = await collectCheckpoint('r', [], { storageGet }, merged);
  expect(collected.buckets.chat).toHaveLength(12);
  expect(collected.blobs).toHaveLength(10);
  expect(collected.omitted).toHaveLength(2);
  expect(storageGet).not.toHaveBeenCalled();
  await parseCheckpoint(encodeCheckpoint(collected), 'r');
  const fitted = await fitCheckpoint(merged, 32 * 1024 * 1024);
  expect(fitted.length).toBeLessThanOrEqual(MAX_PLAIN);
  const restored = await parseCheckpoint(fitted, 'r');
  expect(restored.buckets.chat).toHaveLength(12);
  expect(restored.blobs.length * 2 * 1024 * 1024).toBeLessThanOrEqual(MAX_RAW);
  expect(restored.omitted.length).toBeGreaterThan(0);
}, 30000);
