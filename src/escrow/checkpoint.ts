import type { SignedWire } from '../lib/chatStore';
import { verifyWire } from '../lib/wireSign';
import { decryptPostBytes, isPostEnc } from '../crypto/postCipher';
import { eligibleRoom, parseConfig, newerConfig } from './config';
import type { EscrowConfig } from './config';
import { sha256, utf8, gzip, supportsGzip } from './crypto';
import type { EscrowTransport } from './client';
export const APP = 'tc-chat';
export const SCHEMA = 'tc-chat/room-checkpoint/1';
export const BUCKETS = ['chat', 'board', 'calendar', 'gallery', 'misc'] as const;
export const MAX_WIRES_PER_BUCKET = 20000;
export type DroppedWires = Partial<Record<typeof BUCKETS[number], number>>;
export const MAX_RAW = 20 * 1024 * 1024;
export const MAX_PLAIN = 30 * 1024 * 1024;
const STRUCTURED = 256 * 1024, THUMB = 1024 * 1024, MEDIA = 2 * 1024 * 1024;
export type OmissionReason = 'budget' | 'too-large' | 'unavailable' | 'legacy-manifest' | 'cid-mismatch';
export interface CheckpointBlob { cid: string; name: string; bytes: string }
export interface RoomCheckpoint { v: 1; app: typeof APP; roomId: string;
  buckets: Record<typeof BUCKETS[number], SignedWire[]>; blobs: CheckpointBlob[];
  omitted: { cid: string; reason: OmissionReason }[]; droppedWires?: DroppedWires }
