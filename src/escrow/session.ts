import { getNode, subscribeEvent, isRawEvent, decodeRawPayload, replayRoomWire, EVENT_PEER_CONNECTED, DELIVERY_RELIABLE } from '../lib/mistClient';
import { appendWireLog, loadWireLog } from '../lib/chatStore';
import { ensureDidIdentity } from '../crypto/didIdentity';
import { signWireFields, verifyWire } from '../lib/wireSign';
import { newId } from '../lib/util';
import { createMistEscrowTransport } from './mistTransport';
import { RoomEscrowController } from './controller';
import type { EscrowView } from './controller';
import { parseConfig, newerConfig, loadConfig, persistConfig, parseHint, validCustomRoom } from './config';
import type { EscrowConfig, EscrowMode } from './config';
import { evidenceJournal } from './journal';

/** One deduplicated registry entry; uses the ordinary replay receivers for active and background rooms. */
export class RoomEscrowSession {
  readonly controller: RoomEscrowController;
  config: EscrowConfig | null = null;
  private closed = false;
  private started = false;
  private queue = Promise.resolve();
  persistenceError: unknown = null;
  private persistenceRetry?: ReturnType<typeof setTimeout>;
  private off: () => void;
  readonly ready: Promise<void>;
  private changed: (view: EscrowView, config: EscrowConfig | null) => void;
  readonly roomId: string;
  constructor(roomId: string, changed: (view: EscrowView, config: EscrowConfig | null) => void, hint: string | null = null) {
    this.roomId = roomId; this.changed = changed;
    const controller = this.controller = new RoomEscrowController({ roomId, wires: () => loadWireLog(roomId),
      evidence: () => evidenceJournal.snapshot(roomId, loadWireLog(roomId)),
      receive: w => replayRoomWire(roomId, w), changed: v => changed(v, this.config) }, createMistEscrowTransport());
    this.off = subscribeEvent((event, from, payload, room) => {
      if (room !== roomId || this.closed) return;
      if (event === EVENT_PEER_CONNECTED) { void this.send(from).catch(() => {}); return; }
      if (!isRawEvent(event)) return;
      const wire = decodeRawPayload(payload);
      if ((wire as { type?: string } | null)?.type === 'tc-chat:escrow-config') return this.adopt(wire);
    });
    this.ready = (async () => {
      const stored = await loadConfig(roomId); if (stored) await this.adopt(stored);
      // Live signed settings remain authoritative even if journal I/O fails.
      for (const wire of loadWireLog(roomId)) if (wire.type === 'tc-chat:escrow-config') await this.adopt(wire);
      try {
        const journal = await evidenceJournal.snapshot(roomId, loadWireLog(roomId));
        for (const wire of journal.buckets.misc) if (wire.type === 'tc-chat:escrow-config') await this.adopt(wire);
      } catch (error) {
        // Discovery can proceed; checkpoint snapshots retry OPFS and expose failure without overwriting it.
        console.warn('tc-chat: escrow startup evidence unavailable', error);
      }
      if (this.closed) return;
      let bootstrap = parseHint(hint, roomId);
      try {
        bootstrap ??= parseHint(localStorage.getItem('tc-chat:escrow-hint:v1:' + roomId), roomId);
        if (hint && parseHint(hint, roomId)) localStorage.setItem('tc-chat:escrow-hint:v1:' + roomId, hint);
      } catch { /* optional hint */ }
      this.started = true;
      await controller.configure(this.config ?? bootstrap ?? { mode: 'auto', mistlRoom: '' });
      await this.send();
    })();
    void this.ready.catch(error => console.warn('tc-chat: escrow session startup failed', error));
  }
  private async send(to: string | null = null) {
    const node = await getNode();
    if (!this.closed && this.config) node.sendMessage(to, this.config, DELIVERY_RELIABLE, this.roomId);
  }
  adopt(value: unknown): Promise<void> {
    const next = this.queue.then(async () => {
      const v = parseConfig(value, this.roomId);
      if (!v || !await verifyWire(v) || this.closed) return;
      appendWireLog(this.roomId, v);
      if (this.config && !newerConfig(v, this.config)) {
        if (this.persistenceError) this.saveConfig();
        return;
      }
      const old = this.config; this.config = v; this.changed(this.controller.view, v);
      if (this.started && (!old || v.mode !== old.mode || v.mistlRoom !== old.mistlRoom)) await this.controller.configure(v);
      this.saveConfig();
    });
    this.queue = next.catch(() => {});
    return next;
  }
  private saveConfig(): void {
    if (this.closed || !this.config) return;
    clearTimeout(this.persistenceRetry); this.persistenceRetry = undefined;
    try { persistConfig(this.config); this.persistenceError = null; }
    catch (error) {
      this.persistenceError = error;
      console.warn('tc-chat: escrow setting persistence failed; retrying', error);
      this.persistenceRetry = setTimeout(() => {
        this.persistenceRetry = undefined;
        this.queue = this.queue.then(() => this.saveConfig());
      }, 1000);
    }
  }
  async configure(mode: EscrowMode, room = '') {
    await this.ready; await this.queue;
    if (this.closed || !this.started || mode === 'custom' && !validCustomRoom(room, this.roomId)) throw new Error('Invalid escrow setting');
    if ((this.config?.rev ?? 0) >= Number.MAX_SAFE_INTEGER - 1) throw new Error('Escrow configuration revision exhausted');
    const identity = await ensureDidIdentity();
    const fields = { type: 'tc-chat:escrow-config' as const, v: 1 as const, id: newId(), roomId: this.roomId,
      fromId: identity.did, timestamp: Date.now(), rev: (this.config?.rev ?? 0) + 1, mode, mistlRoom: mode === 'custom' ? room : '' };
    await this.adopt({ ...fields, signature: await signWireFields(fields) }); await this.send();
  }
  markDirty() { this.controller.markDirty(); }
  flush() { return this.controller.flush(); }
  retryNow() { return this.controller.retryNow(); }
  async dispose() { this.closed = true; clearTimeout(this.persistenceRetry); this.off(); await this.controller.dispose(); }
}
