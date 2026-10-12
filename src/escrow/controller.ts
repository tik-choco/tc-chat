import { EscrowClient } from './client';
import type { EscrowTransport, CheckpointOptions, PutResult } from './client';
import type { EscrowTransportSource } from './mistTransport';
import type { EscrowHead } from './head';
import { headHash } from './head';
import { deriveAutoRoom } from './crypto';
import { APP, SCHEMA, MAX_PLAIN, emptyCheckpoint, parseCheckpoint, collectCheckpoint, restoreCheckpoint, mergeCheckpoints, fitCheckpoint } from './checkpoint';
import type { RoomCheckpoint } from './checkpoint';
import { eligibleRoom } from './config';
import type { EscrowSetting } from './config';
import type { SignedWire } from '../lib/chatStore';
export type EscrowStatus = 'off' | 'searching' | 'restoring' | 'ready' | 'saving' | 'saved' | 'saved-with-omissions' | 'error';
export interface EscrowView extends EscrowSetting { room: string; status: EscrowStatus; savedAt: number; reason: string; omitted: RoomCheckpoint['omitted']; droppedWires: NonNullable<RoomCheckpoint['droppedWires']> }
export interface RoomEscrowClient {
  readonly providers: ReadonlyMap<string, { maxBlob: number }>;
  join(): Promise<void>; onProvider(cb: () => void): () => void;
  fetchLatest(app: string, room: string): Promise<{ head: EscrowHead; plaintext: Uint8Array } | null>;
  saveCheckpoint(app: string, room: string, bytes: Uint8Array, options: CheckpointOptions): Promise<PutResult>;
  dispose(): void;
}
interface Context { roomId: string; wires(): SignedWire[]; evidence?(): Promise<RoomCheckpoint>; receive(w: SignedWire): Promise<void>; changed(view: EscrowView): void }
interface Watermark { lastSeq: number; lastHash: string | null; providerSeen: boolean; savedAt: number }
export class RoomEscrowController {
  private client: RoomEscrowClient | null = null;
  private off: (() => void) | null = null;
  private generation = 0;
  private dirty = 1;
  private acked = 0;
  private initialized = false;
  private restoring = false;
  private closing = false;
  private closed = false;
  private head: EscrowHead | null = null;
  private hash: string | null = null;
  private remote: RoomCheckpoint;
  private saving: Promise<void> | null = null;
  private disposing: Promise<void> | null = null;
  private trailing?: ReturnType<typeof setTimeout>;
  private maximum?: ReturnType<typeof setTimeout>;
  private retry?: ReturnType<typeof setTimeout>;
  private failures = 0;
  private viewState: EscrowView = { mode: 'auto', mistlRoom: '', room: '', status: 'searching', savedAt: 0, reason: '', omitted: [], droppedWires: {} };
  constructor(privateCtx: Context, transport: EscrowTransportSource, makeClient?: (room: string) => RoomEscrowClient) {
    if (!eligibleRoom(privateCtx.roomId)) throw new Error('Room excluded from escrow');
    this.ctx = privateCtx; this.transport = transport;
    this.makeClient = makeClient ?? (room => new EscrowClient(transport.createClientHandle?.() ?? transport, room, { maxPlaintext: MAX_PLAIN }));
    this.remote = emptyCheckpoint(privateCtx.roomId);
  }
  private ctx: Context;
  private transport: EscrowTransport;
  private makeClient: (room: string) => RoomEscrowClient;
  get view(): EscrowView { return { ...this.viewState, omitted: [...this.viewState.omitted], droppedWires: { ...this.viewState.droppedWires } }; }
  private update(status: EscrowStatus, reason = '') { this.viewState = { ...this.viewState, status, reason }; if (!this.closing && !this.closed) this.ctx.changed(this.view); }
  private persist(ack?: { seq: number; hash: string }) {
    const key = 'tc-chat:escrow:v1:' + this.ctx.roomId;
    const endpoints: Record<string, Watermark> = JSON.parse(localStorage.getItem(key) ?? '{}');
    const old = endpoints[this.view.room];
    endpoints[this.view.room] = { lastSeq: ack?.seq ?? old?.lastSeq ?? 0, lastHash: ack?.hash ?? old?.lastHash ?? null,
      providerSeen: true, savedAt: ack ? this.view.savedAt : old?.savedAt ?? 0 };
    localStorage.setItem(key, JSON.stringify(endpoints));
  }
  async configure(setting: EscrowSetting): Promise<void> {
    if (this.closing || this.closed) return;
    const generation = ++this.generation;
    this.clearTimers(); this.off?.(); this.client?.dispose(); this.client = null;
    this.initialized = false; this.restoring = false; this.head = null; this.hash = null;
    this.remote = emptyCheckpoint(this.ctx.roomId); this.dirty++; this.acked = 0;
    this.viewState = { ...this.viewState, ...setting, room: '', savedAt: 0, omitted: [], droppedWires: {} };
    if (setting.mode === 'off') { this.update('off'); return; }
    this.update('searching');
    try {
      const room = setting.mode === 'auto' ? await deriveAutoRoom(APP, this.ctx.roomId) : setting.mistlRoom;
      if (this.closed || this.closing || generation !== this.generation) return;
      this.viewState.room = room;
      try { const v = JSON.parse(localStorage.getItem('tc-chat:escrow:v1:' + this.ctx.roomId) ?? '{}')[room]; this.viewState.savedAt = typeof v?.savedAt === 'number' ? v.savedAt : 0; } catch { /* optional local display */ }
      this.update('searching');
      const client = this.makeClient(room); this.client = client;
      const provider = () => { if (generation === this.generation && !this.closed && !this.closing && !this.initialized && !this.restoring) void this.restore(client, generation); };
      this.off = client.onProvider(provider);
      await client.join();
      // No provider means no startup gate or artificial restore wait. Keep listening.
      if (client.providers.size) provider();
    } catch (error) { if (generation === this.generation) this.fail(error, generation); }
  }
  markDirty(): void {
    if (this.closed || this.closing) return;
    this.dirty++;
    if (this.trailing) clearTimeout(this.trailing);
    this.trailing = setTimeout(() => { void this.flush(); }, 5000 + Math.random() * 300);
    if (!this.maximum) this.maximum = setTimeout(() => { void this.flush(); }, 30000);
  }
  private async restore(client: RoomEscrowClient, generation: number): Promise<void> {
    this.restoring = true; this.update('restoring');
    const active = () => generation === this.generation && !this.closed && !this.closing;
    try {
      this.persist();
      const latest = await client.fetchLatest(APP, this.ctx.roomId);
      if (!active()) return;
      if (latest) {
        if (latest.head.schema !== SCHEMA) throw new Error('Unsupported checkpoint schema');
        const remote = await parseCheckpoint(latest.plaintext, this.ctx.roomId);
        if (!active()) return;
        const local = this.ctx.evidence ? await this.ctx.evidence() : emptyCheckpoint(this.ctx.roomId);
        for (const w of this.ctx.wires()) {
          const b = w.type !== 'tc-chat:escrow-config' && ['chat','board','calendar','gallery'].includes(w.surface as string) ? w.surface as 'chat' : 'misc'; local.buckets[b].push(w);
        }
        const merged = await mergeCheckpoints(remote, local);
        // Validate local evidence as well before passing it through history handlers.
        await parseCheckpoint(new TextEncoder().encode(JSON.stringify(merged)), this.ctx.roomId);
        if (!active()) return;
        await restoreCheckpoint(merged, this.transport, w => this.ctx.receive(w), active);
        if (!active()) return;
        this.remote = merged; this.head = latest.head; this.hash = await headHash(latest.head);
      }
      this.initialized = true; this.restoring = false; this.failures = 0; this.update('ready'); this.markDirty();
    } catch (error) { if (active()) { this.restoring = false; this.fail(error, generation); } }
  }
  retryNow(): Promise<void> {
    if (this.closed || this.closing || !this.client || this.restoring) return Promise.resolve();
    clearTimeout(this.retry); this.retry = undefined;
    if (!this.initialized && this.client.providers.size) return this.restore(this.client, this.generation);
    this.markDirty(); return this.flush();
  }
  flush(): Promise<void> {
    if (this.saving) return this.saving;
    if (this.closed || !this.client || !this.client.providers.size || !this.initialized || this.restoring || this.dirty === this.acked) return Promise.resolve();
    this.clearWriteTimers();
    const generation = this.generation, client = this.client;
    this.saving = this.save(client, generation).finally(() => {
      this.saving = null;
      if (!this.closing && generation === this.generation && this.dirty !== this.acked && !this.retry) this.markDirty();
    });
    return this.saving;
  }
  private async save(client: RoomEscrowClient, generation: number): Promise<void> {
    const active = () => generation === this.generation && !this.closed;
    const revision = this.dirty;
    this.update('saving');
    try {
      const evidence = this.ctx.evidence ? await this.ctx.evidence() : emptyCheckpoint(this.ctx.roomId);
      let c = await collectCheckpoint(this.ctx.roomId, this.ctx.wires(), this.transport, await mergeCheckpoints(this.remote, evidence));
      for (let attempt = 0; attempt < 3; attempt++) {
        if (!active()) return;
        const maxBlob = Math.max(...[...client.providers.values()].map(p => p.maxBlob));
        if (!Number.isFinite(maxBlob)) throw new Error('Escrow provider disconnected');
        const bytes = await fitCheckpoint(c, maxBlob);
        // Validate the exact fitted payload on every attempt, before replacing the daemon head.
        await parseCheckpoint(bytes, this.ctx.roomId);
        if (!active()) return;
        const result = await client.saveCheckpoint(APP, this.ctx.roomId, bytes, { schema: SCHEMA, parent: this.hash, seq: (this.head?.seq ?? 0) + 1 });
        if (!active()) return;
        if (result.type === 'ack') {
          this.head = result.head; this.hash = result.hash; this.remote = c;
          this.viewState.savedAt = Date.now(); this.viewState.omitted = c.omitted; this.viewState.droppedWires = { ...c.droppedWires };
          // The portable client admits only an ACK matching slot, seq and signed-head hash.
          this.persist({ seq: result.seq, hash: result.hash });
          this.acked = revision; this.failures = 0; this.update(c.omitted.length || Object.values(c.droppedWires ?? {}).some(n => n > 0) ? 'saved-with-omissions' : 'saved');
          if (c.omitted.some(o => o.reason === 'unavailable' || o.reason === 'cid-mismatch')) this.scheduleRetry(generation, 60000);
          return;
        }
        if (result.type === 'error') throw new Error(result.code + ': ' + result.message);
        if (attempt === 2) throw new Error('Escrow conflict retry limit reached');
        await new Promise(resolve => setTimeout(resolve, 150 + Math.random() * 350));
        const latest = await client.fetchLatest(APP, this.ctx.roomId);
        if (!active()) return;
        if (latest) {
          if (latest.head.schema !== SCHEMA) throw new Error('Unsupported checkpoint schema');
          const remote = await parseCheckpoint(latest.plaintext, this.ctx.roomId);
          c = await mergeCheckpoints(c, remote);
          await restoreCheckpoint(c, this.transport, w => this.ctx.receive(w), () => active() && !this.closing);
          this.head = latest.head; this.hash = await headHash(latest.head);
        } else { this.head = null; this.hash = null; }
      }
    } catch (error) { if (active()) this.fail(error, generation); }
  }
  private fail(error: unknown, generation: number) { this.update('error', error instanceof Error ? error.message : String(error)); this.scheduleRetry(generation, Math.min(60000, 1000 * 2 ** this.failures++) + Math.random() * 500); }
  private scheduleRetry(generation: number, ms: number) {
    if (this.closing || this.closed || generation !== this.generation) return;
    if (this.retry) clearTimeout(this.retry);
    this.retry = setTimeout(() => {
      this.retry = undefined;
      if (generation !== this.generation || !this.client) return;
      if (!this.initialized) { if (this.client.providers.size) void this.restore(this.client, generation); else void this.client.join().catch(error => this.fail(error, generation)); }
      else { this.dirty++; void this.flush(); }
    }, ms);
  }
  private clearWriteTimers() { clearTimeout(this.trailing); clearTimeout(this.maximum); this.trailing = undefined; this.maximum = undefined; }
  private clearTimers() { this.clearWriteTimers(); clearTimeout(this.retry); this.retry = undefined; }
  /** Room switch/pagehide flush is best effort; do not start another controller here. */
  dispose(): Promise<void> {
    if (this.closed || this.closing) return this.disposing ?? Promise.resolve();
    this.closing = true; this.clearTimers(); this.off?.();
    this.disposing = this.flush().finally(() => { this.closed = true; this.generation++; this.client?.dispose(); });
    return this.disposing;
  }
}
