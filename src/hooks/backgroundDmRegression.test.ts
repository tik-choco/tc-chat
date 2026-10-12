import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/preact';
import { useRoomEscrow } from './useRoomEscrow';
import { useMessageAlerts } from './useMessageAlerts';
import { RoomEscrowController } from '../escrow/controller';
import { RoomEscrowSession } from '../escrow/session';
import { evidenceJournal } from '../escrow/journal';
import { emptyCheckpoint, encodeCheckpoint, SCHEMA, toBase64 } from '../escrow/checkpoint';
import { vector } from '../escrow/vectors.fixture';
import { ensureDidIdentity } from '../crypto/didIdentity';
import { generatePostEnc, encryptPostBytes } from '../crypto/postCipher';
import * as wireSign from '../lib/wireSign';
import { loadPosts, loadWireLog } from '../lib/chatStore';
import type { Friend } from '../lib/friendsStore';
import type { PostSurface, SignedWire } from '../lib/chatStore';

const mock = vi.hoisted(() => ({
  listeners: new Set<(event: number, from: string, wire: unknown, room: string, restored?: boolean) => void | Promise<void>>(),
  sessions: new Map<string, RoomEscrowSession>(),
  kv: new Map<string, Uint8Array>(), bodies: new Map<string, Uint8Array>(),
  replayed: vi.fn(), send: vi.fn(),
}));
vi.mock('../lib/mistClient', () => ({
  getNode: async () => ({ sendMessage: mock.send }), joinAppRoom: async () => {},
  subscribeEvent: (cb: typeof mock.listeners extends Set<infer T> ? T : never) => {
    mock.listeners.add(cb); return () => { mock.listeners.delete(cb); };
  },
  isRawEvent: (event: number) => event === 0, decodeRawPayload: (wire: unknown) => wire,
  replayRoomWire: async (room: string, wire: unknown) => {
    mock.replayed(room, wire);
    for (const cb of [...mock.listeners]) await cb(0, 'peer', wire, room, true);
  },
  storage_get: async (cid: string) => {
    const bytes = mock.bodies.get(cid); if (!bytes) throw new Error('body unavailable'); return bytes;
  },
  storage_kv_get: async (key: string) => mock.kv.get(key),
  storage_kv_set: async (key: string, bytes: Uint8Array) => { mock.kv.set(key, bytes); },
  EVENT_PEER_CONNECTED: 5, DELIVERY_RELIABLE: 1,
}));
vi.mock('../escrow/mistTransport', () => ({ createMistEscrowTransport: () => ({
  join: async () => {}, leave() {}, send() {}, onMessage: () => () => {}, onPeer: () => () => {},
  storageAdd: async () => 'unused', storageGet: async () => new Uint8Array(),
}) }));
vi.mock('../escrow/session', async importOriginal => {
  const actual = await importOriginal<typeof import('../escrow/session')>();
  return { ...actual, RoomEscrowSession: class extends actual.RoomEscrowSession {
    constructor(...args: ConstructorParameters<typeof actual.RoomEscrowSession>) {
      super(...args); mock.sessions.set(args[0], this);
    }
  } };
});
let serial = 0;
let prefix: string;
let controllers: RoomEscrowController[];
beforeEach(() => {
  localStorage.clear(); mock.listeners.clear(); mock.sessions.clear(); mock.kv.clear(); mock.bodies.clear();
  vi.clearAllMocks(); prefix = 'round3-' + ++serial + '-'; controllers = [];
});
afterEach(async () => {
  vi.restoreAllMocks(); cleanup();
  await Promise.all([...mock.sessions.values()].map(s => s.dispose()));
  await Promise.all(controllers.map(c => c.dispose()));
});
async function signed(fields: Record<string, unknown>): Promise<SignedWire> {
  const identity = await ensureDidIdentity();
  const value = { fromId: identity.did, fromName: 'Self', timestamp: 1, ...fields };
  return { ...value, signature: await wireSign.signWireFields(value) };
}
function friends(rooms: string[]): Friend[] {
  return rooms.map(roomId => ({ roomId, did: 'friend', name: 'Friend', status: 'accepted', addedAt: 1 }));
}
async function mount(rooms: string[], selfDid?: string) {
  const identity = await ensureDidIdentity();
  const h = renderHook(() => {
    const alerts = useMessageAlerts(prefix + 'active', selfDid ?? identity.did, friends(rooms));
    useRoomEscrow(prefix + 'active', rooms); return alerts;
  });
  await vi.waitFor(() => expect(mock.sessions.size).toBe(Math.min(8, rooms.length + 1)));
  await Promise.all([...mock.sessions.values()].map(s => s.ready));
  return h;
}
async function deliver(room: string, wire: SignedWire, restored = false) {
  await act(async () => { for (const cb of [...mock.listeners]) await cb(0, 'peer', wire, room, restored); });
}
async function off(roomId: string) {
  return signed({ type: 'tc-chat:escrow-config', v: 1, id: 'off', roomId, rev: 1, mode: 'off', mistlRoom: '' });
}
async function post(roomId: string, surface: PostSurface = 'chat', id = 'post') {
  return signed({ type: 'tc-chat:post', roomId, surface, id, parentId: null, kind: 'text', cid: 'body' });
}

