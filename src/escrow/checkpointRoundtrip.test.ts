import { beforeEach, expect, it, vi } from 'vitest';
import { ensureDidIdentity } from '../crypto/didIdentity';
import { signWireFields } from '../lib/wireSign';
import { generatePostEnc, encryptPostBytes } from '../crypto/postCipher';
import { emptyCheckpoint, encodeCheckpoint, parseCheckpoint, SCHEMA, toBase64, mergeCheckpoints, MAX_WIRES_PER_BUCKET } from './checkpoint';
import type { RoomCheckpoint } from './checkpoint';
import { RoomEscrowController } from './controller';
import type { RoomEscrowClient } from './controller';
import type { EscrowTransport } from './client';
import type { SignedWire } from '../lib/chatStore';
import { vector } from './vectors.fixture';
import { headHash } from './head';

beforeEach(() => localStorage.clear());
async function controller(remote: RoomCheckpoint, storageAdd: EscrowTransport['storageAdd']) {
  const wires: SignedWire[] = [];
  const puts: Uint8Array[] = [];
  const head = { ...vector.head_signed, schema: SCHEMA };
  const client: RoomEscrowClient = {
    providers: new Map([['daemon', { maxBlob: 32 * 1024 * 1024 }]]),
    join: async () => {}, onProvider: () => () => {}, dispose() {},
    fetchLatest: async () => ({ head, plaintext: encodeCheckpoint(remote) }),
    saveCheckpoint: async (_app, _room, bytes, options) => {
      puts.push(bytes);
      const saved = { ...head, seq: options.seq, parent: options.parent };
      return { type: 'ack', slot: saved.slot, seq: saved.seq,
        hash: await headHash(saved), head: saved };
    },
  };
  const transport: EscrowTransport = {
    join: async () => {}, leave() {}, send() {},
    onMessage: () => () => {}, onPeer: () => () => {}, storageAdd,
    storageGet: async () => { throw new Error('body unavailable'); },
  };
  const c = new RoomEscrowController({ roomId: 'r', wires: () => wires,
    receive: async () => {}, changed() {} }, transport, () => client);
  await c.configure({ mode: 'custom', mistlRoom: 'daemon' });
  await vi.waitFor(() => expect(c.view.status).toBe('ready'), { timeout: 60000 });
  return { c, wires, puts };
}

it('restores an ACKed save after adding one wire to a valid 20000-wire history', async () => {
  const identity = await ensureDidIdentity();
  const remote = emptyCheckpoint('r');
  for (let i = 0; i < 20001; i++) {
    const fields = { type: 'tc-chat:post-delete', surface: 'chat', id: 'delete-' + i,
      targetId: 'target-' + i, fromId: identity.did, fromName: 'A', timestamp: i };
    remote.buckets.chat.push({ ...fields, signature: await signWireFields(fields) });
  }
  const next = remote.buckets.chat.pop()!;
  await parseCheckpoint(encodeCheckpoint(remote), 'r');
  const { c, wires, puts } = await controller(remote, async () => 'unused');
  try {
    wires.push(next); c.markDirty(); await c.flush();
    expect(c.view.status).toBe('saved-with-omissions'); expect(puts).toHaveLength(1);
    expect(c.view.droppedWires).toEqual({ chat: 1 });
    expect(JSON.parse(localStorage.getItem('tc-chat:escrow:v1:r')!).daemon.lastSeq).toBe(2);
    const saved = JSON.parse(new TextDecoder().decode(puts[0]));
    expect(saved.buckets.chat).toHaveLength(20000);
    expect(saved.buckets.chat[0].id).toBe('delete-1');
    expect(saved.buckets.chat.at(-1).id).toBe('delete-20000');
    expect(saved.droppedWires).toEqual({ chat: 1 });
    await expect(parseCheckpoint(puts[0], 'r')).resolves.toBeDefined();
  } finally { await c.dispose(); }
}, 120000);

