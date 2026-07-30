import { useEffect, useMemo, useState } from "preact/hooks";
import {
  loadRoomAlerts,
  subscribeRoomAlerts,
  roomAlertsFor,
  setRoomAlerts,
  type RoomAlertPrefs,
} from "../lib/roomNotifyStore";

/**
 * Reactive view over roomNotifyStore's per-room alert map, for a settings
 * panel listing every silenced room and its per-room notify/badge toggles.
 * This only gates alerting side effects (desktop notification, unread
 * badge) — see roomNotifyStore.ts for why that's deliberately NOT the same
 * thing as muting a person: a silenced room still receives and stores
 * everything normally.
 */
export function useRoomNotify(): {
  alerts: Record<string, RoomAlertPrefs>;
  silencedRoomIds: string[];
  alertsFor: (roomId: string) => RoomAlertPrefs;
  setAlerts: (roomId: string, prefs: Partial<RoomAlertPrefs>) => void;
} {
  const [alerts, setAlertsState] = useState<Record<string, RoomAlertPrefs>>(() => loadRoomAlerts());

  useEffect(() => {
    // Re-seed on mount: another tab (or another mounted instance of this
    // hook) may have changed the map between the initial render above and
    // this effect running, so don't rely solely on subscribeRoomAlerts' next fire.
    setAlertsState(loadRoomAlerts());
    return subscribeRoomAlerts(setAlertsState);
  }, []);

  // `alerts` only ever holds non-default entries (see roomNotifyStore), so
  // its keys already are the silenced-room list.
  const silencedRoomIds = useMemo(() => Object.keys(alerts), [alerts]);

  return {
    alerts,
    silencedRoomIds,
    alertsFor: roomAlertsFor,
    setAlerts: (roomId: string, prefs: Partial<RoomAlertPrefs>) => {
      setRoomAlerts(roomId, prefs);
    },
  };
}
