// The room calendar is the "calendar" surface of the shared post engine (see
// usePostStream) — a flat stream of "event" posts, exactly like chat is the
// "chat" surface. Called the same way the board's stream is in app.tsx
// (gated on useChatRoom's `status === "joined"`), since only useChatRoom
// actually joins the room; this hook must never try to join it itself.
import { usePostStream, type CreatePostInput } from "./usePostStream";

export interface CreateEventInput {
  title: string;
  text?: string;
  startsAt: number;
  endsAt?: number;
  location?: string;
}

export interface EditEventInput {
  title?: string;
  text?: string;
  startsAt?: number;
  endsAt?: number;
  location?: string;
}

export function useCalendarEvents(roomId: string | null, localName: string) {
  const { nodes, createPost, editPost, deletePost } = usePostStream(roomId, "calendar", localName);

  function createEvent(input: CreateEventInput) {
    const post: CreatePostInput = { parentId: null, kind: "event", ...input };
    createPost(post);
  }

  function editEvent(id: string, input: EditEventInput) {
    editPost(id, input);
  }

  return { events: nodes, createEvent, editEvent, deleteEvent: deletePost };
}
