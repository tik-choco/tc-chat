import type { SignedWire } from '../lib/chatStore';
import { storage_kv_get, storage_kv_set } from '../lib/mistClient';
import { verifyWire } from '../lib/wireSign';
import { eligibleRoom } from './config';
import { boundWires, bucket, canonical, emptyCheckpoint, logOrder, mergeCheckpoints, validCheckpointWire } from './checkpoint';
import type { RoomCheckpoint } from './checkpoint';

export const journalKey = (room: string) => 'tc-chat:escrow-journal:v1:' + room;
interface Entry {
  pending: Map<string, SignedWire>; checkpoint: RoomCheckpoint; keys: Set<string>;
  queue: Promise<void>; dirty?: boolean; busy?: number; timer?: ReturnType<typeof setTimeout>;
}
/** Signed evidence survives the short live replay window. Failed reads never overwrite OPFS. */
export class EvidenceJournal {
  private entries = new Map<string, Entry>();
  private storage: { get(key: string): Promise<Uint8Array | null | undefined>; set(key: string, bytes: Uint8Array): Promise<unknown> };
  constructor(storage = { get: (key: string) => storage_kv_get(key), set: (key: string, bytes: Uint8Array) => storage_kv_set(key, bytes) }) { this.storage = storage; }
  record(room: string, wire: SignedWire): boolean {
    if (!eligibleRoom(room) || !validCheckpointWire(wire, room)) return false;
    const e = this.entry(room), key = canonical(wire);
    if (e.keys.has(key) || e.pending.has(key)) return false;
    // Capture before appendWireLog can trim its bucket; verification is queued below.
    e.dirty = true;
    e.pending.set(key, JSON.parse(JSON.stringify(wire)) as SignedWire);
    if (!e.timer) e.timer = setTimeout(() => {
      e.timer = undefined;
      void this.snapshot(room).catch(error => console.warn('tc-chat: escrow journal unavailable', error));
    }, 100);
    return true;
  }
  private entry(room: string): Entry {
    let e = this.entries.get(room);
    if (!e) { e = { pending: new Map(), checkpoint: emptyCheckpoint(room), keys: new Set(), queue: Promise.resolve() }; this.entries.set(room, e); }
    else { this.entries.delete(room); this.entries.set(room, e); }
    return e;
  }
  async snapshot(room: string, seed: SignedWire[] = []): Promise<RoomCheckpoint> {
    if (!eligibleRoom(room)) throw new Error('Room excluded from escrow journal');
    const e = this.entry(room);
    clearTimeout(e.timer); e.timer = undefined;
    e.busy = (e.busy ?? 0) + 1;
    let result!: RoomCheckpoint;
    const task = e.queue.then(async () => {
      const pending = [...e.pending.values()]; e.pending.clear();
      // Verify and bound the in-memory delta even when OPFS cannot be read yet.
      for (const w of [...seed, ...pending]) {
        const key = canonical(w);
        if (!e.keys.has(key) && validCheckpointWire(w, room) && await verifyWire(w)) {
          e.keys.add(key); e.checkpoint.buckets[bucket(w)].push(w);
        }
      }
      boundWires(e.checkpoint);
      e.keys = new Set(logOrder(e.checkpoint).map(canonical));
      // Cross-tab read/merge/write must be one transaction, including every reread.
      if (!navigator.locks) throw new Error('Web Locks unavailable for escrow journal');
      await navigator.locks.request(journalKey(room), async () => {
        const raw = await this.storage.get(journalKey(room));
        const c = emptyCheckpoint(room);
        if (raw) {
          const stored = JSON.parse(new TextDecoder().decode(raw)) as RoomCheckpoint;
          if (stored.v !== 1 || stored.app !== c.app || stored.roomId !== room || !stored.buckets) throw new Error('Invalid escrow journal');
          // Reject corrupt structure without replacing the stored journal; bad signed records are discarded.
          for (const b of Object.keys(c.buckets) as (keyof typeof c.buckets)[]) {
            if (!Array.isArray(stored.buckets[b])) throw new Error('Invalid escrow journal bucket');
            for (const w of stored.buckets[b]) if (validCheckpointWire(w, room) && await verifyWire(w)) c.buckets[bucket(w)].push(w);
          }
          if (stored.droppedWires) {
            for (const [b, n] of Object.entries(stored.droppedWires)) {
              if (!(b in c.buckets) || !Number.isSafeInteger(n) || n < 0) throw new Error('Invalid journal diagnostics');
            }
            c.droppedWires = stored.droppedWires;
          }
          boundWires(c);
        }
        e.checkpoint = await mergeCheckpoints(c, e.checkpoint);
        e.keys = new Set(logOrder(e.checkpoint).map(canonical));
        const checkpoint = e.checkpoint;
        // State remains in memory on failed writes, and the next snapshot retries it.
        e.dirty = true;
        await this.storage.set(journalKey(room), new TextEncoder().encode(JSON.stringify(checkpoint)));
        e.dirty = false;
        result = JSON.parse(JSON.stringify(checkpoint)) as RoomCheckpoint;
      });
      // Bound clean cached rooms; pending/failed evidence is retained until persisted.
      for (const [key, old] of this.entries) {
        if (this.entries.size <= 8) break;
        if (old !== e && !old.dirty && !old.busy && !old.pending.size && !old.timer) this.entries.delete(key);
      }
    });
    e.queue = task.catch(() => {});
    try { await task; } finally { e.busy!--; }
    return result;
  }
}
export const evidenceJournal = new EvidenceJournal();
