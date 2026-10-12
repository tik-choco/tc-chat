import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureDidIdentity } from '../crypto/didIdentity';
import { signWireFields } from '../lib/wireSign';
import { encryptPostBytes, generatePostEnc } from '../crypto/postCipher';
import { collectCheckpoint, emptyCheckpoint, encodeCheckpoint, parseCheckpoint, restoreCheckpoint, mergeCheckpoints, toBase64, logOrder, fitCheckpoint, MAX_PLAIN, MAX_WIRES_PER_BUCKET } from './checkpoint';
import type { SignedWire } from '../lib/chatStore';
async function wire(fields: Record<string, unknown> = {}): Promise<SignedWire> {
  const did = await ensureDidIdentity();
  const w = { type: 'tc-chat:post', id: 'post', fromId: did.did, fromName: 'Alice', timestamp: 1, surface: 'chat', parentId: null, kind: 'text', cid: 'body', ...fields };
  return { ...w, signature: await signWireFields(w) };
}
beforeEach(() => localStorage.clear());
describe('room checkpoint', () => {
  it('collects original encrypted body and nested thumbnail, verifies every wire, and preserves names and bytes', async () => {
    const enc = generatePostEnc();
    const body = await encryptPostBytes(enc, new TextEncoder().encode(JSON.stringify({ text: 'hello', thumbCid: 'thumb' })));
    const thumb = await encryptPostBytes(enc, new Uint8Array([1, 2, 3]));
    const w = await wire({ enc });
    const storageGet = vi.fn(async (cid: string) => cid === 'body' ? body : thumb);
    const c = await collectCheckpoint('Room', [w], { storageGet });
    expect(c.blobs).toEqual([{ cid: 'body', name: 'enc.bin', bytes: toBase64(body) }, { cid: 'thumb', name: 'enc.bin', bytes: toBase64(thumb) }]);
    expect(await parseCheckpoint(encodeCheckpoint(c), 'Room')).toEqual(c);
    const received: string[] = [];
    const storageAdd = vi.fn(async (name: string, bytes: Uint8Array) => name === 'enc.bin' && bytes.length === body.length ? 'body' : 'thumb');
    await restoreCheckpoint(c, { storageAdd }, async v => { expect(storageAdd).toHaveBeenCalledTimes(2); received.push(v.id!); });
    expect(received).toEqual(['post']);
  });
  it('rejects tampering, wrong rooms/apps, unsupported wires, unreferenced blobs, malformed base64 and wrong storage names', async () => {
    const c = emptyCheckpoint('r'); c.buckets.chat = [await wire({ enc: generatePostEnc() })];
    for (const patch of [{ app: 'other' }, { roomId: 'R' }, { v: 2 }, { blobs: [{ cid: 'unrelated', name: 'enc.bin', bytes: 'AQ==' }] }, { blobs: [{ cid: 'body', name: 'wrong', bytes: 'AQ==' }] }, { blobs: [{ cid: 'body', name: 'enc.bin', bytes: '!' }] }])
      await expect(parseCheckpoint(new TextEncoder().encode(JSON.stringify({ ...c, ...patch })), 'r')).rejects.toThrow();
    c.buckets.chat[0] = { ...c.buckets.chat[0], fromName: 'Mallory' };
    await expect(parseCheckpoint(encodeCheckpoint(c), 'r')).rejects.toThrow('signed');
    c.buckets.chat = [await wire({ type: 'unknown' })];
    await expect(parseCheckpoint(encodeCheckpoint(c), 'r')).rejects.toThrow('signed');
    await expect(parseCheckpoint(new Uint8Array(MAX_PLAIN + 1), 'r')).rejects.toThrow('size');
  });
  it('reports legacy structured bodies, oversized media and unavailable blobs without fetching excluded content', async () => {
    const wires = [await wire(), await wire({ id: 'large', cid: 'large', kind: 'file', fileSize: 3 * 1024 * 1024, enc: generatePostEnc() }), await wire({ id: 'small', cid: 'small', kind: 'file', fileSize: 2, enc: generatePostEnc() })];
    const storageGet = vi.fn(async () => { throw new Error('offline'); });
    const c = await collectCheckpoint('r', wires, { storageGet });
    expect(c.omitted).toEqual([{ cid: 'body', reason: 'legacy-manifest' }, { cid: 'large', reason: 'too-large' }, { cid: 'small', reason: 'unavailable' }]);
    expect(storageGet).toHaveBeenCalledTimes(1);
    expect(logOrder(c)).toHaveLength(3);
  });
  it('preserves remote bodies when local storage cannot fetch them and unions by full signed-record hash', async () => {
    const w = await wire({ enc: generatePostEnc(), kind: 'media', fileSize: 1 });
    const a = emptyCheckpoint('r'); a.buckets.chat = [w]; a.blobs = [{ cid: 'body', name: 'enc.bin', bytes: 'AQ==' }];
    const b = emptyCheckpoint('r'); b.buckets.chat = [w, await wire({ id: 'delete', type: 'tc-chat:post-delete', targetId: 'post', timestamp: 2 })];
    const merged = await mergeCheckpoints(a, b);
    expect(logOrder(merged).map(w => w.id)).toEqual(['post', 'delete']);
    const storageGet = vi.fn(async () => { throw new Error('offline'); });
    const c = await collectCheckpoint('r', logOrder(b), { storageGet }, a);
    expect(c.blobs).toEqual(a.blobs); expect(storageGet).not.toHaveBeenCalled();
    b.buckets.chat = [await wire({ fromName: 'changed same id' })];
    expect(logOrder(await mergeCheckpoints(a, b))).toHaveLength(2);
  });
  it('drops a CID mismatch before replay and awaits receivers in log order', async () => {
    const c = emptyCheckpoint('r'); c.blobs = [{ cid: 'body', name: 'enc.bin', bytes: 'AQ==' }];
    c.buckets.chat = [await wire({ id: 'second', timestamp: 2 }), await wire({ id: 'first', timestamp: 1 })];
    const applied: string[] = []; let concurrent = 0;
    await restoreCheckpoint(c, { storageAdd: async () => 'wrong-cid' }, async w => {
      expect(c.blobs).toHaveLength(0); expect(concurrent++).toBe(0);
      await new Promise(r => setTimeout(r, 5)); applied.push(w.id!); concurrent--;
    });
    expect(applied).toEqual(['first', 'second']); expect(c.omitted[0].reason).toBe('cid-mismatch');
  });
  it('bounds collection to two concurrent requests and retries unavailable coverage on later collection', async () => {
    const wires = await Promise.all([1,2,3,4].map(i => wire({ id: String(i), cid: String(i), kind: 'file', fileSize: 1, enc: generatePostEnc() })));
    let active = 0, peak = 0;
    const storageGet = async () => { peak = Math.max(peak, ++active); await new Promise(r => setTimeout(r, 5)); active--; return new Uint8Array([1]); };
    const c = await collectCheckpoint('r', wires, { storageGet }); expect(peak).toBe(2); expect(c.blobs).toHaveLength(4);
    const failed = await collectCheckpoint('r', wires, { storageGet: async () => { throw new Error(); } });
    expect((await collectCheckpoint('r', wires, { storageGet }, failed)).omitted).toHaveLength(0);
  });
  it('fits a smaller provider by omitting bodies while retaining signed wires', async () => {
    const c = emptyCheckpoint('r'); c.buckets.chat = [await wire({ kind: 'file', fileSize: 20000, enc: generatePostEnc() })];
    const data = new Uint8Array(20000); for (let i = 0; i < data.length; i += 4096) crypto.getRandomValues(data.subarray(i, i + 4096));
    c.blobs = [{ cid: 'body', name: 'enc.bin', bytes: toBase64(data) }];
    await fitCheckpoint(c, 2048); expect(c.blobs).toHaveLength(0); expect(c.buckets.chat).toHaveLength(1); expect(c.omitted[0].reason).toBe('budget');
  });
  it('drops a thumbnail after provider fitting removes its only parent body', async () => {
    const enc = generatePostEnc();
    const body = await encryptPostBytes(enc, new TextEncoder().encode(JSON.stringify({ text: 'x', thumbCid: 'thumb' })));
    const thumb = await encryptPostBytes(enc, new Uint8Array([1, 2, 3]));
    const c = emptyCheckpoint('r'); c.buckets.chat = [await wire({ enc })];
    c.blobs = [{ cid: 'body', name: 'enc.bin', bytes: toBase64(body) }, { cid: 'thumb', name: 'enc.bin', bytes: toBase64(thumb) }];
    // Both blobs must be removed to fit this provider; references are recomputed after each drop.
    const baseline = structuredClone(c); baseline.blobs = [];
    baseline.omitted = [{ cid: 'thumb', reason: 'budget' }, { cid: 'body', reason: 'budget' }];
    const { gzip, supportsGzip } = await import('./crypto');
    const plain = encodeCheckpoint(baseline);
    const limit = (supportsGzip() ? (await gzip(plain)).length : plain.length) + 28;
    const bytes = await fitCheckpoint(c, limit);
    expect(c.blobs).toHaveLength(0);
    expect(c.omitted).toEqual(expect.arrayContaining(baseline.omitted));
    await expect(parseCheckpoint(bytes, 'r')).resolves.toBeDefined();
  });
  it('keeps a shared thumbnail when another admitted parent survives CID rejection', async () => {
    const enc = generatePostEnc();
    const body = await encryptPostBytes(enc, new TextEncoder().encode(JSON.stringify({ thumbCid: 'thumb' })));
    const thumb = await encryptPostBytes(enc, new Uint8Array([1]));
    const c = emptyCheckpoint('r');
    c.buckets.chat = [await wire({ enc }), await wire({ id: 'post2', cid: 'body2', enc })];
    c.blobs = [{ cid: 'body', name: 'enc.bin', bytes: toBase64(body) },
      { cid: 'body2', name: 'enc.bin', bytes: toBase64(body) }, { cid: 'thumb', name: 'enc.bin', bytes: toBase64(thumb) }];
    let call = 0;
    await restoreCheckpoint(c, { storageAdd: async () => ['wrong-cid', 'body2', 'thumb'][call++] }, async () => {});
    expect(c.blobs.map(b => b.cid)).toEqual(['body2', 'thumb']);
    await expect(parseCheckpoint(encodeCheckpoint(c), 'r')).resolves.toBeDefined();
  });
  it('prunes bodies and nested thumbnails when their signed parent wire is evicted', async () => {
    const enc = generatePostEnc();
    const body = await encryptPostBytes(enc, new TextEncoder().encode(JSON.stringify({ thumbCid: 'thumb' })));
    const c = emptyCheckpoint('r');
    const old = await wire({ enc });
    const recent = await wire({ type: 'tc-chat:post-delete', id: 'new', targetId: 'target', timestamp: 2 });
    // Repeated valid records exercise the fitter's independent bound without another large signing fixture.
    c.buckets.chat = [old, ...Array.from({ length: MAX_WIRES_PER_BUCKET }, () => recent)];
    c.blobs = [{ cid: 'body', name: 'enc.bin', bytes: toBase64(body) }, { cid: 'thumb', name: 'enc.bin', bytes: 'AQ==' }];
    const bytes = await fitCheckpoint(c, Infinity);
    expect(c.buckets.chat).toHaveLength(MAX_WIRES_PER_BUCKET);
    expect(c.buckets.chat).not.toContain(old); expect(c.blobs).toHaveLength(0);
    expect(c.omitted).toEqual([{ cid: 'body', reason: 'budget' }, { cid: 'thumb', reason: 'budget' }]);
    expect(c.droppedWires).toEqual({ chat: 1 });
    await expect(parseCheckpoint(bytes, 'r')).resolves.toBeDefined();
  }, 30000);
  it('rejects malformed dropped-wire diagnostics and accepts checkpoints without them', async () => {
    const c = emptyCheckpoint('r');
    await expect(parseCheckpoint(encodeCheckpoint(c), 'r')).resolves.toEqual(c);
    for (const droppedWires of [null, [], { chat: -1 }, { chat: 1.5 }, { chat: Number.MAX_SAFE_INTEGER + 1 }, { other: 1 }])
      await expect(parseCheckpoint(new TextEncoder().encode(JSON.stringify({ ...c, droppedWires })), 'r')).rejects.toThrow('diagnostic');
  });
  it('never checkpoints excluded rooms', () => { for (const room of ['global', 'tc-chat:personal']) expect(() => emptyCheckpoint(room)).toThrow('excluded'); });
});