it('overflow accepted DM retains signed Off despite config quota failure', async () => {
  const rooms = Array.from({ length: 9 }, (_, i) => prefix + 'dm-' + i), room = rooms[8];
  await mount(rooms); expect(mock.sessions.has(room)).toBe(false);
  const wire = await off(room);
  const setItem = localStorage.setItem.bind(localStorage);
  vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
    if (key === 'tc-chat:escrow-config:v1:' + room) throw new Error('QuotaExceededError');
    setItem(key, value);
  });
  await deliver(room, wire);
  // Later ordinary DM activity must never resurrect Auto after the failed write.
  await deliver(room, await post(room));
  await vi.waitFor(() => expect(mock.sessions.has(room)).toBe(true));
  const session = mock.sessions.get(room)!; await session.ready;
  const journal = await evidenceJournal.snapshot(room, loadWireLog(room));
  expect({ mode: session.controller.view.mode, retained: journal.buckets.misc.some(w => w.id === wire.id) })
    .toEqual({ mode: 'off', retained: true });
  expect(session.persistenceError).toBeTruthy();
});

it('a DM activated during config verification still adopts the in-flight Off wire', async () => {
  const rooms = Array.from({ length: 9 }, (_, i) => prefix + 'dm-' + i), room = rooms[8];
  await mount(rooms);
  const wire = await off(room), originalVerify = wireSign.verifyWire;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let waiting = false;
  vi.spyOn(wireSign, 'verifyWire').mockImplementation(async value => {
    if (value === wire && !waiting) { waiting = true; await gate; }
    return originalVerify(value);
  });
  const pending = Promise.all([...mock.listeners].map(cb => cb(0, 'peer', wire, room)));
  await vi.waitFor(() => expect(waiting).toBe(true));
  await deliver(room, await post(room));
  await vi.waitFor(() => expect(mock.sessions.has(room)).toBe(true));
  const session = mock.sessions.get(room)!; await session.ready;
  expect(session.controller.view.mode).toBe('auto');
  await act(async () => { release(); await pending; });
  expect(session.controller.view.mode).toBe('off');
  expect(session.config).toEqual(wire);
});

it('retains Off when its resident DM session is evicted during signature verification', async () => {
  const rooms = Array.from({ length: 9 }, (_, i) => prefix + 'dm-' + i), room = rooms[0];
  await mount(rooms);
  const resident = mock.sessions.get(room)!;
  const disposed = vi.spyOn(resident, 'dispose');
  const wire = await off(room), originalVerify = wireSign.verifyWire;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let waiting = false;
  let released = false;
  vi.spyOn(wireSign, 'verifyWire').mockImplementation(async value => {
    if (value === wire && !released) { waiting = true; await gate; }
    return originalVerify(value);
  });
  // Fan out like the live event bus; verification must not block ordinary DM traffic.
  const pending = Promise.all([...mock.listeners].map(cb => cb(0, 'peer', wire, room)));
  try {
    await vi.waitFor(() => expect(waiting).toBe(true));
    mock.bodies.set('body', new TextEncoder().encode(JSON.stringify({ text: 'LRU activity' })));
    await deliver(rooms[8], await post(rooms[8]));
    await vi.waitFor(() => expect(disposed).toHaveBeenCalledTimes(1));
    // Complete Off only after its original session has been disposed.
    await act(async () => { released = true; release(); await pending; });
    await deliver(room, await post(room));
    await vi.waitFor(() => expect(mock.sessions.get(room)).not.toBe(resident));
    const current = mock.sessions.get(room)!; await current.ready;
    const journal = await evidenceJournal.snapshot(room, loadWireLog(room));
    expect({ mode: current.controller.view.mode, retained: journal.buckets.misc.some(w => w.id === wire.id) })
      .toEqual({ mode: 'off', retained: true });
    expect(current.config).toEqual(wire);
  } finally {
    released = true; release(); await pending;
  }
});

