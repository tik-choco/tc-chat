import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/preact';
import { useRoomEscrow } from './useRoomEscrow';
import { ensureDidIdentity } from '../crypto/didIdentity';
import { signWireFields } from '../lib/wireSign';
import { loadWireLog } from '../lib/chatStore';
import { loadConfig } from '../escrow/config';
const mock = vi.hoisted(() => ({ listeners: new Set<(e: number, from: string, bytes: unknown, room: string) => void | Promise<void>>(), send: vi.fn(), configure: vi.fn(async (_s: unknown) => {}), dispose: vi.fn(), created: vi.fn(), dirty: vi.fn() }));
vi.mock('../lib/mistClient', () => ({ getNode: async () => ({ sendMessage: mock.send }), subscribeEvent: (cb: typeof mock.listeners extends Set<infer T> ? T : never) => { mock.listeners.add(cb); return () => { mock.listeners.delete(cb); }; },
  decodeRawPayload: (v: unknown) => v, isRawEvent: (e: number) => e === 0, EVENT_PEER_CONNECTED: 5, DELIVERY_RELIABLE: 1, replayRoomWire: async () => {} }));
vi.mock('../escrow/mistTransport', () => ({ createMistEscrowTransport: () => ({}) }));
vi.mock('../escrow/controller', () => ({ RoomEscrowController: class { constructor() { mock.created(); } configure = mock.configure; dispose = mock.dispose; markDirty = mock.dirty; retryNow = vi.fn(); flush = vi.fn(); } }));
beforeEach(() => { localStorage.clear(); mock.listeners.clear(); vi.clearAllMocks(); window.history.replaceState(null, '', '/#/r'); });
async function signed(mode: 'auto' | 'off' | 'custom', rev = 1, id = 'cfg') {
  const identity = await ensureDidIdentity();
  const w = { type: 'tc-chat:escrow-config' as const, v: 1 as const, roomId: 'r', id, fromId: identity.did, timestamp: 1, rev, mode, mistlRoom: mode === 'custom' ? 'daemon/r' : '' };
  return { ...w, signature: await signWireFields(w) };
}
describe('active room shared setting hook', () => {
  it('never creates an escrow controller for global or personal; tears down on room switch', async () => {
    const h = renderHook(({ room }: { room: string }) => useRoomEscrow(room), { initialProps: { room: 'global' } });
    expect(mock.created).not.toHaveBeenCalled(); h.rerender({ room: 'tc-chat:personal' }); expect(mock.created).not.toHaveBeenCalled();
    h.rerender({ room: 'r' }); await waitFor(() => expect(mock.configure).toHaveBeenCalledWith({ mode: 'auto', mistlRoom: '' }));
    h.rerender({ room: 'other' }); await waitFor(() => expect(mock.created).toHaveBeenCalledTimes(2)); expect(mock.dispose).toHaveBeenCalledTimes(1); h.unmount();
  });
  it('uses a custom invite hint until a verified config supersedes it and resends the retained original on exact-room peer join', async () => {
    window.history.replaceState(null, '', '/?mistl=daemon%2Fhint#/r');
    const h = renderHook(() => useRoomEscrow('r'));
    await waitFor(() => expect(mock.configure).toHaveBeenCalledWith({ mode: 'custom', mistlRoom: 'daemon/hint' }));
    const w = await signed('off');
    await act(async () => { for (const cb of mock.listeners) await cb(0, 'peer', w, 'other'); }); expect(h.result.current.config).toBeNull();
    await act(async () => { for (const cb of mock.listeners) await cb(0, 'peer', { ...w, mode: 'auto' }, 'r'); }); expect(h.result.current.config).toBeNull();
    await act(async () => { for (const cb of mock.listeners) await cb(0, 'peer', w, 'r'); });
    expect(h.result.current.config).toEqual(w); expect(await loadConfig('r')).toEqual(w); expect(loadWireLog('r')).toContainEqual(w);
    mock.send.mockClear(); await act(async () => { for (const cb of mock.listeners) await cb(5, 'daemon', null, 'tce-other'); }); expect(mock.send).not.toHaveBeenCalled();
    await act(async () => { for (const cb of mock.listeners) await cb(5, 'new-peer', null, 'r'); });
    expect(mock.send).toHaveBeenCalledWith('new-peer', w, 1, 'r'); h.unmount();
  });
  it('creates a signed local setting at the next revision and retains higher remote winners', async () => {
    const h = renderHook(() => useRoomEscrow('r')); await waitFor(() => expect(mock.configure).toHaveBeenCalled());
    const remote = await signed('off', 9);
    await act(async () => { for (const cb of mock.listeners) await cb(0, 'peer', remote, 'r'); });
    await act(async () => { await h.result.current.configure('custom', 'new/daemon'); });
    const cfg = h.result.current.config!; expect(cfg.rev).toBe(10); expect(cfg.mistlRoom).toBe('new/daemon'); expect(await loadConfig('r')).toEqual(cfg);
    await act(async () => { for (const cb of mock.listeners) await cb(0, 'peer', remote, 'r'); }); expect(h.result.current.config).toEqual(cfg); h.unmount();
  });
});
