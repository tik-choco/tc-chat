import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ joined: new Set<string>(), event: null as null | ((type: number, from: string, payload: unknown, room: string) => void), hold: null as null | Promise<void>, fail: false,
  join: vi.fn(), leave: vi.fn(), send: vi.fn(), callbacks: vi.fn() }));
vi.mock('@tik-choco/mistlib-web', () => ({
  MistNode: class {
    async init() {} onEvent(cb: typeof mock.event) { mock.callbacks(); mock.event = cb; } onMediaEvent() {}
    isRoomJoined(room: string) { return mock.joined.has(room); }
    async joinRoomAsync(room: string) { mock.join(room); if (mock.hold) await mock.hold; if (mock.fail) throw new Error('join failed'); mock.joined.add(room); }
    leaveRoom(room: string) { mock.leave(room); mock.joined.delete(room); }
    sendMessage(...args: unknown[]) { mock.send(...args); }
  }, EVENT_RAW: 0, EVENT_NEIGHBORS: 4, EVENT_PEER_CONNECTED: 5, EVENT_PEER_DISCONNECTED: 6,
  DELIVERY_RELIABLE: 1, DELIVERY_UNRELIABLE: 0,
  storage_add: vi.fn(), storage_get: vi.fn(), storage_kv_set: vi.fn(), storage_kv_get: vi.fn(), storage_pin: vi.fn(), storage_unpin: vi.fn(), storage_is_pinned: vi.fn(), storage_add_pinned: vi.fn(),
}));
vi.mock('../lib/mistBuildInfo', () => ({ captureMistBuildInfo() {}, markMistLoadError() {} }));
import { createMistEscrowTransport } from './mistTransport';
import { acquireExtraRoom, acquireRoom, joinAppRoom, replayRoomWire, subscribeEvent } from '../lib/mistClient';
beforeEach(() => { mock.joined.clear(); mock.hold = null; mock.fail = false; mock.join.mockClear(); mock.leave.mockClear(); mock.send.mockClear(); });
describe('mist adapter and shared leases', () => {
  it('shares one join between two adapters and only leaves on final lease release', async () => {
    const a = createMistEscrowTransport(), b = createMistEscrowTransport();
    await Promise.all([a.join('shared'), b.join('shared')]); expect(mock.join).toHaveBeenCalledTimes(1);
    a.leave('shared'); await new Promise(r => setTimeout(r, 0)); expect(mock.leave).not.toHaveBeenCalled();
    b.leave('shared'); await new Promise(r => setTimeout(r, 0)); expect(mock.leave).toHaveBeenCalledWith('shared');
    expect(mock.callbacks).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])('shares ordinary app and escrow joins in either order (appFirst=%s)', async appFirst => {
    const room = 'app-order-' + appFirst, escrow = createMistEscrowTransport();
    if (appFirst) { await joinAppRoom(room); await escrow.join(room); }
    else { await escrow.join(room); await joinAppRoom(room); }
    await joinAppRoom(room); // Reopening a room reuses its one session owner.
    expect(mock.join).toHaveBeenCalledTimes(1);
    escrow.leave(room);
    await new Promise(r => setTimeout(r, 0));
    expect(mock.joined.has(room)).toBe(true);
    expect(mock.leave).not.toHaveBeenCalled();
  });
  it('registers app ownership before an in-flight escrow join finishes releasing', async () => {
    let resolve!: () => void; mock.hold = new Promise(r => { resolve = r; });
    const escrow = createMistEscrowTransport(), room = 'pending-app-owner';
    const joining = escrow.join(room); escrow.leave(room);
    const appJoin = joinAppRoom(room);
    resolve(); await Promise.all([joining, appJoin]);
    expect(mock.join).toHaveBeenCalledTimes(1);
    expect(mock.joined.has(room)).toBe(true);
    expect(mock.leave).not.toHaveBeenCalled();
  });
  it('retains any generic owner until the last release', async () => {
    const a = acquireRoom('owners'), b = acquireRoom('owners'), escrow = createMistEscrowTransport();
    await Promise.all([a.ready, b.ready, escrow.join('owners')]);
    escrow.leave('owners'); a.release();
    await new Promise(r => setTimeout(r, 0));
    expect(mock.joined.has('owners')).toBe(true);
    b.release(); await new Promise(r => setTimeout(r, 0));
    expect(mock.leave).toHaveBeenCalledExactlyOnceWith('owners');
  });
  it('releases failed app ownership and retries without leaving a subsequent owner', async () => {
    mock.fail = true;
    await expect(joinAppRoom('app-failure')).rejects.toThrow('join failed');
    await new Promise(r => setTimeout(r, 0)); mock.fail = false;
    await joinAppRoom('app-failure');
    const escrow = createMistEscrowTransport(); await escrow.join('app-failure');
    mock.leave.mockClear(); escrow.leave('app-failure');
    await new Promise(r => setTimeout(r, 0));
    expect(mock.joined.has('app-failure')).toBe(true);
    expect(mock.leave).not.toHaveBeenCalled();
  });
  it('preserves prejoined app rooms and leaves only its exact owned room', async () => {
    mock.joined.add('existing'); const a = createMistEscrowTransport(); await a.join('existing'); a.leave('existing');
    await new Promise(r => setTimeout(r, 0)); expect(mock.join).not.toHaveBeenCalled(); expect(mock.leave).not.toHaveBeenCalled();
  });
  it('handles release/reacquire while join is in flight, and idempotent releases', async () => {
    let resolve!: () => void; mock.hold = new Promise(r => { resolve = r; });
    const a = acquireExtraRoom('race'); a.release(); a.release(); const b = acquireExtraRoom('race');
    resolve(); await b.ready; expect(mock.join).toHaveBeenCalledTimes(1); expect(mock.leave).not.toHaveBeenCalled();
    b.release(); await new Promise(r => setTimeout(r, 0)); expect(mock.leave).toHaveBeenCalledTimes(1);
  });
  it('cleans failed joins and allows retry', async () => {
    mock.fail = true; const a = createMistEscrowTransport(); await expect(a.join('failure')).rejects.toThrow('join failed');
    await new Promise(r => setTimeout(r, 0)); mock.fail = false; await a.join('failure'); a.leave('failure');
  });
  it('filters exact raw and peer rooms and copies/bounds queued sends', async () => {
    let resolve!: () => void; mock.hold = new Promise(r => { resolve = r; });
    const a = createMistEscrowTransport(), message = vi.fn(), peer = vi.fn(); a.onMessage('q', message); a.onPeer('q', peer);
    const joining = a.join('q'); const bytes = new Uint8Array([1]); a.send('q', 'target', bytes); bytes[0] = 9;
    for (let i = 1; i < 64; i++) a.send('q', null, new Uint8Array());
    expect(() => a.send('q', null, bytes)).toThrow('queue'); expect(() => a.send('q', null, new Uint8Array(16385))).toThrow('16 KiB');
    resolve(); await joining; expect(mock.send.mock.calls[0]).toEqual(['target', new Uint8Array([1]), 1, 'q']);
    for (const room of ['', 'other']) { mock.event!(0, 'x', [1], room); mock.event!(5, 'x', null, room); }
    expect(message).not.toHaveBeenCalled(); expect(peer).not.toHaveBeenCalled();
    mock.event!(0, 'x', [1], 'q'); mock.event!(5, 'x', null, 'q'); mock.event!(6, 'x', null, 'q');
    expect(message).toHaveBeenCalledWith('x', new Uint8Array([1])); expect(peer.mock.calls).toEqual([['x',true],['x',false]]);
    a.leave('q'); mock.event!(0, 'x', [1], 'q'); expect(message).toHaveBeenCalledTimes(1);
  });
  it('awaits the same event subscribers during restore and marks history as restored', async () => {
    const order: string[] = [];
    const off1 = subscribeEvent(async (_e, _id, _bytes, room, restored) => { expect(room).toBe('r'); expect(restored).toBe(true); await new Promise(r => setTimeout(r, 5)); order.push('first'); });
    const off2 = subscribeEvent(() => { order.push('second'); });
    await replayRoomWire('r', { id: 'history' }); expect(order).toEqual(['first','second']); off1(); off2();
  });
});
