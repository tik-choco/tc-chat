import "../styles/escrow.css";
import { useEffect, useState } from 'preact/hooks';
import { X } from 'lucide-preact';
import { useT } from '../lib/i18n';
import { validCustomRoom } from '../escrow/config';
import type { EscrowMode } from '../escrow/config';
import type { useRoomEscrow } from '../hooks/useRoomEscrow';
export function RoomEscrowPanel({ roomId, escrow, onClose }: { roomId: string; escrow: ReturnType<typeof useRoomEscrow>; onClose(): void }) {
  const t = useT(); const { view, config } = escrow;
  const [mode, setMode] = useState<EscrowMode>(view.mode);
  const [custom, setCustom] = useState(view.mistlRoom);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  useEffect(() => { setMode(view.mode); setCustom(view.mistlRoom); }, [view.mode, view.mistlRoom]);
  async function apply() {
    if (mode === 'custom' && !validCustomRoom(custom, roomId)) { setError(t('escrow.invalid')); return; }
    setPending(true); setError('');
    try { await escrow.configure(mode, custom); } catch (e) { setError(String(e)); } finally { setPending(false); }
  }
  const droppedWires = Object.values(view.droppedWires).reduce((n, count) => n + count, 0);
  const counts = new Map<string, number>();
  for (const o of view.omitted) counts.set(o.reason, (counts.get(o.reason) ?? 0) + 1);
  return <div class="modal-overlay" onClick={onClose}>
    <div class="modal profile-panel escrow-panel" role="dialog" aria-modal="true" aria-label={t('escrow.title')} onClick={e => e.stopPropagation()}>
      <header class="modal-header"><h2>{t('escrow.title')}</h2><button type="button" class="modal-close" aria-label={t('common.close')} onClick={onClose}><X size={18}/></button></header>
      <label class="field"><span class="field-label">{t('escrow.shared')}</span><select value={mode} onChange={e => setMode(e.currentTarget.value as EscrowMode)}>
        {(['auto','custom','off'] as const).map(m => <option key={m} value={m}>{t(('escrow.' + m) as 'escrow.auto')}</option>)}
      </select></label>
      {mode === 'custom' && <label class="field"><span class="field-label">{t('escrow.custom')}</span><input value={custom} maxLength={96} onInput={e => setCustom(e.currentTarget.value)}/></label>}
      <button type="button" class="send-btn" disabled={pending} onClick={() => void apply()}>{t('escrow.apply')}</button>
      {config && <p class="profile-hint">{t('escrow.shared')}: {config.fromId.slice(0,24)}… ({config.rev})</p>}
      <label class="field"><span class="field-label">{t('escrow.room')}</span><input readOnly value={view.room}/></label>
      <button type="button" class="pill-btn" disabled={!view.room} onClick={() => { void navigator.clipboard.writeText(view.room).catch(e => setError(String(e))); }}>{t('common.copy')}</button>
      <p role="status">{t(('escrow.' + view.status) as 'escrow.ready')}{view.reason && ': ' + view.reason}</p>
      <p>{t('escrow.lastSaved')}: {view.savedAt ? new Date(view.savedAt).toLocaleString() : '—'}</p>
      {view.omitted.length > 0 && <p>{t('escrow.omitted')}: {view.omitted.length} ({[...counts].map(([reason, n]) => t(('escrow.' + reason) as 'escrow.budget') + ': ' + n).join(', ')})</p>}
      {droppedWires > 0 && <p>{t('escrow.droppedWires')}: {droppedWires}</p>}
      <p class="profile-hint">{t('escrow.setup')}</p>
      {error && <p class="form-error">{error}</p>}
      <div class="modal-actions"><button type="button" class="pill-btn" disabled={view.mode === 'off' || view.status === 'saving' || view.status === 'restoring'} onClick={() => void escrow.saveNow()}>{t('escrow.saveNow')}</button></div>
    </div>
  </div>;
}
