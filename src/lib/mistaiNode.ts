import {
  createRoomConsumers,
  EVENT_RAW as AI_RAW,
  EVENT_PEER_CONNECTED as AI_CONNECTED,
  EVENT_PEER_DISCONNECTED as AI_DISCONNECTED,
  type MistNodeLike,
  type RoomConsumers,
} from "@tik-choco/mistai";
import type { DeliveryMethod } from "@tik-choco/mistlib-web";
import {
  acquireExtraRoom,
  getNode,
  subscribeRoomEvent,
  EVENT_RAW,
  EVENT_PEER_CONNECTED,
  EVENT_PEER_DISCONNECTED,
} from "./mistClient";

type RoomLease = ReturnType<typeof acquireExtraRoom>;
type EventHandler = Parameters<MistNodeLike["onEvent"]>[0];
type PendingSend = {
  toId: string | null | undefined;
  payload: Uint8Array;
  delivery?: number;
};

const MAX_PENDING_SENDS = 32;

// mistClient owns the page's only node and event dispatcher. A handle owns
// only its leases, so disposing one consumer cannot disconnect another.
class MistaiNodeHandle implements MistNodeLike {
  private node: Awaited<ReturnType<typeof getNode>> | null = null;
  private handler: EventHandler | null = null;
  private readonly leases = new Map<string, RoomLease>();
  private readonly unsubscribes = new Map<string, () => void>();
  private readonly readyRooms = new Set<string>();
  private readonly pending = new Map<string, PendingSend[]>();
  private sendRoomId: string | undefined;

  async init(): Promise<void> {
    this.node = await getNode();
  }

  onEvent(handler: EventHandler): void {
    this.handler = handler;
  }

  joinRoom(roomId: string): void {
    if (!this.node) throw new Error("mistaiNode: joinRoom() called before init() resolved");
    if (!this.leases.has(roomId)) {
      const lease = acquireExtraRoom(roomId);
      this.leases.set(roomId, lease);
      this.unsubscribes.set(roomId, subscribeRoomEvent(roomId, (event, fromId, payload) => {
        // The wrapper and mistai can evolve their numeric codes independently.
        const mapped = event === EVENT_RAW ? AI_RAW
          : event === EVENT_PEER_CONNECTED ? AI_CONNECTED
          : event === EVENT_PEER_DISCONNECTED ? AI_DISCONNECTED : null;
        if (mapped !== null) this.handler?.(mapped, fromId, payload, roomId);
      }));
      void lease.ready.then(() => {
        // A leave/rejoin may have replaced the lease while this join waited.
        if (this.leases.get(roomId) !== lease) return;
        this.readyRooms.add(roomId);
        this.flushPending(roomId);
      }).catch((error: unknown) => {
        if (this.leases.get(roomId) !== lease) return;
        this.leaveRoom(roomId);
        console.debug("mistaiNode: room join did not complete", roomId, error);
      });
    }
    this.sendRoomId = roomId;
  }

  leaveRoom(roomId?: string): void {
    for (const room of roomId === undefined ? [...this.leases.keys()] : [roomId]) {
      const lease = this.leases.get(room);
      if (!lease) continue;
      this.leases.delete(room);
      this.unsubscribes.get(room)?.();
      this.unsubscribes.delete(room);
      this.pending.delete(room);
      this.readyRooms.delete(room);
      if (this.sendRoomId === room) this.sendRoomId = [...this.leases.keys()].at(-1);
      lease.release();
    }
  }

  private flushPending(roomId: string): void {
    const queued = this.pending.get(roomId);
    this.pending.delete(roomId);
    if (!this.node || !queued) return;
    for (const message of queued) {
      try {
        this.node.sendMessage(message.toId, message.payload, message.delivery as DeliveryMethod | undefined, roomId);
      } catch (error) {
        console.debug("mistaiNode: queued send failed after join", roomId, error);
      }
    }
  }

  sendMessage(toId: string | null | undefined, payload: Uint8Array, delivery?: number, roomId = this.sendRoomId): void {
    if (!this.node || roomId === undefined || !this.leases.has(roomId)) return;
    if (!this.readyRooms.has(roomId)) {
      const queued = this.pending.get(roomId) ?? [];
      // Announces happen immediately after joinRoom; hold them until the
      // asynchronous lease is usable without growing a stuck join forever.
      if (queued.length >= MAX_PENDING_SENDS) queued.shift();
      queued.push({ toId, payload, delivery });
      this.pending.set(roomId, queued);
      return;
    }
    try {
      this.node.sendMessage(toId, payload, delivery as DeliveryMethod | undefined, roomId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("Room not joined")) throw error;
    }
  }
}

export function createMistaiNode(_nodeId: string): MistNodeLike {
  return new MistaiNodeHandle();
}

// Registers mistai's default consumers for ModelPicker, but starts no node.
export const aiRooms: RoomConsumers = createRoomConsumers(createMistaiNode, {
  nodeIdStorageKey: "tc-chat:mistai-node-id",
});
