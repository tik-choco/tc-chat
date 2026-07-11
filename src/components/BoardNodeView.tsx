import { useState } from "preact/hooks";
import type { NodeTree } from "../lib/boardTree";
import type { CreatePostInput } from "../hooks/usePostStream";
import { useT } from "../lib/i18n";
import { formatTime, shortDid } from "../lib/util";
import { identityFor, type ProfileDirectory } from "../lib/profileDirectory";
import { Avatar } from "./Avatar";
import { ReactionBar } from "./ReactionBar";
import { NodeComposer } from "./NodeComposer";
import { ConfirmDialog } from "./ConfirmDialog";

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
  onEdit: (targetId: string, input: { text?: string; title?: string }) => void;
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
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const isProject = node.kind === "project";
  // Only the author may edit/delete — enforced cryptographically on receive
  // (see applyPostEdit/applyPostDelete); this just gates the UI.
  const isOwn = localId !== null && node.fromId === localId;
  const editable = node.kind === "text" || node.kind === "project";
  const { name, avatarCid } = identityFor(directory, node.fromId, node.fromName);

  function startEdit() {
    setDraftTitle(node.title ?? "");
    setDraftText(node.text ?? "");
    setEditing(true);
  }

  function saveEdit() {
    const text = draftText.trim();
    if (text) onEdit(node.id, { text, title: draftTitle });
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
              {(node.title !== undefined || isProject) && (
                <input
                  class="board-node-edit-title"
                  placeholder={t("board.titlePlaceholder")}
                  value={draftTitle}
                  onInput={(e) => setDraftTitle((e.target as HTMLInputElement).value)}
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
              {node.title && (
                <h3 class={`board-node-title ${depth === 0 ? "" : "board-node-title--sm"}`}>
                  {node.title}
                </h3>
              )}
              {node.text && (
                <p class="board-node-text">
                  {node.text}
                  {node.editedAt !== undefined && <span class="board-node-edited"> {t("common.edited")}</span>}
                </p>
              )}
            </>
          )}

          {!node.deleted && isProject && (
            <>
              <Chips items={node.roles} variant="roles" />
              <Chips items={node.tags} variant="tags" />
            </>
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
