import { useEffect, useRef, useState } from 'preact/hooks';
import { subscribeEvent, isRawEvent, decodeRawPayload } from '../lib/mistClient';
import { appendWireLog, subscribeWireLog } from '../lib/chatStore';
import { verifyWire } from '../lib/wireSign';
import { locationFromHash } from '../lib/util';
import { RoomEscrowSession } from '../escrow/session';
import { RoomEscrowRegistry } from '../escrow/registry';
import type { EscrowView } from '../escrow/controller';
import { parseConfig, eligibleRoom } from '../escrow/config';
import type { EscrowConfig, EscrowMode } from '../escrow/config';
const initial: EscrowView = { mode: 'auto', mistlRoom: '', room: '', status: 'searching', savedAt: 0, reason: '', omitted: [], droppedWires: {} };
export function useRoomEscrow(roomId: string | null, acceptedDmRooms: string[] = []) {
  const [view, setView] = useState<EscrowView>(initial);
  const [config, setConfig] = useState<EscrowConfig | null>(null);
  const registry = useRef<RoomEscrowRegistry<RoomEscrowSession> | null>(null);
  const active = useRef(roomId); active.current = roomId;
  const accepted = useRef(new Set(acceptedDmRooms)); accepted.current = new Set(acceptedDmRooms);
  const urlHint = useRef(typeof window === 'undefined' ? null : {
    room: locationFromHash(window.location.hash)?.roomId,
    value: new URLSearchParams(window.location.search).get('mistl'),
  });
  useEffect(() => {
    let cancelled = false;
    const r = new RoomEscrowRegistry(room => new RoomEscrowSession(room, (v, c) => {
      if (!cancelled && active.current === room) { setView(v); setConfig(c); }
    }, urlHint.current?.room === room ? urlHint.current.value : null), s => {
      if (!cancelled) { setView(s?.controller.view ?? initial); setConfig(s?.config ?? null); }
    });
    registry.current = r;
    const offLog = subscribeWireLog(room => { void r.touch(room); });
    // Retain accepted DM settings independently of sessions: LRU eviction can race verification.
    // The current session owns application and config persistence.
    let configs = Promise.resolve();
    const off = subscribeEvent((event, _from, payload, room) => {
      if (!isRawEvent(event) || !eligibleRoom(room) || !accepted.current.has(room)) return;
      const wire = parseConfig(decodeRawPayload(payload), room);
      if (!wire) return;
      configs = configs.then(async () => {
        if (!await verifyWire(wire) || cancelled || !accepted.current.has(room)) return;
        // Config storage can fail independently of signed evidence retention.
        appendWireLog(room, wire);
        await r.touch(room);
        if (cancelled || !accepted.current.has(room)) return;
        // Verification/activation can yield to another wire that creates this session.
        await r.sessions.get(room)?.adopt(wire);
      }).catch(error => console.warn('tc-chat: background escrow setting failed', error));
      return configs;
    });
    const hide = () => { void r.flush(); }; window.addEventListener('pagehide', hide);
    return () => { cancelled = true; off(); offLog(); window.removeEventListener('pagehide', hide); void r.dispose(); registry.current = null; };
  }, []);
  const dmKey = JSON.stringify([...new Set(acceptedDmRooms)].sort());
  useEffect(() => {
    setView(initial); setConfig(null);
    void registry.current?.setRooms(roomId, JSON.parse(dmKey) as string[]);
  }, [roomId, dmKey]);
  return { view, config,
    configure: async (mode: EscrowMode, room = '') => {
      const session = roomId ? registry.current?.sessions.get(roomId) : null;
      if (!session) throw new Error('Escrow room unavailable');
      await session.configure(mode, room);
      setConfig(session.config); setView(session.controller.view);
    },
    saveNow: () => roomId ? registry.current?.sessions.get(roomId)?.retryNow() : undefined };
}
