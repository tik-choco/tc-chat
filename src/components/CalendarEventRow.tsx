import { useState } from "preact/hooks";
import { MapPin } from "lucide-preact";
import type { PostNode } from "../lib/chatStore";
import { identityFor, type ProfileDirectory } from "../lib/profileDirectory";
import { useT } from "../lib/i18n";
import { formatEventTime } from "../lib/agenda";
import { Avatar } from "./Avatar";
import { CalendarEventComposer, type EventFormValues } from "./CalendarEventComposer";
import { ConfirmDialog } from "./ConfirmDialog";

/** One flat calendar event row — no threading/reactions, unlike board posts. */
export function CalendarEventRow(props: {
  event: PostNode;
  localId: string | null;
  directory: ProfileDirectory;
  onEdit: (id: string, input: EventFormValues) => void;
  onDelete: (id: string) => void;
}) {
  const t = useT();
  const { event, localId, directory, onEdit, onDelete } = props;
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const isOwn = localId !== null && event.fromId === localId;
  const { name, avatarCid } = identityFor(directory, event.fromId, event.fromName);

  if (editing) {
    return (
      <CalendarEventComposer
        mode="edit"
        initial={{
          title: event.title ?? "",
          text: event.text,
          startsAt: event.startsAt ?? Date.now(),
          endsAt: event.endsAt,
          location: event.location,
        }}
        onSubmit={(input) => {
          onEdit(event.id, input);
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <article class="event-row">
      <Avatar id={event.fromId} name={name} avatarCid={avatarCid} size={30} />
      <div class="event-row-body">
        <header class="event-row-head">
          <span class="event-row-time">{formatEventTime(event.startsAt ?? event.timestamp)}</span>
          {event.endsAt !== undefined && (
            <span class="event-row-time">– {formatEventTime(event.endsAt)}</span>
          )}
          <h3 class="event-row-title">{event.title}</h3>
        </header>
        {event.location && (
          <p class="event-row-location">
            <MapPin size={13} /> {event.location}
          </p>
        )}
        {event.text && <p class="event-row-text">{event.text}</p>}
        <p class="event-row-author">{name}</p>

        {(isOwn || confirmingDelete) && (
          <div class="event-row-actions">
            {isOwn && (
              <button type="button" class="board-node-action" onClick={() => setEditing(true)}>
                ✏️ {t("common.edit")}
              </button>
            )}
            {isOwn && (
              <button
                type="button"
                class="board-node-action board-node-action--danger"
                title={t("board.deleteHint")}
                onClick={(e) => {
                  if (e.shiftKey) onDelete(event.id);
                  else setConfirmingDelete(true);
                }}
              >
                🗑 {t("common.delete")}
              </button>
            )}
          </div>
        )}

        {confirmingDelete && (
          <ConfirmDialog
            title={t("calendar.deleteEventTitle")}
            message={t("calendar.deleteEventMessage")}
            confirmLabel={t("common.deleteConfirm")}
            onConfirm={() => {
              onDelete(event.id);
              setConfirmingDelete(false);
            }}
            onCancel={() => setConfirmingDelete(false)}
          />
        )}
      </div>
    </article>
  );
}
