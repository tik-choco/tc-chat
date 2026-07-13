import { useEffect, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import type { NodeTree } from "../lib/boardTree";
import { useT } from "../lib/i18n";
import { resolveStorageUrl } from "../lib/mediaUrl";

/** "参加希望" reaction — the same reaction stream as every other emoji
 * (ReactionBar's ❤️ quick-pick included), just surfaced as a first-class
 * join/interest toggle on the card footer. */
const JOIN_EMOJI = "🙋";
const HEART_EMOJI = "❤️";

function Chips(props: { roles?: string[]; tags?: string[] }) {
  const items = [...(props.roles ?? []), ...(props.tags ?? [])];
  if (items.length === 0) return null;
  return (
    <ul class="project-card-chips">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

/**
 * Resolves the post's thumbCid to a blob URL for the card's cover image.
 * Mirrors BoardNodeView's NodeThumbImage, but a missing/unresolved cover
 * falls back to a CSS gradient placeholder (`.project-card-cover--empty`)
 * rather than collapsing to nothing — every card keeps the same silhouette.
 */
function CardCover(props: {
  cid?: string;
  mimeType?: string;
  alt: string;
  /** Overlaid on the cover's top-left corner (the kind badge). */
  children?: ComponentChildren;
}) {
  const { cid, mimeType, alt, children } = props;
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!cid) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    setUrl(null);
    resolveStorageUrl(cid, mimeType)
      .then((u) => {
        if (!cancelled) setUrl(u);
      })
      .catch(() => {
        /* leave unresolved — the gradient placeholder shows instead */
      });
    return () => {
      cancelled = true;
    };
  }, [cid, mimeType]);

  return (
    <div class={`project-card-cover ${url ? "" : "project-card-cover--empty"}`}>
      {url && <img src={url} alt={alt} />}
      {children}
    </div>
  );
}

/**
 * One board root post as a grid card: cover image with a kind badge, title, a
 * plain-text excerpt (Markdown is deliberately not rendered here — MarkdownView
 * is too heavy for a grid of cards), role/tag pills, and a footer with a ❤️
 * toggle and the reply count. Recruitment (project) cards additionally get the
 * 🙋 join-interest toggle. A deleted root with surviving replies renders as a
 * muted tombstone card — the card is the only doorway into its thread, so it
 * must outlive its own body (same spirit as BoardNodeView's tombstone row).
 */
export function ProjectCard(props: {
  entry: NodeTree;
  localId: string | null;
  onOpen: (id: string) => void;
  onToggleReaction: (targetId: string, emoji: string) => void;
}) {
  const { entry, localId, onOpen, onToggleReaction } = props;
  const { node, replyCount } = entry;
  const t = useT();
  const isProject = node.kind === "project";

  if (node.deleted) {
    return (
      <article class="project-card project-card--deleted" onClick={() => onOpen(node.id)}>
        <div class="project-card-body">
          <p class="project-card-deleted-text">{t("board.postDeleted")}</p>
        </div>
        <footer class="project-card-foot">
          <span class="project-card-replies">💬 {replyCount}</span>
        </footer>
      </article>
    );
  }

  const joinReactions = node.reactions.filter((r) => r.emoji === JOIN_EMOJI);
  const joinCount = joinReactions.length;
  const joined = localId !== null && joinReactions.some((r) => r.fromId === localId);

  const heartReactions = node.reactions.filter((r) => r.emoji === HEART_EMOJI);
  const heartCount = heartReactions.length;
  const hearted = localId !== null && heartReactions.some((r) => r.fromId === localId);

  const joinLabel =
    node.capacity !== undefined
      ? t("board.joinCountCap", { count: joinCount, capacity: node.capacity })
      : t("board.joinCount", { count: joinCount });

  return (
    <article class="project-card" onClick={() => onOpen(node.id)}>
      <CardCover cid={node.thumbCid} mimeType={node.thumbMimeType} alt={node.title ?? ""}>
        <span class={`project-card-badge ${isProject ? "" : "project-card-badge--topic"}`}>
          {isProject ? t("board.recruit") : t("board.topic")}
        </span>
      </CardCover>
      <div class="project-card-body">
        {node.title && <h3 class="project-card-title">{node.title}</h3>}
        {node.text && <p class="project-card-excerpt">{node.text}</p>}
        <Chips roles={node.roles} tags={node.tags} />
      </div>
      <footer class="project-card-foot">
        {isProject ? (
          <button
            type="button"
            class={`project-card-join ${joined ? "project-card-join--mine" : ""}`}
            title={t("board.joinWish")}
            aria-pressed={joined}
            onClick={(e) => {
              e.stopPropagation();
              onToggleReaction(node.id, JOIN_EMOJI);
            }}
          >
            {JOIN_EMOJI} {joinLabel}
          </button>
        ) : (
          <span />
        )}
        <span class="project-card-foot-right">
          <button
            type="button"
            class={`project-card-heart ${hearted ? "project-card-heart--mine" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleReaction(node.id, HEART_EMOJI);
            }}
          >
            {HEART_EMOJI} {heartCount}
          </button>
          <span class="project-card-replies">💬 {replyCount}</span>
        </span>
      </footer>
    </article>
  );
}
