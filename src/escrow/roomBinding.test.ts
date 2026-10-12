import { expect, it } from 'vitest';
import { roomBindingVectors } from './roomBinding.fixture';
import { verifyWire } from '../lib/wireSign';
import { verifyStringWithDid } from '../crypto/didIdentity';
// Frozen pre-W3 browser canonicalizer: extra fields were always covered.
function legacyStableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(legacyStableStringify).join(',') + ']';
  return '{' + Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + legacyStableStringify(v)).join(',') + '}';
}
it.each(roomBindingVectors)('roomId-bound $wire.type remains verifiable by old browsers with the exact canonical payload', async ({ wire, payload }) => {
  const unsigned: Record<string, unknown> = { ...wire }; delete unsigned.signature;
  expect(legacyStableStringify(unsigned)).toBe(payload);
  expect(await verifyStringWithDid(wire.fromId, payload, wire.signature)).toBe(true);
  expect(await verifyWire(wire)).toBe(true);
  expect(await verifyWire({ ...wire, roomId: 'wrong' })).toBe(false);
});
