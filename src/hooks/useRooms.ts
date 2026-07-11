import { useState } from "preact/hooks";
import { addRoom, loadRooms, removeRoom, type RoomMeta } from "../lib/chatStore";
import { GLOBAL_ROOM_ID } from "../lib/util";
import { getLocale, translate } from "../lib/i18n";

function withGlobal(rooms: RoomMeta[]): RoomMeta[] {
  if (rooms.some((r) => r.id === GLOBAL_ROOM_ID)) return rooms;
  // Localized at load; the built-in global room isn't persisted with a name.
  const name = translate(getLocale(), "common.globalRoom");
  return [{ id: GLOBAL_ROOM_ID, name, joinedAt: 0 }, ...rooms];
}

export function useRooms() {
  const [rooms, setRooms] = useState<RoomMeta[]>(() => withGlobal(loadRooms()));

  function joinRoom(id: string, name: string) {
    setRooms(withGlobal(addRoom(id, name)));
  }

  function leaveRoom(id: string) {
    if (id === GLOBAL_ROOM_ID) return;
    setRooms(withGlobal(removeRoom(id)));
  }

  return { rooms, joinRoom, leaveRoom };
}
