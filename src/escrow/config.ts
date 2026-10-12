import type { SignedWire } from '../lib/chatStore';
import { GLOBAL_ROOM_ID, PERSONAL_ROOM_ID } from '../lib/util';
import { verifyWire } from '../lib/wireSign';
export type EscrowMode = 'auto' | 'custom' | 'off';
export interface EscrowSetting { mode: EscrowMode; mistlRoom: string }
export interface EscrowConfig extends SignedWire, EscrowSetting {
  type: 'tc-chat:escrow-config'; v: 1; id: string; roomId: string;
  fromId: string; timestamp: number; rev: number; signature: string;
}
export const eligibleRoom = (room: string | null): room is string => !!room && room !== GLOBAL_ROOM_ID && room !== PERSONAL_ROOM_ID;
export const validCustomRoom = (room: string, appRoom: string) => /^[A-Za-z0-9_./:-]{1,96}$/.test(room) && room !== appRoom && eligibleRoom(room);
export function parseConfig(value: unknown, roomId: string): EscrowConfig | null {
  if (!eligibleRoom(roomId) || !value || typeof value !== 'object') return null;
  const v = value as EscrowConfig;
  if (v.type !== 'tc-chat:escrow-config' || v.v !== 1 || v.roomId !== roomId ||
    typeof v.id !== 'string' || !v.id || v.id.length > 128 || typeof v.fromId !== 'string' || typeof v.signature !== 'string' ||
    !Number.isSafeInteger(v.rev) || v.rev < 0 || v.rev >= Number.MAX_SAFE_INTEGER ||
    !Number.isSafeInteger(v.timestamp) || v.timestamp < 0 || typeof v.mistlRoom !== 'string') return null;
  if (v.mode === 'custom' ? !validCustomRoom(v.mistlRoom, roomId) : (v.mode !== 'auto' && v.mode !== 'off') || v.mistlRoom !== '') return null;
  return v;
}
export function newerConfig(a: EscrowConfig, b: EscrowConfig): boolean {
  return a.rev > b.rev || a.rev === b.rev && (a.fromId > b.fromId || a.fromId === b.fromId && a.id > b.id);
}
const key = (room: string) => 'tc-chat:escrow-config:v1:' + room;
export async function loadConfig(room: string): Promise<EscrowConfig | null> {
  if (!eligibleRoom(room)) return null;
  try { const v = parseConfig(JSON.parse(localStorage.getItem(key(room)) ?? 'null'), room); return v && await verifyWire(v) ? v : null; } catch { return null; }
}
export function persistConfig(v: EscrowConfig): void { localStorage.setItem(key(v.roomId), JSON.stringify(v)); }
export function parseHint(value: string | null, room: string): EscrowSetting | null {
  if (!eligibleRoom(room)) return null;
  return value === 'off' ? { mode: 'off', mistlRoom: '' } : value && validCustomRoom(value, room) ? { mode: 'custom', mistlRoom: value } : null;
}
export function inviteParam(setting: EscrowSetting): string | null { return setting.mode === 'auto' ? null : setting.mode === 'off' ? 'off' : setting.mistlRoom; }
export function retainedInviteParam(room: string): string | null {
  if (!eligibleRoom(room)) return null;
  try { const v = parseConfig(JSON.parse(localStorage.getItem(key(room)) ?? 'null'), room); return v ? inviteParam(v) : localStorage.getItem('tc-chat:escrow-hint:v1:' + room); } catch { return null; }
}
