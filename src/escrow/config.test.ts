import { beforeEach, expect, it } from 'vitest';
import { ensureDidIdentity } from '../crypto/didIdentity';
import { signWireFields } from '../lib/wireSign';
import { parseConfig, newerConfig, loadConfig, persistConfig, parseHint, inviteParam, eligibleRoom } from './config';
import { buildInviteUrl } from '../lib/roomInvite';
import type { EscrowConfig } from './config';
beforeEach(() => localStorage.clear());
it('validates signed settings, exact room, modes, custom room syntax and excluded topics', async () => {
  const did = await ensureDidIdentity();
  const w = { type: 'tc-chat:escrow-config' as const, v: 1 as const, id: 'a', roomId: 'Room', fromId: did.did, timestamp: 1, rev: 1, mode: 'custom' as const, mistlRoom: 'daemon/Room:1' };
  const signed = { ...w, signature: await signWireFields(w) };
  expect(parseConfig(signed, 'Room')).toEqual(signed); persistConfig(signed); expect(await loadConfig('Room')).toEqual(signed);
  persistConfig({ ...signed, mistlRoom: 'tampered' }); expect(await loadConfig('Room')).toBeNull();
  expect(parseConfig(signed, 'room')).toBeNull();
  for (const mistlRoom of ['', 'bad room', 'Room', 'global', 'tc-chat:personal', 'a'.repeat(97)]) expect(parseConfig({ ...signed, mistlRoom }, 'Room')).toBeNull();
  expect(parseConfig({ ...signed, mode: 'off', mistlRoom: '' }, 'Room')).not.toBeNull();
  for (const room of ['global','tc-chat:personal']) { expect(eligibleRoom(room)).toBe(false); expect(await loadConfig(room)).toBeNull(); expect(parseHint('daemon', room)).toBeNull(); }
});
it('converges by revision, DID then original id with deterministic ordering', () => {
  const a = { rev: 2, fromId: 'a', id: 'a' } as EscrowConfig;
  expect(newerConfig({ ...a, rev: 3, fromId: '0' }, a)).toBe(true);
  expect(newerConfig({ ...a, fromId: 'b' }, a)).toBe(true);
  expect(newerConfig({ ...a, id: 'b' }, a)).toBe(true);
  expect(newerConfig(a, a)).toBe(false);
});
it('carries custom/off invite hints, omits Auto, and retains the existing name encoding', () => {
  expect(inviteParam({ mode: 'auto', mistlRoom: '' })).toBeNull();
  expect(buildInviteUrl('r', 'Room name', 'https://example.test/', 'daemon/custom')).toBe('https://example.test/?name=Room%20name&mistl=daemon%2Fcustom#/r');
  expect(buildInviteUrl('r', '', 'https://example.test/', 'off')).toContain('?mistl=off#/r');
  expect(parseHint('off','r')).toEqual({ mode: 'off', mistlRoom: '' }); expect(parseHint('bad room','r')).toBeNull();
});
