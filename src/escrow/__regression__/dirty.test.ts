import { afterEach, expect, it, vi } from 'vitest';
import { RoomEscrowController, type RoomEscrowClient } from '../controller';
import { evidenceJournal } from '../journal';
import {
  appendWireLog, loadWireLog, subscribeWireLog,
} from '../../lib/chatStore';
import { ensureDidIdentity } from '../../crypto/didIdentity';
import { signWireFields } from '../../lib/wireSign';
import { headHash } from '../head';
import { vector } from '../vectors.fixture';
import { SCHEMA } from '../checkpoint';

const kv = vi.hoisted(() => new Map<string, Uint8Array>());
vi.mock('../../lib/mistClient', () => ({
  storage_kv_get: async (k: string) => kv.get(k),
  storage_kv_set: async (k: string, v: Uint8Array) => { kv.set(k, v); },
}));
afterEach(() => vi.useRealTimers());

it('a newly journaled signed equivocation must invalidate saved state', async () => {
  localStorage.clear(); vi.useFakeTimers();
  const roomId = 'equivocation-room', identity = await ensureDidIdentity();
  const fields = {
    type: 'tc-chat:post-delete', surface: 'chat', roomId, id: 'same-id',
    targetId: 'first-target', fromId: identity.did,
    fromName: 'Alice', timestamp: 1,
  };
  const first = { ...fields, signature: await signWireFields(fields) };
  const otherFields = { ...fields, targetId: 'second-target' };
  const second = {
    ...otherFields, signature: await signWireFields(otherFields),
  };
  appendWireLog(roomId, first);
  const save = vi.fn<RoomEscrowClient['saveCheckpoint']>(
    async (_app, _room, _bytes, options) => {
      const head = {
        ...vector.head_signed, seq: options.seq,
        parent: options.parent, schema: SCHEMA,
      };
      return {
        type: 'ack', seq: head.seq, hash: await headHash(head),
        slot: head.slot, head,
      };
    },
  );
  const client: RoomEscrowClient = {
    providers: new Map([['daemon', { maxBlob: 32 * 1024 * 1024 }]]),
    join: async () => {}, onProvider: () => () => {},
    fetchLatest: async () => null, saveCheckpoint: save, dispose() {},
  };
  const c = new RoomEscrowController({
    roomId, wires: () => loadWireLog(roomId),
    evidence: () => evidenceJournal.snapshot(roomId, loadWireLog(roomId)),
    receive: async () => {}, changed() {},
  }, {
    join: async () => {}, leave() {}, send() {},
    onMessage: () => () => {}, onPeer: () => () => {},
    storageGet: async () => new Uint8Array(),
    storageAdd: async () => 'cid',
  }, () => client);
  const off = subscribeWireLog(room => {
    if (room === roomId) c.markDirty();
  });
  try {
    await c.configure({ mode: 'custom', mistlRoom: 'daemon' });
    for (let i = 0; i < 100 && c.view.status !== 'ready'; i++)
      await new Promise<void>(r => queueMicrotask(r));
    expect(c.view.status).toBe('ready');
    await c.flush();
    expect(c.view.status).toBe('saved');
    expect(save).toHaveBeenCalledTimes(1);
    appendWireLog(roomId, second);
    expect((await evidenceJournal.snapshot(roomId)).buckets.chat)
      .toHaveLength(2);
    await c.flush();
    expect(c.view.status).toBe('saved');
    expect(JSON.parse(new TextDecoder().decode(save.mock.calls[0][2]))
      .buckets.chat).toEqual([first]);
    expect(save).toHaveBeenCalledTimes(2);
    expect(JSON.parse(new TextDecoder().decode(save.mock.calls[1][2])).buckets.chat)
      .toEqual(expect.arrayContaining([first, second]));
    appendWireLog(roomId, second);
    await c.flush();
    expect(save).toHaveBeenCalledTimes(2);
  } finally {
    off(); await c.dispose();
  }
});
