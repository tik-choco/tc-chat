// Exposes the local user's per-room display-name override. Holds the whole
// map in state (rather than re-reading localStorage per room) so switching
// rooms resolves synchronously with no effect/async lag — there's no cross-app
// sync need here, unlike the shared profile; this is purely local.
import { useCallback, useState } from "preact/hooks";
import { loadRoomDisplayNames, saveRoomDisplayName, type RoomDisplayNames } from "../lib/roomDisplayNameStore";

export function useRoomDisplayName(roomId: string | null): {
  override: string;
  setOverride: (name: string) => void;
} {
  const [map, setMap] = useState<RoomDisplayNames>(() => loadRoomDisplayNames());

  const setOverride = useCallback(
    (name: string) => {
      if (!roomId) return;
      setMap((m) => saveRoomDisplayName(m, roomId, name));
    },
    [roomId],
  );

  return { override: roomId ? (map[roomId] ?? "") : "", setOverride };
}
