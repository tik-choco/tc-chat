import { useEffect, useRef, useState } from 'preact/hooks';
import { getNode, subscribeEvent, isRawEvent, decodeRawPayload, replayRoomWire, EVENT_PEER_CONNECTED, DELIVERY_RELIABLE } from '../lib/mistClient';
import { appendWireLog, loadWireLog, subscribeWireLog } from '../lib/chatStore';
import { ensureDidIdentity } from '../crypto/didIdentity';
import { signWireFields, verifyWire } from '../lib/wireSign';
import { locationFromHash, newId } from '../lib/util';
import { createMistEscrowTransport } from '../escrow/mistTransport';
import { RoomEscrowController } from '../escrow/controller';
import type { EscrowView } from '../escrow/controller';
import { eligibleRoom, parseConfig, newerConfig, loadConfig, persistConfig, parseHint, validCustomRoom } from '../escrow/config';
import type { EscrowConfig, EscrowMode } from '../escrow/config';
const initial: EscrowView = { mode: 'auto', mistlRoom: '', room: '', status: 'searching', savedAt: 0, reason: '', omitted: [], droppedWires: {} };
export function useRoomEscrow(roomId: string | null) {
  const [view, setView] = useState<EscrowView>(initial);
  const [config, setConfig] = useState<EscrowConfig | null>(null);
  const controller = useRef<RoomEscrowController | null>(null);
  const configureRef = useRef<(mode: EscrowMode, room: string) => Promise<void>>(async () => {});
  // Bind the URL hint once to the invited room, so switching rooms never reuses it.
  const urlHint = useRef(typeof window === 'undefined' ? null : {
    room: locationFromHash(window.location.hash)?.roomId,
    value: new URLSearchParams(window.location.search).get('mistl'),
  });
  useEffect(() => {
    setConfig(null); setView(initial);
    if (!eligibleRoom(roomId)) { controller.current = null; configureRef.current = async () => {}; return; }
    let cancelled = false, retained: EscrowConfig | null = null, started = false;
    let cfgQueue = Promise.resolve();
    const c = new RoomEscrowController({ roomId, wires: () => loadWireLog(roomId), receive: w => replayRoomWire(roomId, w), changed: v => { if (!cancelled) setView(v); } }, createMistEscrowTransport());
    controller.current = c;
    const send = async (to: string | null = null) => { const node = await getNode(); if (!cancelled && retained) node.sendMessage(to, retained, DELIVERY_RELIABLE, roomId); };
    const adopt = async (value: unknown) => {
      const v = parseConfig(value, roomId);
      if (!v || !await verifyWire(v) || cancelled) return;
      appendWireLog(roomId, v);
      if (retained && !newerConfig(v, retained)) return;
      const old = retained; retained = v; setConfig(v);
      try { persistConfig(v); } catch (error) { setView(s => ({ ...s, status: 'error', reason: String(error) })); }
      if (started && (!old || v.mode !== old.mode || v.mistlRoom !== old.mistlRoom)) await c.configure(v);
    };
    const enqueue = (value: unknown) => { cfgQueue = cfgQueue.then(() => adopt(value)); return cfgQueue; };
    const off = subscribeEvent((event, from, payload, room) => {
      if (room !== roomId || cancelled) return;
      if (event === EVENT_PEER_CONNECTED) { void send(from).catch(() => {}); return; }
      if (!isRawEvent(event)) return;
      const wire = decodeRawPayload(payload);
      if ((wire as { type?: string } | null)?.type === 'tc-chat:escrow-config') return enqueue(wire);
    });
    const offLog = subscribeWireLog(room => { if (room === roomId) c.markDirty(); });
    configureRef.current = async (mode, room) => {
      if (cancelled || !started || mode === 'custom' && !validCustomRoom(room, roomId)) throw new Error('Invalid escrow setting');
      await cfgQueue;
      if ((retained?.rev ?? 0) >= Number.MAX_SAFE_INTEGER - 1) throw new Error("Escrow configuration revision exhausted");
      const identity = await ensureDidIdentity();
      const unsigned = { type: 'tc-chat:escrow-config' as const, v: 1 as const, id: newId(), roomId, fromId: identity.did,
        timestamp: Date.now(), rev: (retained?.rev ?? 0) + 1, mode, mistlRoom: mode === 'custom' ? room : '' };
      const wire = { ...unsigned, signature: await signWireFields(unsigned) };
      await enqueue(wire); await send();
    };
    void (async () => {
      const stored = await loadConfig(roomId); if (stored) await enqueue(stored);
      for (const wire of loadWireLog(roomId)) if (wire.type === 'tc-chat:escrow-config') await enqueue(wire);
      if (cancelled) return;
      let hint = null;
      try {
        const param = urlHint.current?.room === roomId ? urlHint.current.value : null;
        hint = parseHint(param, roomId) ?? parseHint(localStorage.getItem('tc-chat:escrow-hint:v1:' + roomId), roomId);
        if (param && hint) localStorage.setItem('tc-chat:escrow-hint:v1:' + roomId, param);
      } catch { /* optional bootstrap persistence */ }
      started = true;
      await c.configure(retained ?? hint ?? { mode: 'auto', mistlRoom: '' });
      await send();
    })().catch(error => { if (!cancelled) setView(v => ({ ...v, status: 'error', reason: String(error) })); });
    const hide = () => { void c.flush(); }; window.addEventListener('pagehide', hide);
    return () => { cancelled = true; off(); offLog(); window.removeEventListener('pagehide', hide); c.dispose(); if (controller.current === c) controller.current = null; };
  }, [roomId]);
  return { view, config, configure: (mode: EscrowMode, room = '') => configureRef.current(mode, room), saveNow: () => controller.current?.retryNow() };
}