it.each(['board', 'calendar', 'gallery'] as const)('journals and persists live %s evidence for an overflow accepted DM', async surface => {
  const rooms = Array.from({ length: 9 }, (_, i) => prefix + 'dm-' + i), room = rooms[8];
  const h = await mount(rooms, 'observer');
  const body = { text: 'Details', title: 'Title', roles: ['dev'], tags: ['tag'], startsAt: 10, endsAt: 20,
    location: 'Room', thumbCid: 'thumb', thumbMimeType: 'image/png', capacity: 3 };
  mock.bodies.set('body', new TextEncoder().encode(JSON.stringify(body)));
  const wire = await signed({ type: 'tc-chat:post', roomId: room, surface, id: 'post', parentId: null,
    kind: surface === 'board' ? 'project' : surface === 'calendar' ? 'event' : 'media', cid: 'body', fileName: 'photo.png' });
  await deliver(room, wire);
  const checkpoint = await evidenceJournal.snapshot(room, loadWireLog(room));
  expect(checkpoint.buckets[surface]).toEqual([wire]);
  await vi.waitFor(() => expect(mock.sessions.has(room)).toBe(true));
  expect(loadPosts(surface, room)[0]).toMatchObject({ surface, cid: 'body', fileName: 'photo.png',
    ...(surface === 'gallery' ? {} : body) });
  expect(loadPosts('chat', room)).toEqual([]);
  expect(h.result.current.unread).toEqual({});
});

it('replays board evidence into a background DM and repairs a previously unavailable body', async () => {
  const room = prefix + 'board-replay';
  await mount([room]);
  const wire = await post(room, 'board');
  await deliver(room, wire);
  // The first live receive stores a shell. Escrow replay must hydrate that same id.
  mock.bodies.set('body', new TextEncoder().encode(JSON.stringify({ text: 'Recovered', title: 'Board' })));
  await deliver(room, wire, true);
  expect(loadPosts('board', room)[0]).toMatchObject({ text: 'Recovered', title: 'Board' });
});

it('real controller restores an encrypted board checkpoint into accepted background DM persistence', async () => {
  const room = prefix + 'board-checkpoint';
  const h = renderHook(() => useMessageAlerts(prefix + 'active', 'observer', friends([room])));
  const enc = generatePostEnc();
  const body = await encryptPostBytes(enc, new TextEncoder().encode(JSON.stringify({ text: 'Restored', title: 'Project', capacity: 4 })));
  const wire = await signed({ type: 'tc-chat:post', roomId: room, surface: 'board', id: 'board', parentId: null,
    kind: 'project', cid: 'encrypted-body', enc });
  const checkpoint = emptyCheckpoint(room); checkpoint.buckets.board.push(wire);
  checkpoint.blobs.push({ cid: 'encrypted-body', name: 'enc.bin', bytes: toBase64(body) });
  const transport = {
    join: async () => {}, leave() {}, send() {}, onMessage: () => () => {}, onPeer: () => () => {},
    storageAdd: async (_name: string, bytes: Uint8Array) => { mock.bodies.set('encrypted-body', bytes); return 'encrypted-body'; },
    storageGet: async () => body,
  };
  const controller = new RoomEscrowController({ roomId: room, wires: () => [], receive: async w => {
    mock.replayed(room, w);
    for (const cb of [...mock.listeners]) await cb(0, 'peer', w, room, true);
  }, changed() {} }, transport, () => ({
    providers: new Map([['daemon', { maxBlob: 32 * 1024 * 1024 }]]),
    join: async () => {}, onProvider: () => () => {}, dispose() {},
    fetchLatest: async () => ({ head: { ...vector.head_signed, schema: SCHEMA }, plaintext: encodeCheckpoint(checkpoint) }),
    saveCheckpoint: async () => { throw new Error('unexpected checkpoint save'); },
  }));
  controllers.push(controller);
  await controller.configure({ mode: 'custom', mistlRoom: 'daemon' });
  await vi.waitFor(() => expect(controller.view.status).toBe('ready'));
  expect(mock.replayed).toHaveBeenCalledWith(room, wire);
  expect(loadPosts('board', room)[0]).toMatchObject({ text: 'Restored', title: 'Project', capacity: 4, enc });
  expect((await evidenceJournal.snapshot(room)).buckets.board).toEqual([wire]);
  expect(h.result.current.unread).toEqual({});
});

