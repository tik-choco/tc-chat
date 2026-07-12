// The room gallery is the "gallery" surface of the shared post engine (see
// usePostStream) — a flat stream of "media"/"file" posts, exactly like chat
// is the "chat" surface. Called the same way the board's and calendar's
// streams are in app.tsx (gated on useChatRoom's `status === "joined"`),
// since only useChatRoom actually joins the room; this hook must never try
// to join it itself.
import { usePostStream } from "./usePostStream";
import type { PostNode } from "../lib/chatStore";
import type { TcStorageFileEntry } from "../interop/tcStorageFiles";

export function useMediaGallery(roomId: string | null, localName: string) {
  const { nodes, createMedia, createStoredFile, toggleReaction, deletePost } = usePostStream(
    roomId,
    "gallery",
    localName,
  );

  /** Uploads each image/video file in turn, skipping anything else silently. */
  async function addFiles(files: File[]) {
    for (const file of files) {
      if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) continue;
      await createMedia(file);
    }
  }

  async function addStoredFile(entry: TcStorageFileEntry) {
    await createStoredFile(entry);
  }

  return {
    items: nodes as PostNode[],
    addFiles,
    addStoredFile,
    toggleReaction,
    deleteItem: deletePost,
  };
}
