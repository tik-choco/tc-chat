import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/preact';
const mock = vi.hoisted(() => ({
  event: null as null | ((type: number, from: string, payload: unknown, room: string) => void),
  joined: new Set<string>(), hold: null as Promise<void> | null,
  leave: vi.fn(), send: vi.fn(), get: vi.fn(), add: vi.fn(),
}));
vi.mock('@tik-choco/mistlib-web', () => ({
  MistNode: class {
    async init() {} onEvent(cb: typeof mock.event) { mock.event = cb; } onMediaEvent() {}
    isRoomJoined(room: string) { return mock.joined.has(room); }
    async joinRoomAsync(room: string) { if (mock.hold) await mock.hold; mock.joined.add(room); }
    leaveRoom(room: string) { mock.leave(room); mock.joined.delete(room); }
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
import { EscrowClient } from './client';
import { RoomEscrowController } from './controller';
import type { RoomEscrowClient } from './controller';
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
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
beforeEach(() => { localStorage.clear(); __resetMuteCacheForTests(); mock.hold = null; vi.clearAllMocks(); });
afterEach(cleanup);

it('keeps a replacement client joined when an old disposed join finishes late', async () => {
  const hold = deferred<void>(); mock.hold = hold.promise;
  const transport = createMistEscrowTransport();
  const old = new EscrowClient(transport.createClientHandle(), 'lease-race');
  const oldJoin = old.join(); old.dispose();
  const next = new EscrowClient(transport.createClientHandle(), 'lease-race');
  const nextJoin = next.join();
  try {
    hold.resolve(); await Promise.all([oldJoin, nextJoin]);
    await new Promise(r => setTimeout(r, 0));
    expect(mock.joined.has('lease-race')).toBe(true);
    expect(mock.leave).not.toHaveBeenCalledWith('lease-race');
  } finally { next.dispose(); mock.hold = null; }
});

it('keeps the controller replacement joined across Off while its old join is pending', async () => {
  const hold = deferred<void>(); mock.hold = hold.promise;
  const c = new RoomEscrowController({ roomId: 'r', wires: () => [], receive: async () => {}, changed() {} }, createMistEscrowTransport());
  try {
    const first = c.configure({ mode: 'custom', mistlRoom: 'controller-race' });
    await c.configure({ mode: 'off', mistlRoom: '' });
    const replacement = c.configure({ mode: 'custom', mistlRoom: 'controller-race' });
    hold.resolve(); await Promise.all([first, replacement]);
    await new Promise(r => setTimeout(r, 0));
    expect(c.view.status).toBe('searching');
    expect(mock.joined.has('controller-race')).toBe(true);
    expect(mock.leave).not.toHaveBeenCalledWith('controller-race');
    expect(mock.send).toHaveBeenCalledWith(null, expect.any(Uint8Array), 1, 'controller-race');
  } finally { hold.resolve(); await c.dispose(); mock.hold = null; }
});

it.each(['restore', 'CAS'] as const)('preserves a live edit received after %s snapshots local wires', async (stage) => {
  await getNode();
  renderHook(() => usePostStream('r', 'chat', 'A'));
  const identity = await ensureDidIdentity(), enc = generatePostEnc();
  const make = async (id: string, timestamp: number, cid: string, edit = false) => {
    const fields = edit
      ? { type: 'tc-chat:post-edit', surface: 'chat', id, targetId: 'p', fromId: identity.did, fromName: 'A', timestamp, cid, enc }
      : { type: 'tc-chat:post', surface: 'chat', id, parentId: null, kind: 'text', fromId: identity.did, fromName: 'A', timestamp, cid, enc };
    return { ...fields, signature: await signWireFields(fields) };
  };
  const post = await make('p', 1, 'original'), oldEdit = await make('old-edit', 2, 'old', true);
  const liveEdit = await make('live-edit', 3, 'live', true);
  const bodies = new Map<string, Uint8Array>();
  for (const [cid, text] of [['original', 'original'], ['old', 'old'], ['live', 'LIVE']])
    bodies.set(cid, await encryptPostBytes(enc, new TextEncoder().encode(JSON.stringify({ text }))));
  mock.get.mockImplementation(async cid => bodies.get(cid)!);
  await act(async () => { await replayRoomWire('r', post); await replayRoomWire('r', oldEdit); });
  const checkpoint = emptyCheckpoint('r'); checkpoint.buckets.chat = [post, oldEdit];
  checkpoint.blobs = ['original', 'old'].map(cid => ({ cid, name: 'enc.bin', bytes: toBase64(bodies.get(cid)!) }));
  const hold = deferred<void>(), entered = deferred<void>(); let held = false;
  mock.add.mockImplementation(async (_name, bytes) => {
    if (!held) { held = true; entered.resolve(); await hold.promise; }
    return [...bodies].find(([, v]) => toBase64(v) === toBase64(bytes))![0];
  });
  let provider!: () => void;
  const providers = new Map<string, { maxBlob: number }>();
  let fetched = 0, put = 0;
  const head = { ...vector.head_signed, schema: SCHEMA };
  const client: RoomEscrowClient = { providers, join: async () => {},
    onProvider(cb) { provider = cb; return () => {}; },
    fetchLatest: async () => stage === 'CAS' && fetched++ === 0 ? null : { head, plaintext: encodeCheckpoint(checkpoint) },
    saveCheckpoint: async (_app, _room, _bytes, options) => {
      if (stage === 'CAS' && put++ === 0) return { type: 'conflict', head };
      const saved = { ...head, seq: options.seq, parent: options.parent };
      return { type: 'ack', head: saved, slot: saved.slot, seq: saved.seq, hash: await headHash(saved) };
    }, dispose() {} };
  const c = new RoomEscrowController({ roomId: 'r', wires: () => loadWireLog('r'),
    receive: wire => replayRoomWire('r', wire), changed() {} }, createMistEscrowTransport(), () => client);
  try {
    await c.configure({ mode: 'custom', mistlRoom: 'daemon' });
    providers.set('daemon', { maxBlob: 32 * 1024 * 1024 }); provider();
    let saving: Promise<void> | undefined;
    if (stage === 'CAS') {
      await vi.waitFor(() => expect(c.view.status).toBe('ready'));
      saving = c.flush();
    }
    await entered.promise;
    await act(async () => {
      mock.event!(0, 'peer', new TextEncoder().encode(JSON.stringify(liveEdit)), 'r');
      await vi.waitFor(() => expect(loadPosts('chat', 'r')[0].text).toBe('LIVE'));
    });
    hold.resolve();
    if (saving) await saving;
    await vi.waitFor(() => expect(c.view.status).toBe(stage === 'CAS' ? 'saved' : 'ready'));
    expect(loadWireLog('r')).toContainEqual(liveEdit);
    expect(loadPosts('chat', 'r')[0].text).toBe('LIVE');
  } finally { hold.resolve(); await c.dispose(); }
}, 10000);
