import { useEffect, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import type { NodeTree } from "../lib/boardTree";
import type { CreatePostInput } from "../hooks/usePostStream";
import { useT } from "../lib/i18n";
import { formatTime, shortDid } from "../lib/util";
import { identityFor, type ProfileDirectory } from "../lib/profileDirectory";
import { resolveStorageUrl } from "../lib/mediaUrl";
import { makeThumbnail, type ThumbResult } from "../lib/imageThumb";
import { Avatar } from "./Avatar";
import { ReactionBar } from "./ReactionBar";
import { NodeComposer } from "./NodeComposer";
import { ConfirmDialog } from "./ConfirmDialog";
import { MarkdownView } from "./MarkdownView";
import { Lightbox, type LightboxItem } from "./Lightbox";

function Chips(props: { items?: string[]; variant: string }) {
  if (!props.items || props.items.length === 0) return null;
  return (
    <ul class={`node-chips node-chips--${props.variant}`}>
      {props.items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

/** Resolves a thumbCid to a blob URL and renders it, mirroring MessageBubble's
 * MediaContent — a failed/slow resolve just renders nothing (no placeholder),
 * since a thumbnail is decoration, not the post's content. */
function NodeThumbImage(props: { cid: string; mimeType?: string; alt: string; class: string }) {
  const { cid, mimeType, alt, class: className } = props;
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    resolveStorageUrl(cid, mimeType)
      .then((u) => {
        if (!cancelled) setUrl(u);
      })
      .catch(() => {
        /* leave unresolved — the thumbnail silently disappears */
      });
    return () => {
      cancelled = true;
    };
  }, [cid, mimeType]);

  if (!url) return null;
  return <img class={className} src={url} alt={alt} />;
}

/**
 * Renders one BoardNode and, recursively, its whole subtree. The same
 * component is a recruitment card, a thread's opening post, and a deeply
 * nested comment — the only differences are `depth` (indentation + density)
 * and `kind` (project nodes surface a title + role/tag chips). Because the
 * data is uniform and self-similar, the recursion is the entire layout.
 */
export function BoardNodeView(props: {
  entry: NodeTree;
  depth: number;
  localId: string | null;
  directory: ProfileDirectory;
  onCreate: (input: CreatePostInput) => void;
  onToggleReaction: (targetId: string, emoji: string) => void;
  onEdit: (
    targetId: string,
    input: {
      text?: string;
      title?: string;
      thumb?: { bytes: Uint8Array; mimeType: string } | null;
      capacity?: number | null;
    },
  ) => void;
  onDelete: (targetId: string) => void;
}) {
  const t = useT();
  const { entry, depth, localId, directory, onCreate, onToggleReaction, onEdit, onDelete } = props;
  const { node, children, replyCount } = entry;
  const [replying, setReplying] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftText, setDraftText] = useState("");
  // Capacity edit tri-state, mirroring editThumb: undefined = keep the
  // existing capacity as-is, otherwise the raw input string (validated and
  // converted to number|null on save).
  const [draftCapacity, setDraftCapacity] = useState<string | undefined>(undefined);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [thumbOpen, setThumbOpen] = useState(false);
  // Thumbnail edit tri-state: undefined = keep the existing thumbCid as-is,
  // null = remove it, a ThumbResult = replace it with a freshly picked image.
  const [editThumb, setEditThumb] = useState<ThumbResult | null | undefined>(undefined);
  const [editThumbPreviewUrl, setEditThumbPreviewUrl] = useState<string | null>(null);
  const [thumbError, setThumbError] = useState("");
  const editThumbInputRef = useRef<HTMLInputElement>(null);

  const isProject = node.kind === "project";
  // Only the author may edit/delete — enforced cryptographically on receive
  // (see applyPostEdit/applyPostDelete); this just gates the UI.
  const isOwn = localId !== null && node.fromId === localId;
  const editable = node.kind === "text" || node.kind === "project";
  const { name, avatarCid } = identityFor(directory, node.fromId, node.fromName);
  // Thumbnails only ever live on root posts (NodeComposer only offers the
  // picker in "root" mode), so the edit UI offers add/change/remove there —
  // including adding one to a post that never had a thumbnail.
  const canEditThumb = depth === 0;
  // What the edit preview currently shows: a freshly picked replacement, or
  // (while untouched) the post's existing thumbnail.
  const editThumbVisible = editThumb ? true : editThumb === undefined && Boolean(node.thumbCid);
  // Join-wish reactions (🙋) drive the recruitment card's participation
  // count/button — a plain reaction under the hood, same as ReactionBar uses.
  const joinReactions = node.reactions.filter((r) => r.emoji === "🙋");
  const joinCount = joinReactions.length;
  const joinMine = localId !== null && joinReactions.some((r) => r.fromId === localId);

  // Mirrors NodeComposer's revoke-on-change-or-unmount effect for the
  // freshly-picked replacement thumbnail's local preview URL.
  useEffect(() => {
    return () => {
      if (editThumbPreviewUrl) URL.revokeObjectURL(editThumbPreviewUrl);
    };
  }, [editThumbPreviewUrl]);

  function startEdit() {
    setDraftTitle(node.title ?? "");
    setDraftText(node.text ?? "");
    setDraftCapacity(undefined);
    setEditThumb(undefined);
    setEditThumbPreviewUrl(null);
    setThumbError("");
    setEditing(true);
  }

  async function handleEditThumbPick(e: JSX.TargetedEvent<HTMLInputElement>) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (editThumbInputRef.current) editThumbInputRef.current.value = "";
    if (!file) return;
    try {
      const result = await makeThumbnail(file);
      setEditThumb(result);
      setEditThumbPreviewUrl(
        URL.createObjectURL(new Blob([result.bytes.slice().buffer], { type: result.mimeType })),
      );
      setThumbError("");
    } catch {
      setThumbError(t("board.thumbError"));
    }
  }

  function removeEditThumb() {
    // A post that never had a thumbnail has nothing to remove on the wire —
    // dropping a just-picked image simply returns to "keep" (= nothing).
    setEditThumb(node.thumbCid ? null : undefined);
    setEditThumbPreviewUrl(null);
  }

  function saveEdit() {
    const text = draftText.trim();
    if (!text) return;
    // Same tri-state contract as thumb: undefined (untouched) omits the
    // field entirely, an empty string clears capacity to null, otherwise a
    // parsed positive integer is sent (anything unparsable also clears it).
    let capacityValue: number | null | undefined;
    if (draftCapacity !== undefined) {
      const trimmed = draftCapacity.trim();
      if (!trimmed) {
        capacityValue = null;
      } else {
        const parsed = Number.parseInt(trimmed, 10);
        capacityValue = Number.isInteger(parsed) && parsed > 0 ? parsed : null;
      }
    }
    onEdit(node.id, {
      text,
      title: draftTitle,
      // Only mention `thumb` at all when the user actually changed it —
      // omitting it tells editPost to leave the existing thumbCid alone.
      ...(editThumb !== undefined ? { thumb: editThumb } : {}),
      ...(capacityValue !== undefined ? { capacity: capacityValue } : {}),
    });
    setEditing(false);
  }

  return (
    <article
      class={`board-node board-node--depth${Math.min(depth, 4)} ${
        isProject ? "board-node--project" : "board-node--text"
      } ${depth === 0 ? "board-node--root" : "board-node--reply"}`}
    >
      <div class="board-node-main">
        <Avatar
          id={node.fromId}
          name={name}
          avatarCid={avatarCid}
          size={depth === 0 ? 34 : 26}
        />

        <div class="board-node-body">
          <header class="board-node-head">
            <span class="board-node-name">{name}</span>
            {isProject && depth === 0 && <span class="board-node-badge">{t("board.recruit")}</span>}
            <span class="board-node-time">{formatTime(node.timestamp)}</span>
            <span
              class="bubble-verified"
              title={t("board.verifiedTooltip", { did: shortDid(node.fromId) })}
            >
              ✓
            </span>
          </header>

          {node.deleted ? (
            <p class="board-node-deleted">{t("board.postDeleted")}</p>
          ) : editing ? (
            <div class="board-node-edit">
              {canEditThumb && (
                <div class="board-node-edit-thumb">
                  <input
                    ref={editThumbInputRef}
                    type="file"
                    accept="image/*"
                    class="file-input"
                    onChange={handleEditThumbPick}
                  />
                  {editThumb ? (
                    editThumbPreviewUrl && (
                      <img class="board-node-edit-thumb-preview" src={editThumbPreviewUrl} alt={t("board.thumbAlt")} />
                    )
                  ) : editThumb === undefined && node.thumbCid ? (
                    <NodeThumbImage
                      cid={node.thumbCid}
                      mimeType={node.thumbMimeType}
                      alt={t("board.thumbAlt")}
                      class="board-node-edit-thumb-preview"
                    />
                  ) : null}
                  <div class="board-node-edit-thumb-actions">
                    <button
                      type="button"
                      class="composer-cancel"
                      onClick={() => editThumbInputRef.current?.click()}
                    >
                      {editThumbVisible ? t("board.thumbChange") : t("board.thumbAdd")}
                    </button>
                    {editThumbVisible && (
                      <button type="button" class="composer-cancel" onClick={removeEditThumb}>
                        {t("board.thumbRemove")}
                      </button>
                    )}
                  </div>
                  {thumbError && <p class="form-error">{thumbError}</p>}
                </div>
              )}
              {(node.title !== undefined || isProject) && (
                <input
                  class="board-node-edit-title"
                  placeholder={t("board.titlePlaceholder")}
                  value={draftTitle}
                  onInput={(e) => setDraftTitle((e.target as HTMLInputElement).value)}
                />
              )}
              {isProject && (
                <input
                  type="number"
                  min="1"
                  class="composer-capacity"
                  placeholder={t("board.capacityPlaceholder")}
                  value={draftCapacity !== undefined ? draftCapacity : (node.capacity ?? "")}
                  onInput={(e) => setDraftCapacity((e.target as HTMLInputElement).value)}
                />
              )}
              <textarea
                class="board-node-edit-text"
                rows={3}
                value={draftText}
                onInput={(e) => setDraftText((e.target as HTMLTextAreaElement).value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setEditing(false);
                }}
              />
              <div class="board-node-edit-actions">
                <button type="button" class="send-btn" onClick={saveEdit}>
                  {t("common.save")}
                </button>
                <button type="button" class="composer-cancel" onClick={() => setEditing(false)}>
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          ) : (
            <>
              {node.thumbCid && (
                <button
                  type="button"
                  class="board-node-thumb-btn"
                  aria-label={t("board.thumbAlt")}
                  onClick={() => setThumbOpen(true)}
                >
                  <NodeThumbImage
                    cid={node.thumbCid}
                    mimeType={node.thumbMimeType}
                    alt={t("board.thumbAlt")}
                    class="board-node-thumb"
                  />
                </button>
              )}
              {node.title && (
                <h3 class={`board-node-title ${depth === 0 ? "" : "board-node-title--sm"}`}>
                  {node.title}
                </h3>
              )}
              {node.text && (
                <div class="board-node-text md-body">
                  <MarkdownView text={node.text} />
                  {node.editedAt !== undefined && <span class="board-node-edited"> {t("common.edited")}</span>}
                </div>
              )}
            </>
          )}

          {!node.deleted && isProject && (
            <>
              <Chips items={node.roles} variant="roles" />
              <Chips items={node.tags} variant="tags" />
            </>
          )}

          {!node.deleted && isProject && depth === 0 && (
            <div class="board-node-join-row">
              <button
                type="button"
                class={`board-join-btn ${joinMine ? "board-join-btn--mine" : ""}`}
                title={t("board.joinWish")}
                aria-pressed={joinMine}
                onClick={() => onToggleReaction(node.id, "🙋")}
              >
                🙋{" "}
                {node.capacity !== undefined
                  ? t("board.joinCountCap", { count: joinCount, capacity: node.capacity })
                  : t("board.joinCount", { count: joinCount })}
              </button>
            </div>
          )}

          {!node.deleted && (
            <ReactionBar
              reactions={node.reactions}
              localId={localId}
              onToggle={(emoji) => onToggleReaction(node.id, emoji)}
            />
          )}

          <div class="board-node-actions">
            {!node.deleted && (
              <button
                type="button"
                class="board-node-action"
                onClick={() => setReplying((v) => !v)}
              >
                💬 {t("board.reply")}
              </button>
            )}
            {isOwn && !node.deleted && editable && (
              <button type="button" class="board-node-action" onClick={startEdit}>
                ✏️ {t("common.edit")}
              </button>
            )}
            {isOwn && !node.deleted && (
              <button
                type="button"
                class="board-node-action board-node-action--danger"
                title={t("board.deleteHint")}
                onClick={(e) => {
                  // Shift-click skips confirmation (power-user shortcut).
                  if (e.shiftKey) onDelete(node.id);
                  else setConfirmingDelete(true);
                }}
              >
                🗑 {t("common.delete")}
              </button>
            )}
            {replyCount > 0 && (
              <button
                type="button"
                class="board-node-action board-node-action--muted"
                onClick={() => setCollapsed((v) => !v)}
              >
                {collapsed
                  ? `▸ ${t("board.showReplies", { count: replyCount })}`
                  : `▾ ${t("board.replies", { count: replyCount })}`}
              </button>
            )}
          </div>

          {replying && (
            <NodeComposer
              mode="reply"
              parentId={node.id}
              autoFocus
              onSubmit={(input) => {
                onCreate(input);
                setReplying(false);
              }}
              onCancel={() => setReplying(false)}
            />
          )}

          {confirmingDelete && (
            <ConfirmDialog
              title={t("board.deletePostTitle")}
              message={t("board.deletePostMessage")}
              confirmLabel={t("common.deleteConfirm")}
              onConfirm={() => {
                onDelete(node.id);
                setConfirmingDelete(false);
              }}
              onCancel={() => setConfirmingDelete(false)}
            />
          )}

          {thumbOpen && node.thumbCid && (
            // Reuses the shared gallery Lightbox as a standalone single-item
            // viewer — items/index are normally owned by a parent gallery
            // (ChatWindow), but a one-element array with a no-op index setter
            // is exactly its "nothing to navigate to" case (nav arrows hide
            // themselves whenever items.length <= 1).
            <Lightbox
              items={[
                {
                  key: node.id,
                  kind: "image",
                  cid: node.thumbCid,
                  fileName: node.title,
                } satisfies LightboxItem,
              ]}
              index={0}
              onIndexChange={() => {}}
              onClose={() => setThumbOpen(false)}
            />
          )}
        </div>
      </div>

      {!collapsed && children.length > 0 && (
        <div class="board-node-children">
          {children.map((child) => (
            <BoardNodeView
              key={child.node.id}
              entry={child}
              depth={depth + 1}
              localId={localId}
              directory={directory}
              onCreate={onCreate}
              onToggleReaction={onToggleReaction}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </article>
  );
}
