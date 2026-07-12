// Joins/leaves the given room on the shared mistlib node and composes the
// presence + message hooks that depend on being in that room.
import { useEffect, useState } from "preact/hooks";
import { getNode } from "../lib/mistClient";
import { usePresence } from "./usePresence";
import { usePostStream } from "./usePostStream";
import { useTyping } from "./useTyping";
import { GLOBAL_ROOM_ID } from "../lib/util";
import type { TcStorageFileEntry } from "../interop/tcStorageFiles";

export type RoomStatus = "idle" | "joining" | "joined" | "error";

export function useChatRoom(roomId: string | null, localName: string) {
  const [status, setStatus] = useState<RoomStatus>("idle");

  useEffect(() => {
    if (!roomId) {
      setStatus("idle");
      return;
    }
    let cancelled = false;
    setStatus("joining");
    (async () => {
      try {
        const node = await getNode();
        if (cancelled) return;
        // roomId is the human-facing/display + local-storage id, and it's also
        // the raw P2P swarm topic on the wire — no derived/obscured channel id,
        // so any peer (and the external `mistl` relay used for the VRChat
        // bridge) that types the same room ID lands in the same swarm.
        // Presence/posts/voice/screen all ride inside this joined swarm — this
        // is the only place the topic is set.
        //
        // joinRoomAsync resolves only once mistlib has actually built the room's
        // swarm session (plain joinRoom is fire-and-forget), so once we flip to
        // "joined" here, room-scoped sends are safe. This is what closes the
        // "Room not joined" race that used to hit presence/post sends fired in
        // the gap before the session existed. Rejects if the build fails.
        await node.joinRoomAsync(roomId);
        if (cancelled) return;
        setStatus("joined");
      } catch (err) {
        console.error("failed to join room", err);
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  const peers = usePresence(status === "joined" ? roomId : null, localName);
  // Chat is the "chat" surface of the shared post engine (see usePostStream);
  // it's a flat stream, so every message is a top-level post (parentId null).
  const { nodes, createPost, createMedia, createStoredFile, toggleReaction, editPost, deletePost } =
    usePostStream(status === "joined" ? roomId : null, "chat", localName);
  // No typing indicator in the global room — it's a wide-open public space
  // where "who's typing" among an unbounded crowd isn't useful signal.
  const { typingNames, notifyTyping } = useTyping(
    status === "joined" && roomId !== GLOBAL_ROOM_ID ? roomId : null,
    localName,
  );

  const sendText = (text: string) => createPost({ parentId: null, kind: "text", text });
  const sendFile = (file: File) => createMedia(file);
  // Fire-and-forget from MessageInput; a stored file whose tc-storage envelope
  // no local key opens rejects (see createStoredFile) — log instead of leaving
  // an unhandled rejection.
  const sendStoredFile = (entry: TcStorageFileEntry) =>
    createStoredFile(entry).catch((err) => console.error("failed to attach stored file", err));
  const editMessage = (id: string, text: string) => editPost(id, { text });
  const deleteMessage = (id: string) => deletePost(id);

  return {
    status,
    peers,
    messages: nodes,
    sendText,
    sendFile,
    sendStoredFile,
    toggleReaction,
    editMessage,
    deleteMessage,
    typingNames,
    notifyTyping,
  };
}
