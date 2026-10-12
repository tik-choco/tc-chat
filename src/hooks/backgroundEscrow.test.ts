import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/preact';
import { useRoomEscrow } from './useRoomEscrow';
import { useMessageAlerts } from './useMessageAlerts';
import { ensureDidIdentity } from '../crypto/didIdentity';
import { signWireFields } from '../lib/wireSign';
import { loadPosts } from '../lib/chatStore';
import type { Friend } from '../lib/friendsStore';
import type { RoomCheckpoint } from '../escrow/checkpoint';
const mock = vi.hoisted(() => ({
  listeners: new Set<(event: number, from: string, wire: unknown, room: string, restored?: boolean) => void | Promise<void>>(),
  kv: new Map<string, Uint8Array>(),
  contexts: new Map<string, { evidence(): Promise<RoomCheckpoint> }>(),
  created: vi.fn(), dirty: vi.fn(), disposed: vi.fn(), send: vi.fn(),
}));
vi.mock('../lib/mistClient', () => ({
  getNode: async () => ({ sendMessage: mock.send }), joinAppRoom: async () => {},
  subscribeEvent: (cb: typeof mock.listeners extends Set<infer T> ? T : never) => { mock.listeners.add(cb); return () => { mock.listeners.delete(cb); }; },
  isRawEvent: (event: number) => event === 0, decodeRawPayload: (wire: unknown) => wire,
  replayRoomWire: async (room: string, wire: unknown) => { for (const cb of [...mock.listeners]) await cb(0, '', wire, room, true); },
  storage_get: async () => new TextEncoder().encode(JSON.stringify({ text: 'background body' })),
  storage_kv_get: async (key: string) => mock.kv.get(key),
  storage_kv_set: async (key: string, value: Uint8Array) => { mock.kv.set(key, value); },
  EVENT_PEER_CONNECTED: 5, DELIVERY_RELIABLE: 1,
}));
vi.mock('../escrow/mistTransport', () => ({ createMistEscrowTransport: () => ({}) }));
vi.mock('../escrow/controller', () => ({ RoomEscrowController: class {
  view = { mode: 'auto', mistlRoom: '', room: '', status: 'searching', savedAt: 0, reason: '', omitted: [], droppedWires: {} };
  room: string;
  constructor(ctx: { roomId: string; evidence(): Promise<RoomCheckpoint> }) { this.room = ctx.roomId; mock.contexts.set(ctx.roomId, ctx); mock.created(ctx.roomId); }
  async configure() {} markDirty() { mock.dirty(this.room); }
  async flush() {} async retryNow() {} async dispose() { mock.disposed(this.room); }
} }));
beforeEach(() => { localStorage.clear(); mock.kv.clear(); mock.listeners.clear(); mock.contexts.clear(); vi.clearAllMocks(); });
afterEach(cleanup);
it('SPEC2 W3 activates an evicted accepted DM from the real background persistence path and checkpoints its journal', async () => {
  const identity = await ensureDidIdentity();
  const friends: Friend[] = Array.from({ length: 10 }, (_, i) => ({ did: 'friend-' + i, roomId: 'bg-' + i, name: 'Friend', status: 'accepted', addedAt: 1 }));
  renderHook(() => { useMessageAlerts('active', identity.did, friends); return useRoomEscrow('active', friends.map(f => f.roomId)); });
  await vi.waitFor(() => expect(mock.created).toHaveBeenCalledTimes(8));
  expect(mock.created).not.toHaveBeenCalledWith('bg-9');
  const fields = { type: 'tc-chat:post', roomId: 'bg-9', surface: 'chat', id: 'background-post', parentId: null,
    kind: 'text', cid: 'body', fromId: identity.did, fromName: 'Self', timestamp: 1 };
  const wire = { ...fields, signature: await signWireFields(fields) };
  await act(async () => { for (const cb of [...mock.listeners]) await cb(0, 'peer', wire, 'bg-9'); });
  await vi.waitFor(() => expect(mock.created).toHaveBeenCalledWith('bg-9'));
  expect(mock.disposed).toHaveBeenCalledWith('bg-0');
  expect(loadPosts('chat', 'bg-9')[0]?.text).toBe('background body');
  const checkpoint = await mock.contexts.get('bg-9')!.evidence();
  expect(checkpoint.buckets.chat).toEqual([wire]); expect(mock.dirty).toHaveBeenCalledWith('bg-9');
});
it('SPEC2 W3 dedupes active accepted DMs across switches and ignores unaccepted traffic', async () => {
  const h = renderHook(({ room }) => useRoomEscrow(room, ['dm-open', 'dm-background']), { initialProps: { room: 'dm-open' } });
  await vi.waitFor(() => expect(mock.created).toHaveBeenCalledTimes(2));
  h.rerender({ room: 'dm-background' }); await new Promise(r => setTimeout(r, 10));
  expect(mock.created).toHaveBeenCalledTimes(2); expect(mock.disposed).not.toHaveBeenCalled();
  h.unmount(); await vi.waitFor(() => expect(mock.disposed).toHaveBeenCalledTimes(2));
});