it.each(['board', 'calendar', 'gallery'] as const)('applies signed %s edits and deletes in live and restored background DMs', async surface => {
  const room = prefix + surface + '-mutations';
  await mount([room]);
  const wire = await post(room, surface);
  mock.bodies.set('body', new TextEncoder().encode(JSON.stringify({ text: 'Original' })));
  await deliver(room, wire);
  const enc = generatePostEnc();
  const body = { text: 'Edited', title: 'Updated', startsAt: 30, endsAt: 40, location: 'New room',
    thumbCid: 'new-thumb', thumbMimeType: 'image/png', capacity: 5 };
  mock.bodies.set('edited-body', await encryptPostBytes(enc, new TextEncoder().encode(JSON.stringify(body))));
  const edit = await signed({ type: 'tc-chat:post-edit', roomId: room, surface, id: 'edit', targetId: 'post',
    timestamp: 2, cid: 'edited-body', enc });
  await deliver(room, edit);
  expect(loadPosts(surface, room)[0]).toMatchObject({ ...body, enc, cid: 'edited-body', editedAt: 2, editId: 'edit' });
  // Rebuild the post index from the signed evidence as a checkpoint replay would.
  const key = surface === 'board' ? 'tc-chat:board-nodes:' : surface === 'calendar' ? 'tc-chat:calendar-events:' : 'tc-chat:gallery:';
  localStorage.removeItem(key + room);
  await deliver(room, wire, true); await deliver(room, edit, true);
  expect(loadPosts(surface, room)[0]).toMatchObject({ ...body, enc, editedAt: 2 });
  const deletion = await signed({ type: 'tc-chat:post-delete', roomId: room, surface, id: 'delete', targetId: 'post', timestamp: 3 });
  await deliver(room, deletion);
  expect(loadPosts(surface, room)[0]?.deleted).toBe(true);
  // A replayed deletion must also tombstone a rebuilt target.
  localStorage.removeItem(key + room);
  await deliver(room, wire, true); await deliver(room, edit, true); await deliver(room, deletion, true);
  expect(loadPosts(surface, room)[0]?.deleted).toBe(true);
  expect((await evidenceJournal.snapshot(room)).buckets[surface]).toEqual([wire, edit, deletion]);
});

it('rejects invalid, room-mismatched, unsupported and unaccepted non-chat evidence', async () => {
  const room = prefix + 'accepted'; await mount([room]);
  const valid = await post(room, 'board');
  await deliver(room, { ...valid, signature: 'invalid' });
  await deliver(prefix + 'different-transport', valid);
  await deliver(room, await signed({ type: 'tc-chat:post', roomId: room, surface: 'unknown', id: 'unknown',
    parentId: null, kind: 'text', cid: 'body' }));
  const other = prefix + 'unaccepted'; await deliver(other, await post(other, 'board'));
  for (const id of [room, other, prefix + 'different-transport']) {
    expect(loadPosts('board', id)).toEqual([]);
    expect(loadWireLog(id)).toEqual([]);
    expect((await evidenceJournal.snapshot(id)).buckets.board).toEqual([]);
  }
});
