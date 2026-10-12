import { afterEach, expect, it, vi } from 'vitest';
import { EvidenceJournal, journalKey } from '../journal';
import { ensureDidIdentity } from '../../crypto/didIdentity';
import { signWireFields } from '../../lib/wireSign';
vi.mock('../../lib/mistClient', () => ({
  storage_kv_get: async () => undefined,
  storage_kv_set: async () => {},
}));
afterEach(() => vi.useRealTimers());

it('two tabs must preserve the union of acknowledged journal writes', async () => {
  localStorage.clear(); vi.useFakeTimers();
  const kv = new Map<string, Uint8Array>();
  const storage = {
    get: async (k: string) => kv.get(k),
    set: async (k: string, b: Uint8Array) => { kv.set(k, b); },
  };
  const tabA = new EvidenceJournal(storage), tabB = new EvidenceJournal(storage);
  const roomId = 'shared-dm';
  // Both tabs open the same origin/room before either receives new evidence.
  await tabA.snapshot(roomId); await tabB.snapshot(roomId);
  const identity = await ensureDidIdentity();
  async function wire(id: string, timestamp: number) {
    const fields = {
      type: 'tc-chat:post-delete', surface: 'chat', roomId, id,
      targetId: 'post', fromId: identity.did, fromName: 'Alice', timestamp,
    };
    return { ...fields, signature: await signWireFields(fields) };
  }
  const a = await wire('tab-A-evidence', 1), b = await wire('tab-B-evidence', 2);
  tabA.record(roomId, a); await tabA.snapshot(roomId); // write resolves successfully
  tabB.record(roomId, b); await tabB.snapshot(roomId); // also resolves successfully
  expect(kv.has(journalKey(roomId))).toBe(true);
  const restart = await new EvidenceJournal(storage).snapshot(roomId);
  expect(restart.buckets.chat.map(w => w.id).sort())
    .toEqual(['tab-A-evidence', 'tab-B-evidence']);
});

it('concurrent tab writes reread under the same exclusive room lock', async () => {
  localStorage.clear(); vi.useFakeTimers();
  const kv = new Map<string, Uint8Array>();
  let readers = 0, maxReaders = 0;
  const storage = {
    get: async (key: string) => {
      readers++; maxReaders = Math.max(maxReaders, readers);
      await Promise.resolve();
      const bytes = kv.get(key); readers--; return bytes;
    },
    set: async (key: string, bytes: Uint8Array) => { await Promise.resolve(); kv.set(key, bytes); },
  };
  const a = new EvidenceJournal(storage), b = new EvidenceJournal(storage);
  const identity = await ensureDidIdentity(), roomId = 'concurrent-dm';
  async function signed(id: string) {
    const fields = { type: 'tc-chat:post-delete', surface: 'chat', roomId, id,
      targetId: 'post', fromId: identity.did, fromName: 'A', timestamp: 1 };
    return { ...fields, signature: await signWireFields(fields) };
  }
  await Promise.all([a.snapshot(roomId), b.snapshot(roomId)]);
  a.record(roomId, await signed('A')); b.record(roomId, await signed('B'));
  await Promise.all([a.snapshot(roomId), b.snapshot(roomId)]);
  expect(maxReaders).toBe(1);
  expect((await new EvidenceJournal(storage).snapshot(roomId)).buckets.chat.map(w => w.id).sort()).toEqual(['A', 'B']);
  // A failed reread after initialization must never replace another tab's evidence.
  const get = vi.spyOn(storage, 'get').mockRejectedValueOnce(new Error('read failure'));
  await expect(a.snapshot(roomId)).rejects.toThrow('read failure'); get.mockRestore();
  expect((await b.snapshot(roomId)).buckets.chat).toHaveLength(2);
});
