import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RoomEscrowSession } from '../session';
import { appendWireLog } from '../../lib/chatStore';
import { ensureDidIdentity } from '../../crypto/didIdentity';
import { signWireFields } from '../../lib/wireSign';

const mock = vi.hoisted(() => ({
  get: vi.fn(async () => undefined),
  set: vi.fn(async () => {}),
  send: vi.fn(),
}));
vi.mock('../../lib/mistClient', () => ({
  getNode: async () => ({ sendMessage: mock.send }),
  subscribeEvent: () => () => {},
  isRawEvent: () => true,
  decodeRawPayload: (x: unknown) => x,
  replayRoomWire: async () => {},
  EVENT_PEER_CONNECTED: 5,
  DELIVERY_RELIABLE: 0,
  storage_kv_get: mock.get,
  storage_kv_set: mock.set,
}));
vi.mock('../mistTransport', () => ({
  createMistEscrowTransport: () => ({
    join: async () => {}, leave() {}, send() {},
    onMessage: () => () => {}, onPeer: () => () => {},
    storageAdd: async () => 'cid',
    storageGet: async () => new Uint8Array(),
  }),
}));
let sessions: RoomEscrowSession[];
beforeEach(() => {
  localStorage.clear(); vi.useFakeTimers(); sessions = [];
  mock.get.mockReset().mockResolvedValue(undefined);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(sessions.map(s => s.dispose()));
  vi.useRealTimers();
});
async function off(roomId: string) {
  const identity = await ensureDidIdentity();
  const fields = {
    type: 'tc-chat:escrow-config' as const, v: 1 as const,
    id: 'off-wire', roomId, fromId: identity.did,
    timestamp: 1, rev: 1, mode: 'off' as const, mistlRoom: '',
  };
  return { ...fields, signature: await signWireFields(fields) };
}
it('signed Off must stop the live controller even if config persistence hits quota', async () => {
  const roomId = 'live-off-quota';
  const s = new RoomEscrowSession(roomId, () => {});
  sessions.push(s); await s.ready;
  expect(s.controller.view.mode).toBe('auto');
  const wire = await off(roomId);
  const setItem = localStorage.setItem.bind(localStorage);
  const persist = vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
    if (key === 'tc-chat:escrow-config:v1:' + roomId)
      throw new Error('QuotaExceededError');
    return setItem(key, value);
  });
  await s.adopt(wire).catch(() => {});
  // Redelivery must not leave a permanently half-applied config either.
  await s.adopt(wire).catch(() => {});
  expect(s.config?.mode).toBe('off');
  expect(s.controller.view.mode).toBe('off');
  expect(s.persistenceError).toBeTruthy();
  persist.mockImplementation(setItem);
  await vi.advanceTimersByTimeAsync(1000);
  expect(s.persistenceError).toBeNull();
  expect(JSON.parse(localStorage.getItem('tc-chat:escrow-config:v1:' + roomId)!)).toEqual(wire);
});
it('startup must honor a signed Off in the live log when OPFS is unavailable', async () => {
  const roomId = 'startup-off-opfs';
  appendWireLog(roomId, await off(roomId));
  mock.get.mockRejectedValue(new Error('OPFS unavailable'));
  const s = new RoomEscrowSession(roomId, () => {});
  sessions.push(s); await s.ready;
  expect(s.controller.view.mode).toBe('off');
});
