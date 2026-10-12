import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomEscrowController } from './controller';
import type { RoomEscrowClient } from './controller';
import type { EscrowTransport, PutResult, CheckpointOptions } from './client';
import { emptyCheckpoint, encodeCheckpoint, SCHEMA } from './checkpoint';
import * as checkpointModule from './checkpoint';
import { vector } from './vectors.fixture';
import { ensureDidIdentity } from '../crypto/didIdentity';
import { signWireFields } from '../lib/wireSign';
import type { SignedWire } from '../lib/chatStore';
import { headHash } from './head';
const transport: EscrowTransport = { join: async () => {}, leave() {}, send() {}, onMessage: () => () => {}, onPeer: () => () => {}, storageAdd: async () => 'cid', storageGet: async () => new Uint8Array() };
let controllers: RoomEscrowController[] = [];
function setup(wires: SignedWire[] = []) {
  const providers = new Map<string, { maxBlob: number }>();
  let provider = () => {};
  const fetchLatest = vi.fn<RoomEscrowClient['fetchLatest']>(async () => null);
  const saveCheckpoint = vi.fn<RoomEscrowClient['saveCheckpoint']>(async (_app, _room, _bytes, options) => {
    const head = { ...vector.head_signed, seq: options.seq, parent: options.parent, schema: SCHEMA };
    return { type: 'ack', seq: head.seq, hash: await headHash(head), slot: head.slot, head };
  });
  const client: RoomEscrowClient = { providers, join: vi.fn(async () => {}), onProvider(cb) { provider = cb; return () => { provider = () => {}; }; }, fetchLatest, saveCheckpoint, dispose: vi.fn() };
  const receive = vi.fn(async (_wire: SignedWire) => {});
  const c = new RoomEscrowController({ roomId: 'r', wires: () => wires, receive, changed() {} }, transport, () => client);
  controllers.push(c);
  return { c, client, fetchLatest, saveCheckpoint, receive, provider: () => { providers.set('daemon', { maxBlob: 32 * 1024 * 1024 }); provider(); } };
}
async function ready(s: ReturnType<typeof setup>) {
  await s.c.configure({ mode: 'custom', mistlRoom: 'daemon' }); s.provider();
  await vi.waitFor(() => expect(s.c.view.status).toBe('ready'));
}
beforeEach(() => { localStorage.clear(); controllers = []; });
afterEach(async () => { await Promise.all(controllers.map(c => c.dispose())); vi.useRealTimers(); });
describe('active room escrow controller', () => {
  it('does not fetch/save or gate restore without a provider; listens for a late provider', async () => {
    const s = setup(); await s.c.configure({ mode: 'custom', mistlRoom: 'daemon' });
    expect(s.c.view.status).toBe('searching'); expect(s.fetchLatest).not.toHaveBeenCalled(); await s.c.flush(); expect(s.saveCheckpoint).not.toHaveBeenCalled();
    expect(localStorage.getItem('tc-chat:escrow:v1:r')).toBeNull();
    s.provider(); await vi.waitFor(() => expect(s.c.view.status).toBe('ready')); expect(s.fetchLatest).toHaveBeenCalledTimes(1);
  });
  it('blocks writes until provider fetch completes and advances watermarks only after ACK', async () => {
    const s = setup(); let resolve!: (v: null) => void; s.fetchLatest.mockImplementation(() => new Promise(r => { resolve = r; }));
    await s.c.configure({ mode: 'custom', mistlRoom: 'daemon' }); s.provider();
    await s.c.flush(); expect(s.saveCheckpoint).not.toHaveBeenCalled(); expect(s.c.view.status).toBe('restoring');
    resolve(null); await vi.waitFor(() => expect(s.c.view.status).toBe('ready'));
    expect(JSON.parse(localStorage.getItem('tc-chat:escrow:v1:r')!).daemon.lastSeq).toBe(0);
    await s.c.flush(); expect(s.c.view.status).toBe('saved'); expect(JSON.parse(localStorage.getItem('tc-chat:escrow:v1:r')!).daemon.lastSeq).toBe(1);
  });
  it('keeps dirty state on provider errors and retries without advancing ACK watermarks', async () => {
    const s = setup(); await ready(s);
    s.saveCheckpoint.mockResolvedValueOnce({ type: 'error', code: 'busy', message: 'try later' });
    await s.c.flush(); expect(s.c.view.status).toBe('error'); expect(s.c.view.savedAt).toBe(0);
    expect(JSON.parse(localStorage.getItem('tc-chat:escrow:v1:r')!).daemon.lastSeq).toBe(0);
    await s.c.retryNow(); expect(s.saveCheckpoint).toHaveBeenCalledTimes(2); expect(s.c.view.status).toBe('saved');
  });
  it.each([false, true])('rejects final fitted bytes before PUT and preserves ACK state (CAS retry: %s)', async conflict => {
    const s = setup(); await ready(s); await s.c.flush();
    const previous = localStorage.getItem('tc-chat:escrow:v1:r'), savedAt = s.c.view.savedAt;
    const previousHead = { ...vector.head_signed, schema: SCHEMA };
    const conflictingHead = { ...previousHead, seq: 2, parent: await headHash(previousHead) };
    if (conflict) {
      s.saveCheckpoint.mockResolvedValueOnce({ type: 'conflict', head: conflictingHead });
      s.fetchLatest.mockResolvedValueOnce({ head: conflictingHead, plaintext: encodeCheckpoint(emptyCheckpoint('r')) });
    }
    const fit = checkpointModule.fitCheckpoint;
    const spy = vi.spyOn(checkpointModule, 'fitCheckpoint');
    if (conflict) spy.mockImplementationOnce(fit);
    spy.mockImplementationOnce(async (c, maxBlob) => {
      const bytes = await fit(c, maxBlob);
      // The checkpoint object remains valid; only the exact bytes headed for PUT are corrupt.
      const payload = JSON.parse(new TextDecoder().decode(bytes)); payload.roomId = 'other';
      return new TextEncoder().encode(JSON.stringify(payload));
    });
    try {
      s.c.markDirty(); await s.c.flush();
      expect(s.c.view.status).toBe('error'); expect(s.c.view.reason).toBe('Invalid checkpoint');
      expect(s.c.view.savedAt).toBe(savedAt);
      expect(localStorage.getItem('tc-chat:escrow:v1:r')).toBe(previous);
      expect(s.saveCheckpoint).toHaveBeenCalledTimes(conflict ? 2 : 1);
      await s.c.retryNow();
      expect(s.c.view.status).toBe('saved');
      const next = s.saveCheckpoint.mock.calls.at(-1)!;
      expect(next[3].parent).toBe(await headHash(conflict ? conflictingHead : previousHead));
      expect(next[3].seq).toBe(conflict ? 3 : 2);
    } finally { spy.mockRestore(); }
  });
  it('retains changes made while a PUT is in flight for another save', async () => {
    const s = setup(); await ready(s); let finish!: (r: PutResult) => void;
    s.saveCheckpoint.mockImplementationOnce(() => new Promise(r => { finish = r; }));
    const first = s.c.flush(); await vi.waitFor(() => expect(s.saveCheckpoint).toHaveBeenCalledTimes(1)); s.c.markDirty();
    const head = { ...vector.head_signed, schema: SCHEMA };
    finish({ type: 'ack', seq: 1, hash: await headHash(head), slot: head.slot, head }); await first;
    await s.c.flush(); expect(s.saveCheckpoint).toHaveBeenCalledTimes(2);
  });
  it('CAS conflict merges remote signed evidence and retries against the fetched head', async () => {
    const did = await ensureDidIdentity();
    const fields = { type: 'tc-chat:post-delete', surface: 'chat', id: 'delete', targetId: 'target', fromId: did.did, fromName: 'A', timestamp: 1 };
    const wire = { ...fields, signature: await signWireFields(fields) };
    const s = setup(); await ready(s); const checkpoint = emptyCheckpoint('r'); checkpoint.buckets.chat = [wire];
    const head = { ...vector.head_signed, schema: SCHEMA };
    s.saveCheckpoint.mockResolvedValueOnce({ type: 'conflict', head });
    s.fetchLatest.mockResolvedValueOnce({ head, plaintext: encodeCheckpoint(checkpoint) });
    await s.c.flush(); expect(s.saveCheckpoint).toHaveBeenCalledTimes(2);
    const next = s.saveCheckpoint.mock.calls[1];
    expect((next[3] as CheckpointOptions).parent).toBe(await headHash(head)); expect(next[3].seq).toBe(2);
    expect(JSON.parse(new TextDecoder().decode(next[2])).buckets.chat[0].id).toBe('delete'); expect(s.receive).toHaveBeenCalledWith(wire);
  });
  it('limits CAS to three PUT attempts and preserves the remote checkpoint on failure', async () => {
    const s = setup(); await ready(s); s.saveCheckpoint.mockResolvedValue({ type: 'conflict', head: null });
    await s.c.flush(); expect(s.saveCheckpoint).toHaveBeenCalledTimes(3); expect(s.c.view.status).toBe('error'); expect(s.c.view.reason).toContain('limit');
    expect(JSON.parse(localStorage.getItem('tc-chat:escrow:v1:r')!).daemon.lastSeq).toBe(0);
  });
  it('ignores stale fetch completion after Off and isolates saved watermarks per endpoint', async () => {
    const s = setup(); await ready(s); await s.c.flush();
    let finish!: (v: null) => void; s.fetchLatest.mockImplementationOnce(() => new Promise(r => { finish = r; }));
    await s.c.configure({ mode: 'custom', mistlRoom: 'other' }); s.provider();
    await s.c.configure({ mode: 'off', mistlRoom: '' }); finish(null);
    await new Promise(r => setTimeout(r, 10)); expect(s.c.view.status).toBe('off');
    const marks = JSON.parse(localStorage.getItem('tc-chat:escrow:v1:r')!); expect(marks.daemon.lastSeq).toBe(1); expect(marks.other.lastSeq).toBe(0);
  });
  it('keeps failed local ACK persistence dirty and permits manual retry', async () => {
    const s = setup(); await ready(s);
    const set = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    await s.c.flush(); expect(s.c.view.status).toBe('error'); expect(s.c.view.reason).toContain('quota'); set.mockRestore();
    await s.c.retryNow(); expect(s.saveCheckpoint).toHaveBeenCalledTimes(2);
  });
  it('rejects excluded rooms before deriving/joining and Off never starts a client', async () => {
    const make = vi.fn();
    for (const roomId of ['global','tc-chat:personal']) expect(() => new RoomEscrowController({ roomId, wires: () => [], receive: async () => {}, changed() {} }, transport, make)).toThrow('excluded');
    expect(make).not.toHaveBeenCalled(); const s = setup(); await s.c.configure({ mode: 'off', mistlRoom: '' }); expect(s.client.join).not.toHaveBeenCalled();
  });
});
