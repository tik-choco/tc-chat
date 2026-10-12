import type { EscrowTransport } from './client';
import { MAX_MESSAGE_BYTES } from './protocol';
import { acquireExtraRoom, subscribeRoomEvent, toEventBytes, getNode, storage_add, storage_get,
  EVENT_RAW, EVENT_PEER_CONNECTED, EVENT_PEER_DISCONNECTED, DELIVERY_RELIABLE } from '../lib/mistClient';

/** Each client owns a handle; the page's existing broker shares room leases. */
export interface EscrowTransportSource extends EscrowTransport {
  createClientHandle?: () => EscrowTransport;
}
export function createMistEscrowTransport(): EscrowTransport & { createClientHandle(): EscrowTransport } {
  type Room = { active: boolean; ready: boolean; joined: Promise<void>; off: () => void;
    lease: ReturnType<typeof acquireExtraRoom>; queue: { to: string | null; bytes: Uint8Array }[];
    node?: Awaited<ReturnType<typeof getNode>> };
  const rooms = new Map<string, Room>();
  const messages = new Map<string, Set<(id: string, bytes: Uint8Array) => void>>();
  const peers = new Map<string, Set<(id: string, joined: boolean) => void>>();
  function subscribe<T>(map: Map<string, Set<T>>, room: string, cb: T): () => void {
    let set = map.get(room);
    if (!set) { set = new Set(); map.set(room, set); }
    set.add(cb);
    return () => { set.delete(cb); if (!set.size) map.delete(room); };
  }
  function release(id: string, room: Room) {
    room.active = false; room.off(); room.queue.length = 0; room.lease.release();
    if (rooms.get(id) === room) rooms.delete(id);
  }
  return {
    createClientHandle: createMistEscrowTransport,
    join(id) {
      const old = rooms.get(id);
      if (old) return old.joined;
      const off = subscribeRoomEvent(id, (event, from, payload) => {
        if (!rooms.get(id)?.active) return;
        if (event === EVENT_RAW) {
          const bytes = toEventBytes(payload);
          if (bytes && bytes.length <= MAX_MESSAGE_BYTES) for (const cb of messages.get(id) ?? []) cb(from, bytes);
        } else if (event === EVENT_PEER_CONNECTED || event === EVENT_PEER_DISCONNECTED) {
          for (const cb of peers.get(id) ?? []) cb(from, event === EVENT_PEER_CONNECTED);
        }
      });
      const lease = acquireExtraRoom(id);
      const room: Room = { active: true, ready: false, joined: Promise.resolve(), off, lease, queue: [] };
      rooms.set(id, room);
      room.joined = lease.ready.then(async () => {
        const node = await getNode();
        if (!room.active) return;
        room.node = node; room.ready = true;
        for (const m of room.queue.splice(0)) node.sendMessage(m.to, m.bytes, DELIVERY_RELIABLE, id);
      }).catch(error => { release(id, room); throw error; });
      return room.joined;
    },
    leave(id) { const room = rooms.get(id); if (room) release(id, room); },
    send(id, to, bytes) {
      const room = rooms.get(id);
      if (!room?.active) throw new Error('Escrow room not joined');
      if (bytes.length > MAX_MESSAGE_BYTES) throw new Error('Escrow control exceeds 16 KiB');
      if (room.ready) room.node!.sendMessage(to, bytes, DELIVERY_RELIABLE, id);
      else { if (room.queue.length >= 64) throw new Error('Escrow join queue full'); room.queue.push({ to, bytes: new Uint8Array(bytes) }); }
    },
    onMessage: (room, cb) => subscribe(messages, room, cb),
    onPeer: (room, cb) => subscribe(peers, room, cb),
    async storageAdd(name, bytes) { await getNode(); return storage_add(name, bytes); },
    async storageGet(cid) { await getNode(); return storage_get(cid); },
  };
}
