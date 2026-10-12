import { eligibleRoom } from './config';
export const MAX_ROOM_CONTROLLERS = 8;
export interface EscrowSession {
  markDirty(): void; flush(): Promise<void>; dispose(): Promise<void>;
}
/** SPEC2 W3: pin the active room and rotate accepted DMs by accepted wire activity. */
export class RoomEscrowRegistry<T extends EscrowSession> {
  readonly sessions = new Map<string, T>();
  private allowed = new Set<string>();
  private active: string | null = null;
  private queue = Promise.resolve();
  private closed = false;
  private create: (room: string) => T;
  private selected: (session: T | null) => void;
  private limit: number;
  constructor(create: (room: string) => T, selected: (session: T | null) => void = () => {}, limit = MAX_ROOM_CONTROLLERS) {
    this.create = create; this.selected = selected; this.limit = limit;
  }
  private enqueue(task: () => Promise<void>) {
    const next = this.queue.then(task);
    this.queue = next.catch(error => console.warn('tc-chat: escrow registry failed', error));
    return next;
  }
  setRooms(active: string | null, accepted: string[]): Promise<void> {
    const previousActive = this.active;
    this.active = eligibleRoom(active) ? active : null;
    this.allowed = new Set([...accepted, ...(this.active ? [this.active] : [])].filter(eligibleRoom));
    return this.enqueue(async () => {
      if (this.closed) return;
      if (previousActive && previousActive !== this.active) await this.sessions.get(previousActive)?.flush();
      for (const [room, session] of this.sessions) if (!this.allowed.has(room)) {
        this.sessions.delete(room); await session.dispose();
      }
      if (this.active) await this.ensure(this.active);
      for (const room of this.allowed) {
        if (this.sessions.size >= this.limit) break;
        if (!this.sessions.has(room)) await this.ensure(room);
      }
      this.selected(this.active ? this.sessions.get(this.active) ?? null : null);
    });
  }
  touch(room: string): Promise<void> {
    if (!this.allowed.has(room) || this.closed) return Promise.resolve();
    return this.enqueue(async () => {
      if (!this.allowed.has(room) || this.closed) return;
      const session = await this.ensure(room); session?.markDirty();
    });
  }
  private async ensure(room: string): Promise<T | null> {
    let session = this.sessions.get(room);
    if (session) { this.sessions.delete(room); this.sessions.set(room, session); return session; }
    if (this.sessions.size >= this.limit) {
      const victim = [...this.sessions.keys()].find(id => id !== this.active);
      if (!victim) return null;
      const old = this.sessions.get(victim)!; this.sessions.delete(victim);
      // Await best-effort flush and release before replacing, including controllers still disposing.
      await old.dispose();
    }
    if (this.closed || !this.allowed.has(room)) return null;
    session = this.create(room); this.sessions.set(room, session);
    return session;
  }
  async flush() { await this.queue; await Promise.all([...this.sessions.values()].map(s => s.flush())); }
  async dispose() {
    this.closed = true; await this.queue;
    await Promise.all([...this.sessions.values()].map(s => s.dispose())); this.sessions.clear();
  }
}
