import { expect, it, vi } from 'vitest';
import { RoomEscrowRegistry, MAX_ROOM_CONTROLLERS } from './registry';
function setup(limit = MAX_ROOM_CONTROLLERS) {
  let live = 0, peak = 0;
  const create = vi.fn((_room: string) => {
    peak = Math.max(peak, ++live);
    return { markDirty: vi.fn(), flush: vi.fn(async () => {}), dispose: vi.fn(async () => { live--; }) };
  });
  const selected = vi.fn();
  return { r: new RoomEscrowRegistry(create, selected, limit), create, selected, peak: () => peak };
}
it('creates active + accepted DMs once per room, excludes local rooms, removes withdrawn DMs', async () => {
  const { r, create, selected } = setup();
  await r.setRooms('dm-a', ['dm-a', 'dm-b', 'dm-b', 'global', 'tc-chat:personal']);
  expect(create.mock.calls.map(c => c[0])).toEqual(['dm-a', 'dm-b']);
  const a = r.sessions.get('dm-a'), b = r.sessions.get('dm-b')!;
  await r.setRooms('dm-b', ['dm-a', 'dm-b']);
  expect(create).toHaveBeenCalledTimes(2); expect(selected).toHaveBeenLastCalledWith(b); expect(a!.flush).toHaveBeenCalledOnce();
  await r.setRooms('dm-b', ['dm-b']); expect(a!.dispose).toHaveBeenCalledOnce();
  await r.touch('pending-dm'); expect(create).toHaveBeenCalledTimes(2);
  await r.dispose(); expect(b.dispose).toHaveBeenCalledOnce();
});
it('bounds actual concurrent controllers to eight and activates an evicted DM on accepted wire activity', async () => {
  const s = setup(); const dms = Array.from({ length: 10 }, (_, i) => 'dm-' + i);
  await s.r.setRooms('active', dms);
  expect(s.r.sessions.size).toBe(8); expect(s.r.sessions.has('dm-9')).toBe(false);
  await s.r.touch('dm-0'); // most recently used, so dm-1 is evicted next
  const old = s.r.sessions.get('dm-1')!;
  await s.r.touch('dm-9');
  expect(old.dispose).toHaveBeenCalledOnce(); expect(s.r.sessions.has('dm-0')).toBe(true);
  expect(s.r.sessions.has('active')).toBe(true); expect(s.r.sessions.get('dm-9')!.markDirty).toHaveBeenCalledOnce();
  expect(s.peak()).toBe(8); await s.r.flush(); await s.r.dispose();
});
it('waits for eviction flush/release before opening a replacement and cancels stale queued rooms', async () => {
  const s = setup(2); await s.r.setRooms('active', ['a', 'b']);
  let release!: () => void;
  s.r.sessions.get('a')!.dispose.mockImplementationOnce(() => new Promise<void>(r => { release = r; }));
  const rotation = s.r.touch('b');
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  expect(s.create).toHaveBeenCalledTimes(2);
  const withdrawal = s.r.setRooms('active', []);
  release(); await rotation; await withdrawal;
  expect(s.create).toHaveBeenCalledTimes(2); expect(s.r.sessions.size).toBe(1);
  await s.r.dispose();
});
