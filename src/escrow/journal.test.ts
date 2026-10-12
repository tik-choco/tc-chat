import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { EvidenceJournal, journalKey } from './journal';
import { appendPost, appendWireLog, loadPosts, loadWireLog } from '../lib/chatStore';
import { ensureDidIdentity } from '../crypto/didIdentity';
import { signWireFields } from '../lib/wireSign';
import { generatePostEnc, encryptPostBytes } from '../crypto/postCipher';
import { emptyCheckpoint, collectCheckpoint, MAX_WIRES_PER_BUCKET } from './checkpoint';
const kv = vi.hoisted(() => new Map<string, Uint8Array>());
vi.mock('../lib/mistClient', () => ({
  storage_kv_get: async (key: string) => kv.get(key),
  storage_kv_set: async (key: string, bytes: Uint8Array) => { kv.set(key, bytes); },
}));
beforeEach(() => { localStorage.clear(); kv.clear(); });
afterEach(() => vi.useRealTimers());
async function wire(id: string, timestamp = 1, roomId = 'journal-room') {
  const identity = await ensureDidIdentity();
  const fields = { type: 'tc-chat:post-delete', surface: 'chat', id, targetId: 'post', roomId, fromId: identity.did, fromName: 'A', timestamp };
  return { ...fields, signature: await signWireFields(fields) };
}
it('captures accepted evidence before the 600-wire log evicts it, seeds verified logs, survives restart and unions into checkpoints', async () => {
  vi.useFakeTimers();
  const identity = await ensureDidIdentity(), enc = generatePostEnc();
  const fields = { type: 'tc-chat:post', surface: 'chat' as const, roomId: 'journal-room', id: 'original', parentId: null,
    fromId: identity.did, fromName: 'A', timestamp: 1, kind: 'text' as const, cid: 'original-body', enc };
  const original = { ...fields, signature: await signWireFields(fields) };
  appendPost({ ...fields, text: 'still visible', reactions: [] });
  const body = await encryptPostBytes(enc, new TextEncoder().encode(JSON.stringify({ text: 'still visible' })));
  appendWireLog('journal-room', original);
  const edits = await Promise.all(Array.from({ length: 601 }, (_, i) => wire('edit-' + i, i + 2)));
  for (const w of edits) appendWireLog('journal-room', w);
  expect(loadWireLog('journal-room')).not.toContainEqual(original);
  expect(loadPosts('chat', 'journal-room')[0].text).toBe('still visible');
  // The singleton recorder installed in appendWireLog is the path under test.
  const { evidenceJournal } = await import('./journal');
  const journal = await evidenceJournal.snapshot('journal-room', loadWireLog('journal-room'));
  expect(journal.buckets.chat).toContainEqual(original); expect(journal.buckets.chat).toHaveLength(602);
  const restart = new EvidenceJournal();
  const recovered = await restart.snapshot('journal-room', [original, { ...original, signature: 'forged' }]);
  expect(recovered.buckets.chat).toHaveLength(602);
  const checkpoint = await collectCheckpoint('journal-room', [], { storageGet: async () => body }, recovered);
  expect(checkpoint.buckets.chat).toContainEqual(original);
  expect(kv.has(journalKey('journal-room'))).toBe(true);
});
it('keeps failed-write evidence for retry and refuses to overwrite a journal after a failed read', async () => {
  vi.useFakeTimers(); const w = await wire('retry', 1, 'retry-room');
  const set = vi.fn(async (_key: string, _bytes: Uint8Array) => {});
  const get = vi.fn(async (_key: string): Promise<Uint8Array | undefined> => undefined);
  const journal = new EvidenceJournal({ get, set });
  get.mockRejectedValueOnce(new Error('read failed')); journal.record('retry-room', w);
  await expect(journal.snapshot('retry-room')).rejects.toThrow('read failed'); expect(set).not.toHaveBeenCalled();
  set.mockRejectedValueOnce(new Error('quota'));
  await expect(journal.snapshot('retry-room')).rejects.toThrow('quota');
  expect((await journal.snapshot('retry-room')).buckets.chat).toEqual([w]);
});
it('never reads or persists global/personal evidence, rejects transplanted and invalid signed seed records', async () => {
  vi.useFakeTimers(); const get = vi.fn(async () => undefined), set = vi.fn(async () => {});
  const journal = new EvidenceJournal({ get, set }); const w = await wire('safe');
  journal.record('global', w); journal.record('tc-chat:personal', w);
  await expect(journal.snapshot('global')).rejects.toThrow('excluded'); expect(get).not.toHaveBeenCalled();
  const snapshot = await journal.snapshot('other-room', [w, { ...w, roomId: 'other-room' }]);
  expect(snapshot.buckets.chat).toEqual([]);
});
it('uses the existing newest-20,000-per-bucket policy and persists dropped diagnostics', async () => {
  vi.useFakeTimers();
  // Signatures are exercised above; use a verifier double for the large retention fixture.
  const signing = await import('../lib/wireSign'); const verify = vi.spyOn(signing, 'verifyWire').mockResolvedValue(true);
  try {
    const c = emptyCheckpoint('capacity');
    const sample = await wire('sample', 0, 'capacity');
    c.buckets.chat = Array.from({ length: MAX_WIRES_PER_BUCKET + 2 }, (_, i) => ({ ...sample, id: 'w-' + i, timestamp: i }));
    kv.set(journalKey('capacity'), new TextEncoder().encode(JSON.stringify(c)));
    const journal = new EvidenceJournal(); const result = await journal.snapshot('capacity');
    expect(result.buckets.chat).toHaveLength(MAX_WIRES_PER_BUCKET);
    expect(result.buckets.chat[0].timestamp).toBe(2); expect(result.droppedWires?.chat).toBe(2);
    expect((await new EvidenceJournal().snapshot('capacity')).droppedWires?.chat).toBe(2);
  } finally { verify.mockRestore(); }
});
