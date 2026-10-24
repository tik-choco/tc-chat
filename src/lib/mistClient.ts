// Thin singleton wrapper around @tik-choco/mistlib-web from npm.
// mistlib-wasm only supports one active
// MistNode per page, and its node.onEvent()/onMediaEvent() each accept a
// single handler that replaces any previous one — so this module owns the
// one real MistNode instance and re-broadcasts events to any number of
// listeners registered via subscribeEvent()/subscribeMediaEvent().

import {
  MistNode,
  EVENT_RAW,
  storage_add,
  storage_get,
  storage_kv_set,
  storage_kv_get,
  storage_pin,
  storage_unpin,
  storage_is_pinned,
  storage_add_pinned,
  type MediaEventPayload,
} from "@tik-choco/mistlib-web";
import { captureMistBuildInfo, markMistLoadError } from "./mistBuildInfo";

export {
  EVENT_NEIGHBORS,
  EVENT_PEER_CONNECTED,
  EVENT_PEER_DISCONNECTED,
  MEDIA_EVENT_TRACK_ADDED,
  MEDIA_EVENT_TRACK_REMOVED,
  DELIVERY_RELIABLE,
  DELIVERY_UNRELIABLE,
} from "@tik-choco/mistlib-web";
export {
  EVENT_RAW,
  storage_add,
  storage_get,
  storage_kv_set,
  storage_kv_get,
  storage_pin,
  storage_unpin,
  storage_is_pinned,
  storage_add_pinned,
};
export type { MediaEventPayload };

import type { SharedStorageBackend } from "../crypto/didIdentity";
import { mistSignalingConfig } from "./mistSignaling";

const SHARED_STORAGE_NAME = "tc-shared";

/**
 * Wraps mistlib's storage_add/storage_get as a SharedStorageBackend for
 * ensureSharedDidIdentity(). Must only be used after getNode() has resolved
 * (mistlib's wasm runtime needs to be initialized first).
 */
export function createMistStorageBackend(): SharedStorageBackend {
  return {
    store: (bytes) => storage_add(SHARED_STORAGE_NAME, bytes),
    retrieve: async (cid) => {
      try {
        return await storage_get(cid);
      } catch {
        return undefined;
      }
    },
  };
}

const NODE_ID_KEY = "tc-chat:node-id";

export function localNodeId(): string {
  let id = localStorage.getItem(NODE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(NODE_ID_KEY, id);
  }
  return id;
}

// roomId is the on-the-wire swarm topic — the raw room id, unmodified — the
// event arrived on, or "" for node-wide events. Subscribers use it to ignore
// traffic from rooms other than the one they're bound to — without it, a peer
// that has joined several rooms would mix every room's messages into whichever
// room it is currently viewing (see the per-hook roomId filters).
type EventListener = (eventType: number, fromId: string, payload: unknown, roomId: string, restored?: boolean) => void | Promise<void>;
type MediaListener = (eventType: number, payload: MediaEventPayload) => void;

let node: InstanceType<typeof MistNode> | null = null;
let initPromise: Promise<InstanceType<typeof MistNode>> | null = null;
const eventListeners = new Set<EventListener>();
const mediaListeners = new Set<MediaListener>();

export async function getNode(): Promise<InstanceType<typeof MistNode>> {
  if (node) return node;
  if (!initPromise) {
    initPromise = (async () => {
      // Only peers sharing the same invite salt/code discover each other, so
      // pass the family-wide namespace or this node meets no one.
      const n = new MistNode(localNodeId(), mistSignalingConfig());
      try {
        await n.init();
      } catch (error) {
        markMistLoadError();
        throw error;
      }
      captureMistBuildInfo();
      n.onEvent((eventType, fromId, payload, roomId) => {
        eventListeners.forEach((l) => l(eventType, fromId, payload, roomId ?? ""));
      });
      n.onMediaEvent((eventType, payload) => {
        mediaListeners.forEach((l) => l(eventType, payload));
      });
      node = n;
      return n;
    })();
  }
  return initPromise;
}

/** Returns an unsubscribe function. */
export function subscribeEvent(listener: EventListener): () => void {
  eventListeners.add(listener);
  return () => eventListeners.delete(listener);
}

/** Returns an unsubscribe function. */
export function subscribeMediaEvent(listener: MediaListener): () => void {
  mediaListeners.add(listener);
  return () => mediaListeners.delete(listener);
}

export function decodeRawPayload(payload: unknown): unknown | null {
  try {
    const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload as ArrayBuffer);
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

export function isRawEvent(eventType: number): boolean {
  return eventType === EVENT_RAW;
}

/** Reuses ordinary history receivers, awaiting hydration; alerts skip restored history. */
export async function replayRoomWire(roomId: string, wire: Record<string, unknown>): Promise<void> {
  const bytes = new TextEncoder().encode(JSON.stringify(wire));
  for (const listener of [...eventListeners]) await listener(EVENT_RAW, "", bytes, roomId, true);
}

export function subscribeRoomEvent(roomId: string, listener: EventListener): () => void {
  return subscribeEvent((event, id, payload, room) => {
    if (room === roomId) return listener(event, id, payload, room);
  });
}
export function toEventBytes(payload: unknown): Uint8Array | null {
  if (payload instanceof Uint8Array) return payload;
  if (payload instanceof ArrayBuffer) return new Uint8Array(payload);
  if (Array.isArray(payload) && payload.every(n => Number.isInteger(n) && n >= 0 && n <= 255)) return new Uint8Array(payload);
  return null;
}
interface RoomLease { refs: number; owned: boolean; ready: Promise<void>; node?: Awaited<ReturnType<typeof getNode>> }
const roomLeases = new Map<string, RoomLease>();
export function acquireRoom(roomId: string): { ready: Promise<void>; release(): void } {
  let entry = roomLeases.get(roomId);
  const cleanup = (e: RoomLease) => {
    if (e.refs || roomLeases.get(roomId) !== e) return;
    roomLeases.delete(roomId);
    if (e.owned) e.node?.leaveRoom(roomId);
  };
  if (!entry) {
    entry = { refs: 0, owned: false, ready: Promise.resolve() };
    roomLeases.set(roomId, entry);
    const e = entry;
    e.ready = getNode().then(async n => {
      e.node = n;
      if (!n.isRoomJoined(roomId)) { e.owned = true; await n.joinRoomAsync(roomId); }
    }).finally(() => cleanup(e));
  }
  entry.refs++;
  const e = entry;
  let released = false;
  return { ready: e.ready, release() {
    if (released) return;
    released = true; e.refs--;
    void e.ready.then(() => cleanup(e), () => cleanup(e));
  } };
}

/** Escrow handles use the same ownership count as application joins. */
export const acquireExtraRoom = acquireRoom;

// Ordinary app joins have always lasted until page reload (including background
// DMs and invite sends). Retain one session lease per room to preserve that policy.
const appRooms = new Map<string, ReturnType<typeof acquireRoom>>();
export function joinAppRoom(roomId: string): Promise<void> {
  const existing = appRooms.get(roomId);
  if (existing) return existing.ready;
  const lease = acquireRoom(roomId);
  appRooms.set(roomId, lease);
  const ready = lease.ready.catch(error => {
    if (appRooms.get(roomId) === lease) appRooms.delete(roomId);
    lease.release();
    throw error;
  });
  lease.ready = ready;
  return ready;
}