const text = (v: unknown, max = 4096): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export function validCheckpointWire(w: unknown, room: string): w is SignedWire {
  if (!record(w) || !text(w.id, 128) || !text(w.fromId, 256) || !text(w.signature, 256) ||
      !Number.isSafeInteger(w.timestamp) || (w.timestamp as number) < 0 || w.roomId !== undefined && w.roomId !== room) return false;
  if (w.type === 'tc-chat:escrow-config') return !!parseConfig(w, room);
  if (!text(w.fromName, 4096)) return false;
  if (w.type === 'tc-chat:reaction') return text(w.targetId, 128) && text(w.emoji, 128) && (w.op === 'add' || w.op === 'remove');
  if (!BUCKETS.slice(0, 4).includes(w.surface as never)) return false;
  if (w.type === 'tc-chat:post-delete') return text(w.targetId, 128);
  if (w.type !== 'tc-chat:post' && w.type !== 'tc-chat:post-edit' || !text(w.cid, 256) || w.enc !== undefined && !isPostEnc(w.enc)) return false;
  if (w.type === 'tc-chat:post-edit') return text(w.targetId, 128);
  return ['text', 'project', 'event', 'media', 'file'].includes(w.kind as string) &&
    (w.parentId === null || text(w.parentId, 128)) &&
    (w.fileSize === undefined || Number.isSafeInteger(w.fileSize) && (w.fileSize as number) >= 0) &&
    (w.fileName === undefined || text(w.fileName)) && (w.mimeType === undefined || typeof w.mimeType === 'string');
}
export function toBase64(bytes: Uint8Array): string {
  let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
}
export function fromBase64(s: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(s)) throw new Error('Invalid blob base64');
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}
export function emptyCheckpoint(roomId: string): RoomCheckpoint {
  if (!eligibleRoom(roomId)) throw new Error('Room excluded from escrow');
  return { v: 1, app: APP, roomId, buckets: { chat: [], board: [], calendar: [], gallery: [], misc: [] }, blobs: [], omitted: [] };
}
function wireOrder(a: SignedWire, b: SignedWire): number {
  return (a.timestamp as number) - (b.timestamp as number) ||
    (a.id! < b.id! ? -1 : a.id! > b.id! ? 1 : canonical(a) < canonical(b) ? -1 : canonical(a) > canonical(b) ? 1 : 0);
}
/** Retain newest history, pinning the winning shared setting even with an older timestamp. */
export function boundWires(c: RoomCheckpoint): void {
  for (const b of BUCKETS) {
    const wires = c.buckets[b];
    if (wires.length <= MAX_WIRES_PER_BUCKET) continue;
    wires.sort(wireOrder);
    let config: EscrowConfig | undefined;
    for (const w of wires) if (w.type === 'tc-chat:escrow-config' && (!config || newerConfig(w as EscrowConfig, config))) config = w as EscrowConfig;
    const kept = wires.slice(-MAX_WIRES_PER_BUCKET);
    if (config && !kept.includes(config)) { kept[0] = config; kept.sort(wireOrder); }
    c.droppedWires = { ...c.droppedWires, [b]: Math.min(Number.MAX_SAFE_INTEGER, (c.droppedWires?.[b] ?? 0) + wires.length - kept.length) };
    c.buckets[b] = kept;
  }
}
export function logOrder(c: RoomCheckpoint): SignedWire[] {
  return BUCKETS.flatMap(b => c.buckets[b]).sort(wireOrder);
}
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (record(v)) return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
export async function unionWires(wires: SignedWire[]): Promise<SignedWire[]> {
  const seen = new Set<string>(), result: SignedWire[] = [];
  for (const w of wires) { const hash = await sha256(utf8(canonical(w))); if (!seen.has(hash)) { seen.add(hash); result.push(w); } }
  return result.sort(wireOrder);
}
export function bucket(w: SignedWire): typeof BUCKETS[number] { if (w.type === 'tc-chat:escrow-config') return 'misc'; return BUCKETS.slice(0, 4).includes(w.surface as never) ? w.surface as typeof BUCKETS[number] : 'misc'; }
export async function mergeCheckpoints(a: RoomCheckpoint, b: RoomCheckpoint): Promise<RoomCheckpoint> {
  if (a.roomId !== b.roomId) throw new Error('Checkpoint room mismatch');
  const c = emptyCheckpoint(a.roomId);
  for (const w of await unionWires([...logOrder(a), ...logOrder(b)])) c.buckets[bucket(w)].push(w);
  const blobs = new Map(a.blobs.map(v => [v.cid, v]));
  for (const v of b.blobs) if (!blobs.has(v.cid)) blobs.set(v.cid, v);
  // Shared diagnostic ancestry must not be counted twice during CAS unions.
  for (const bucket of BUCKETS) {
    const n = Math.max(a.droppedWires?.[bucket] ?? 0, b.droppedWires?.[bucket] ?? 0);
    if (n) c.droppedWires = { ...c.droppedWires, [bucket]: n };
  }
  c.blobs = [...blobs.values()];
  c.omitted = [...new Map([...a.omitted, ...b.omitted].filter(v => !blobs.has(v.cid)).map(v => [v.cid, v])).values()];
  boundWires(c);
  await pruneBlobs(c, 'budget');
  return c;
}
interface Ref { cid: string; name: string | null; limit: number; wire: SignedWire; structured: boolean; optional: boolean }
function refs(c: RoomCheckpoint): Ref[] {
  return logOrder(c).filter(w => w.type === 'tc-chat:post' || w.type === 'tc-chat:post-edit').map(w => {
    const structured = w.type === 'tc-chat:post-edit' || ['text', 'project', 'event'].includes(w.kind as string);
    return { cid: w.cid as string, name: w.enc ? 'enc.bin' : !structured && text(w.fileName) ? w.fileName : null,
      limit: structured ? STRUCTURED : MEDIA + (w.enc ? 28 : 0), wire: w, structured, optional: !structured };
  });
}
async function thumbnail(ref: Ref, bytes: Uint8Array): Promise<Ref | null> {
  if (!ref.structured) return null;
  try {
    const plain = isPostEnc(ref.wire.enc) ? await decryptPostBytes(ref.wire.enc, bytes) : bytes;
    const body: unknown = JSON.parse(new TextDecoder().decode(plain));
    return record(body) && text(body.thumbCid, 256) ? { ...ref, cid: body.thumbCid, name: ref.wire.enc ? 'enc.bin' : null, limit: THUMB, structured: false, optional: true } : null;
  } catch { return null; }
}
function admits(ref: Ref, blob: CheckpointBlob, size: number): boolean {
  return ref.cid === blob.cid && ref.name === blob.name && size <= ref.limit &&
    (ref.structured || ref.wire.fileSize === undefined || (ref.wire.fileSize as number) <= MEDIA);
}
async function admittedRefs(c: RoomCheckpoint, raw?: Map<string, Uint8Array>): Promise<Ref[]> {
  const allowed = refs(c), blobs = new Map(c.blobs.map(b => [b.cid, b]));
  for (const ref of [...allowed]) {
    const blob = blobs.get(ref.cid);
    if (ref.structured && blob && admits(ref, blob, raw?.get(ref.cid)?.length ?? blobSize(blob))) {
      const t = await thumbnail(ref, raw?.get(ref.cid) ?? fromBase64(blob.bytes)); if (t) allowed.push(t);
    }
  }
  return allowed;
}
/** Recompute thumbnail references from bodies still admitted by the exact parser rules. */
async function pruneBlobs(c: RoomCheckpoint, reason: OmissionReason): Promise<void> {
  const allowed = await admittedRefs(c);
  c.blobs = c.blobs.filter(b => {
    if (allowed.some(r => admits(r, b, blobSize(b)))) return true;
    c.omitted.push({ cid: b.cid, reason }); return false;
  });
  const retained = new Set(c.blobs.map(b => b.cid));
  c.omitted = [...new Map(c.omitted.filter(o => !retained.has(o.cid)).map(o => [o.cid, o])).values()];
}
export async function parseCheckpoint(bytes: Uint8Array, room: string): Promise<RoomCheckpoint> {
  if (!eligibleRoom(room) || bytes.length > MAX_PLAIN) throw new Error('Checkpoint size or room invalid');
  const v: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!record(v) || v.v !== 1 || v.app !== APP || v.roomId !== room || !record(v.buckets) || !Array.isArray(v.blobs) || !Array.isArray(v.omitted)) throw new Error('Invalid checkpoint');
  for (const b of BUCKETS) {
    const wires = v.buckets[b];
    if (!Array.isArray(wires) || wires.length > MAX_WIRES_PER_BUCKET) throw new Error('Invalid checkpoint bucket');
    for (const w of wires) if (!validCheckpointWire(w, room) || bucket(w) !== b || !await verifyWire(w)) throw new Error('Invalid signed checkpoint wire');
  }
  if (v.droppedWires !== undefined && (!record(v.droppedWires) || Object.entries(v.droppedWires).some(([b, n]) => !BUCKETS.includes(b as typeof BUCKETS[number]) || !Number.isSafeInteger(n) || (n as number) < 0))) throw new Error('Invalid dropped-wire diagnostic');
  const c = v as unknown as RoomCheckpoint;
  const raw = new Map<string, Uint8Array>(); let total = 0;
  for (const b of c.blobs) {
    if (!record(b) || !text(b.cid, 256) || !text(b.name) || typeof b.bytes !== 'string' || b.bytes.length > Math.ceil((MEDIA + 28) / 3) * 4 || raw.has(b.cid)) throw new Error('Invalid checkpoint blob');
    const data = fromBase64(b.bytes); total += data.length;
    if (total > MAX_RAW) throw new Error('Checkpoint blob budget exceeded'); raw.set(b.cid, data);
  }
  const allowed = await admittedRefs(c, raw);
  for (const b of c.blobs) if (!allowed.some(r => admits(r, b, raw.get(b.cid)!.length))) throw new Error('Unrelated or oversized checkpoint blob');
  for (const o of c.omitted) if (!record(o) || !text(o.cid, 256) || !['budget','too-large','unavailable','legacy-manifest','cid-mismatch'].includes(o.reason)) throw new Error('Invalid checkpoint omission');
  return c;
}
function blobSize(b: CheckpointBlob): number {
  return b.bytes.length / 4 * 3 - (b.bytes.endsWith('==') ? 2 : b.bytes.endsWith('=') ? 1 : 0);
}
function rawSize(c: RoomCheckpoint): number { return c.blobs.reduce((n, b) => n + blobSize(b), 0); }
export function encodeCheckpoint(c: RoomCheckpoint): Uint8Array {
  const bytes = utf8(JSON.stringify(c));
  if (bytes.length > MAX_PLAIN || rawSize(c) > MAX_RAW) throw new Error('Checkpoint capacity exceeded');
  return bytes;
}
export async function deadline<T>(p: Promise<T>, ms = 8000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([p, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error('Body retrieval timed out')), ms); })]); }
  finally { clearTimeout(timer!); }
}
export async function collectCheckpoint(room: string, wires: SignedWire[], transport: Pick<EscrowTransport, 'storageGet'>, remote = emptyCheckpoint(room)): Promise<RoomCheckpoint> {
  const local = emptyCheckpoint(room);
  for (const w of wires) {
    if (!validCheckpointWire(w, room) || !await verifyWire(w)) throw new Error('Invalid local escrow wire');
    local.buckets[bucket(w)].push(w);
  }
  const c = await mergeCheckpoints(remote, local);
  const blobs = new Map(c.blobs.map(b => [b.cid, b])); let total = rawSize(c);
  const omitted = new Map(c.omitted.map(o => [o.cid, o]));
  const queue = refs(c).sort((a, b) => Number(a.optional) - Number(b.optional));
  const seen = new Set<string>();
  async function get(ref: Ref) {
    if (seen.has(ref.cid)) return; seen.add(ref.cid);
    let data: Uint8Array | undefined;
    const old = blobs.get(ref.cid);
    if (old) { if (!ref.structured) return; data = fromBase64(old.bytes); }
    else if (!ref.name) omitted.set(ref.cid, { cid: ref.cid, reason: 'legacy-manifest' });
    else if (!ref.structured && typeof ref.wire.fileSize === 'number' && ref.wire.fileSize > MEDIA) omitted.set(ref.cid, { cid: ref.cid, reason: 'too-large' });
    else try {
      data = await deadline(transport.storageGet(ref.cid));
      if (data.length > ref.limit) { omitted.set(ref.cid, { cid: ref.cid, reason: 'too-large' }); data = undefined; }
      else if (total + data.length > MAX_RAW) { omitted.set(ref.cid, { cid: ref.cid, reason: 'budget' }); data = undefined; }
      else { total += data.length; blobs.set(ref.cid, { cid: ref.cid, name: ref.name, bytes: toBase64(data) }); omitted.delete(ref.cid); }
    } catch { omitted.set(ref.cid, { cid: ref.cid, reason: 'unavailable' }); }
    if (data) { const t = await thumbnail(ref, data); if (t) queue.push(t); }
  }
  // Two outstanding body requests at most, structured bodies first.
  while (queue.length) await Promise.all(queue.splice(0, 2).map(get));
  c.blobs = [...blobs.values()]; c.omitted = [...omitted.values()].filter(o => !blobs.has(o.cid));
  await fitCheckpoint(c, Infinity); return c;
}
/** Drops blobs that do not reproduce the signed CID; never rewrites wire CIDs. */
export async function restoreCheckpoint(c: RoomCheckpoint, transport: Pick<EscrowTransport, 'storageAdd'>,
  receive: (wire: SignedWire) => Promise<void>, active = () => true): Promise<void> {
  for (const b of [...c.blobs]) {
    if (!active()) return;
    if (!c.blobs.includes(b)) continue;
    try { if (await deadline(transport.storageAdd(b.name, fromBase64(b.bytes))) !== b.cid) throw new Error('CID mismatch'); }
    catch {
      c.omitted.push({ cid: b.cid, reason: 'cid-mismatch' }); c.blobs = c.blobs.filter(v => v !== b);
      await pruneBlobs(c, 'cid-mismatch');
    }
  }
  for (const w of logOrder(c)) { if (!active()) return; await receive(w); }
}
/** Fit wire, application byte, and provider budgets with visible omissions. */
export async function fitCheckpoint(c: RoomCheckpoint, maxBlob: number): Promise<Uint8Array> {
  boundWires(c);
  await pruneBlobs(c, 'budget');
  const allowed = await admittedRefs(c);
  const optional = new Set(allowed.filter(r => r.optional).map(r => r.cid));
  c.blobs.sort((a, b) => Number(optional.has(a.cid)) - Number(optional.has(b.cid)));
  while (true) {
    // CAS unions can exceed application budgets before provider compression.
    // Trim first; the strict encoder must only see an admissible checkpoint.
    const plain = utf8(JSON.stringify(c));
    if (plain.length <= MAX_PLAIN && rawSize(c) <= MAX_RAW) {
      const size = maxBlob === Infinity ? 0 : supportsGzip() ? (await gzip(plain)).length + 28 : plain.length + 28;
      if (size <= maxBlob) return encodeCheckpoint(c);
    }
    const dropped = c.blobs.pop();
    if (!dropped) throw new Error('Provider checkpoint capacity exceeded');
    c.omitted.push({ cid: dropped.cid, reason: 'budget' });
    await pruneBlobs(c, 'budget');
  }
}
