import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/preact';
const mock = vi.hoisted(() => ({ event: null as null | ((type: number, from: string, payload: unknown, room: string) => void), joined: new Set<string>(),
  get: vi.fn(), add: vi.fn(), send: vi.fn() }));
vi.mock('../vendor/mistlib/wrappers/web/index.js', () => ({
  MistNode: class {
    async init() {} onEvent(cb: typeof mock.event) { mock.event = cb; } onMediaEvent() {}
    isRoomJoined(room: string) { return mock.joined.has(room); }
    async joinRoomAsync(room: string) { mock.joined.add(room); }
    leaveRoom(room: string) { mock.joined.delete(room); }
    sendMessage(...args: unknown[]) { mock.send(...args); }
  }, EVENT_RAW: 0, EVENT_NEIGHBORS: 4, EVENT_PEER_CONNECTED: 5, EVENT_PEER_DISCONNECTED: 6,
  DELIVERY_RELIABLE: 1, DELIVERY_UNRELIABLE: 0,
  storage_add: (name: string, bytes: Uint8Array) => mock.add(name, bytes),
  storage_get: (cid: string) => mock.get(cid),
  storage_kv_set: vi.fn(), storage_kv_get: vi.fn(), storage_pin: vi.fn(),
  storage_unpin: vi.fn(), storage_is_pinned: vi.fn(), storage_add_pinned: vi.fn(),
}));
vi.mock('../lib/mistBuildInfo', () => ({ captureMistBuildInfo() {}, markMistLoadError() {} }));
vi.mock('../lib/relayCache', () => ({ shouldRelayRoom: () => false, sweepRoom: async () => {},
  noteBody: async () => {}, releasePost: async () => {}, AUTO_FETCH_MAX_BYTES: 8 * 1024 * 1024 }));
import { createMistEscrowTransport } from './mistTransport';
import { RoomEscrowController, type RoomEscrowClient } from './controller';
import { emptyCheckpoint, encodeCheckpoint, SCHEMA, toBase64 } from './checkpoint';
import { vector } from './vectors.fixture';
import { headHash } from './head';
import { usePostStream } from '../hooks/usePostStream';
import { ensureDidIdentity } from '../crypto/didIdentity';
import { encryptPostBytes, generatePostEnc } from '../crypto/postCipher';
import { signWireFields } from '../lib/wireSign';
import { loadPosts, loadWireLog } from '../lib/chatStore';
import { getNode, replayRoomWire } from '../lib/mistClient';
import { __resetMuteCacheForTests } from '../lib/muteStore';
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
beforeEach(() => { localStorage.clear(); __resetMuteCacheForTests(); vi.clearAllMocks(); });
afterEach(cleanup);

it.each(['restore', 'CAS'] as const)('preserves a live reaction removal received during %s blob import', async stage => {
  await getNode();
  renderHook(() => usePostStream('r', 'chat', 'A'));
  const identity = await ensureDidIdentity(), enc = generatePostEnc();
  const fields = { type: 'tc-chat:post', surface: 'chat', id: 'p', parentId: null,
    kind: 'text', cid: 'body', enc, fromId: identity.did, fromName: 'A', timestamp: 1 };
  const post = { ...fields, signature: await signWireFields(fields) };
  const reaction = async (id: string, timestamp: number, op: 'add' | 'remove') => {
    const fields = { type: 'tc-chat:reaction', id, targetId: 'p', emoji: '👍', op,
      fromId: identity.did, fromName: 'A', timestamp };
    return { ...fields, signature: await signWireFields(fields) };
  };
  const add = await reaction('add', 2, 'add'), remove = await reaction('remove', 3, 'remove');
  const body = await encryptPostBytes(enc, new TextEncoder().encode(JSON.stringify({ text: 'post' })));
  mock.get.mockResolvedValue(body);
  await act(async () => { await replayRoomWire('r', post); await replayRoomWire('r', add); });
  expect(loadPosts('chat', 'r')[0].reactions).toHaveLength(1);
  const checkpoint = emptyCheckpoint('r');
  checkpoint.buckets.chat = [post]; checkpoint.buckets.misc = [add];
  checkpoint.blobs = [{ cid: 'body', name: 'enc.bin', bytes: toBase64(body) }];
  const hold = deferred(), entered = deferred();
  mock.add.mockImplementation(async () => { entered.resolve(); await hold.promise; return 'body'; });
  const head = { ...vector.head_signed, schema: SCHEMA }; let fetches = 0, puts = 0;
  const client: RoomEscrowClient = {
    providers: new Map([['daemon', { maxBlob: 32 * 1024 * 1024 }]]),
    join: async () => {}, onProvider: () => () => {}, dispose() {},
    fetchLatest: async () => stage === 'CAS' && fetches++ === 0 ? null : { head, plaintext: encodeCheckpoint(checkpoint) },
    saveCheckpoint: async (_app, _room, _bytes, options) => {
      if (stage === 'CAS' && puts++ === 0) return { type: 'conflict', head };
      const saved = { ...head, seq: options.seq, parent: options.parent };
      return { type: 'ack', head: saved, slot: saved.slot, seq: saved.seq, hash: await headHash(saved) };
    },
  };
  const c = new RoomEscrowController({ roomId: 'r', wires: () => loadWireLog('r'),
    receive: wire => replayRoomWire('r', wire), changed() {} }, createMistEscrowTransport(), () => client);
  try {
    await c.configure({ mode: 'custom', mistlRoom: 'daemon' });
    let saving: Promise<void> | undefined;
    if (stage === 'CAS') {
      await vi.waitFor(() => expect(c.view.status).toBe('ready')); saving = c.flush();
    }
    await entered.promise;
    await act(async () => {
      mock.event!(0, 'peer', new TextEncoder().encode(JSON.stringify(remove)), 'r');
      await vi.waitFor(() => expect(loadPosts('chat', 'r')[0].reactions).toHaveLength(0));
    });
    hold.resolve(); if (saving) await saving;
    await vi.waitFor(() => expect(c.view.status).toBe(stage === 'CAS' ? 'saved' : 'ready'));
    expect(loadWireLog('r')).toContainEqual(remove);
    expect(loadPosts('chat', 'r')[0].reactions).toHaveLength(0);
  } finally { hold.resolve(); await c.dispose(); }
}, 10000);

import { useChatRoom } from '../hooks/useChatRoom';
import { validCustomRoom } from './config';
it('keeps an app room joined when an earlier escrow owner releases the same topic', async () => {
  expect(validCustomRoom('room-B', 'room-A')).toBe(true);
  const escrow = createMistEscrowTransport();
  await escrow.join('room-B');
  const app = renderHook(() => useChatRoom('room-B', 'A'));
  try {
    await vi.waitFor(() => expect(app.result.current.status).toBe('joined'));
    expect((await getNode()).isRoomJoined('room-B')).toBe(true);
    escrow.leave('room-B');
    await new Promise(r => setTimeout(r, 0));
    expect(app.result.current.status).toBe('joined');
    expect((await getNode()).isRoomJoined('room-B')).toBe(true);
  } finally { escrow.leave('room-B'); app.unmount(); }
});