it('restores an ACKed save after dropping a structured body with a CID mismatch', async () => {
  const identity = await ensureDidIdentity(), enc = generatePostEnc();
  const fields = { type: 'tc-chat:post', surface: 'board', id: 'post', parentId: null,
    kind: 'project', cid: 'body', enc, fromId: identity.did, fromName: 'A', timestamp: 1 };
  const wire = { ...fields, signature: await signWireFields(fields) };
  const body = await encryptPostBytes(enc, new TextEncoder().encode(JSON.stringify({ title: 'P', thumbCid: 'thumb' })));
  const thumb = await encryptPostBytes(enc, new Uint8Array([1, 2, 3]));
  const remote = emptyCheckpoint('r'); remote.buckets.board.push(wire);
  remote.blobs = [{ cid: 'body', name: 'enc.bin', bytes: toBase64(body) },
    { cid: 'thumb', name: 'enc.bin', bytes: toBase64(thumb) }];
  await parseCheckpoint(encodeCheckpoint(remote), 'r');
  const { c, puts } = await controller(remote, async (_name, bytes) =>
    bytes.length === body.length ? 'wrong-cid' : 'thumb');
  try {
    await c.flush();
    expect(c.view.status).toBe('saved-with-omissions'); expect(puts).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem('tc-chat:escrow:v1:r')!).daemon.lastSeq).toBe(2);
    expect(JSON.parse(new TextDecoder().decode(puts[0])).blobs.map((b: { cid: string }) => b.cid)).toEqual([]);
    expect(c.view.omitted).toEqual(expect.arrayContaining([
      { cid: 'body', reason: 'unavailable' }, { cid: 'thumb', reason: 'cid-mismatch' },
    ]));
    await expect(parseCheckpoint(puts[0], 'r')).resolves.toBeDefined();
  } finally { await c.dispose(); }
});

// Exercise real signatures in the independent misc bucket, including timestamp/id ties.
it('bounds misc unions deterministically and pins the converged config with an old timestamp', async () => {
  const identity = await ensureDidIdentity();
  const remote = emptyCheckpoint('r'), local = emptyCheckpoint('r');
  for (let i = 0; i <= MAX_WIRES_PER_BUCKET; i++) {
    const fields = { type: 'tc-chat:reaction', id: 'reaction-' + String(i).padStart(5, '0'),
      targetId: 'target', fromId: identity.did, fromName: 'A', timestamp: 10, emoji: '👍', op: 'add' };
    const wire = { ...fields, signature: await signWireFields(fields) };
    (i < MAX_WIRES_PER_BUCKET - 1 ? remote : local).buckets.misc.push(wire);
  }
  for (const [checkpoint, rev, timestamp] of [[remote, 1, 1], [local, 2, 0]] as const) {
    const fields = { type: 'tc-chat:escrow-config', v: 1, id: 'config-' + rev, roomId: 'r',
      fromId: identity.did, timestamp, rev, mode: 'auto', mistlRoom: '' };
    checkpoint.buckets.misc.push({ ...fields, signature: await signWireFields(fields) });
  }
  const fields = { type: 'tc-chat:post-delete', surface: 'board', id: 'board-delete',
    targetId: 'target', fromId: identity.did, fromName: 'A', timestamp: 1 };
  local.buckets.board.push({ ...fields, signature: await signWireFields(fields) });
  await parseCheckpoint(encodeCheckpoint(remote), 'r');
  await parseCheckpoint(encodeCheckpoint(local), 'r');
  const forward = await mergeCheckpoints(remote, local), reverse = await mergeCheckpoints(local, remote);
  expect(forward).toEqual(reverse);
  expect(forward.buckets.misc).toHaveLength(MAX_WIRES_PER_BUCKET);
  expect(forward.buckets.misc[0].id).toBe('config-2');
  expect(forward.buckets.misc[1].id).toBe('reaction-00002');
  expect(forward.buckets.misc.at(-1)!.id).toBe('reaction-20000');
  expect(forward.buckets.board).toEqual(local.buckets.board);
  expect(forward.droppedWires).toEqual({ misc: 3 });
  const retained = await mergeCheckpoints(forward, emptyCheckpoint('r'));
  expect(retained.droppedWires).toEqual({ misc: 3 });
  await expect(parseCheckpoint(encodeCheckpoint(retained), 'r')).resolves.toBeDefined();
}, 120000);
