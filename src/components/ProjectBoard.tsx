import { useMemo, useState } from "preact/hooks";
import type { ComponentType } from "preact";
import { Hash, Plus, LayoutGrid, Megaphone, MessageCircle, Inbox, X, type LucideProps } from "lucide-preact";
import type { BoardNode } from "../lib/chatStore";
import type { CreatePostInput } from "../hooks/usePostStream";
import type { ProfileDirectory } from "../lib/profileDirectory";
import { useT } from "../lib/i18n";
import { buildForest } from "../lib/boardTree";
import { useNoteArticleImport } from "../hooks/useNoteArticleImport";
import { BoardNodeView } from "./BoardNodeView";
import { NodeComposer } from "./NodeComposer";

type Filter = "all" | "project" | "text";

const FILTERS: { id: Filter; labelKey: string; icon: ComponentType<LucideProps> }[] = [
  { id: "all", labelKey: "board.filterAll", icon: LayoutGrid },
  { id: "project", labelKey: "board.recruit", icon: Megaphone },
  { id: "text", labelKey: "board.topic", icon: MessageCircle },
];

export function ProjectBoard(props: {
  roomName: string;
  localNodeId: string | null;
  nodes: BoardNode[];
  ready: boolean;
  directory: ProfileDirectory;
  onCreate: (input: CreatePostInput) => void;
  onToggleReaction: (targetId: string, emoji: string) => void;
  onEdit: (targetId: string, input: { text?: string; title?: string }) => void;
  onDelete: (targetId: string) => void;
}) {
  const {
    roomName,
    localNodeId,
    nodes,
    ready,
    directory,
    onCreate,
    onToggleReaction,
    onEdit,
    onDelete,
  } = props;
  const t = useT();
  const [filter, setFilter] = useState<Filter>("all");
  const [composing, setComposing] = useState(false);
  // Seeds the composer's initial title/text once, when an imported article
  // opens it — undefined for a normal "New post" click (empty composer).
  const [composerSeed, setComposerSeed] = useState<{ title: string; text: string } | null>(null);

  const { pending: pendingArticle, markConsumed: markArticleConsumed, resolveBody: resolveArticleBody } =
    useNoteArticleImport();

  const forest = useMemo(() => buildForest(nodes), [nodes]);
  const roots = useMemo(
    () => (filter === "all" ? forest : forest.filter((r) => r.node.kind === filter)),
    [forest, filter],
  );

  function handleCreate(input: CreatePostInput) {
    onCreate(input);
    setComposing(false);
    setComposerSeed(null);
  }

  // Pulls the pending tc-note article's full body (inline text or a mistlib
  // storage_get by CID) into the composer, then marks it consumed so the chip
  // doesn't linger once the user has it in hand.
  async function handleImportArticle() {
    if (!pendingArticle) return;
    const text = await resolveArticleBody();
    setComposerSeed({ title: pendingArticle.title, text });
    setComposing(true);
    markArticleConsumed();
  }

  return (
    <div class="board">
      <header class="board-header">
        <div class="board-header-titles">
          <h2>
            <Hash size={18} class="topbar-hash" /> {roomName}
          </h2>
          <p class="board-subtitle">{t("board.subtitle")}</p>
        </div>
        <button
          type="button"
          class="send-btn"
          disabled={!ready}
          onClick={() => {
            setComposerSeed(null);
            setComposing((v) => !v);
          }}
        >
          <Plus size={16} /> {t("board.newPost")}
        </button>
      </header>

      <div class="board-toolbar">
        <div class="segmented" role="tablist">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              class={`segmented-btn ${filter === f.id ? "segmented-btn--active" : ""}`}
              onClick={() => setFilter(f.id)}
            >
              <f.icon size={15} />
              {t(f.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {pendingArticle && !composing && (
        <div class="board-import-chip">
          <button type="button" class="board-import-chip-main" onClick={handleImportArticle}>
            <Inbox size={15} />
            <span>{t("board.importArticleChip", { title: pendingArticle.title })}</span>
          </button>
          <button
            type="button"
            class="board-import-chip-dismiss"
            onClick={markArticleConsumed}
            aria-label={t("board.importArticleDismiss")}
            title={t("board.importArticleDismiss")}
          >
            <X size={13} />
          </button>
        </div>
      )}

      <div class="board-scroll">
        {composing && (
          <NodeComposer
            mode="root"
            parentId={null}
            autoFocus
            initialTitle={composerSeed?.title}
            initialText={composerSeed?.text}
            onSubmit={handleCreate}
            onCancel={() => {
              setComposing(false);
              setComposerSeed(null);
            }}
          />
        )}

        {roots.length === 0 && (
          <div class="board-empty">
            <p>{filter === "all" ? t("board.emptyAll") : t("board.emptyFiltered")}</p>
            {ready && (
              <button type="button" class="board-empty-cta" onClick={() => setComposing(true)}>
                {t("board.firstPost")}
              </button>
            )}
          </div>
        )}

        {roots.map((entry) => (
          <BoardNodeView
            key={entry.node.id}
            entry={entry}
            depth={0}
            localId={localNodeId}
            directory={directory}
            onCreate={onCreate}
            onToggleReaction={onToggleReaction}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))}
      </div>
    </div>
  );
}
