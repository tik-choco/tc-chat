import { useState } from "preact/hooks";
import type { JSX } from "preact";
import type { BoardNodeKind } from "../lib/chatStore";
import type { CreatePostInput } from "../hooks/usePostStream";
import { useT } from "../lib/i18n";

function splitTokens(value: string): string[] {
  return value
    .split(/[,、]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * The single composer for every kind of board entry. In "root" mode it offers
 * the discussion/recruitment switch and (for recruitment) title/roles/tags; in
 * "reply" mode it is a compact comment box. Both emit the same CreatePostInput,
 * which is why one form covers posts, threads, and nested comments alike.
 */
export function NodeComposer(props: {
  mode: "root" | "reply";
  parentId: string | null;
  onSubmit: (input: CreatePostInput) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
  /** Pre-fills the composer (e.g. importing a tc-note article) — captured once
   * as initial state, not kept in sync with later prop changes. */
  initialTitle?: string;
  initialText?: string;
}) {
  const t = useT();
  const { mode, parentId, onSubmit, onCancel, autoFocus, initialTitle, initialText } = props;
  const [kind, setKind] = useState<BoardNodeKind>("text");
  const [title, setTitle] = useState(initialTitle ?? "");
  const [text, setText] = useState(initialText ?? "");
  const [roles, setRoles] = useState("");
  const [tags, setTags] = useState("");
  const [error, setError] = useState("");

  const isProject = mode === "root" && kind === "project";

  function reset() {
    setTitle("");
    setText("");
    setRoles("");
    setTags("");
    setError("");
  }

  function handleSubmit(e: JSX.TargetedEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!text.trim()) {
      setError(isProject ? t("board.errRecruitBody") : t("board.errBody"));
      return;
    }
    if (isProject && !title.trim()) {
      setError(t("board.errRecruitTitle"));
      return;
    }
    onSubmit({
      parentId,
      kind: mode === "root" ? kind : "text",
      title: mode === "root" ? title.trim() || undefined : undefined,
      text: text.trim(),
      roles: isProject ? splitTokens(roles) : undefined,
      tags: isProject ? splitTokens(tags) : undefined,
    });
    reset();
  }

  return (
    <form class={`node-composer node-composer--${mode}`} onSubmit={handleSubmit}>
      {mode === "root" && (
        <div class="composer-kind-toggle" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={kind === "text"}
            class={`composer-kind-btn ${kind === "text" ? "composer-kind-btn--active" : ""}`}
            onClick={() => setKind("text")}
          >
            💬 {t("board.topic")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={kind === "project"}
            class={`composer-kind-btn ${kind === "project" ? "composer-kind-btn--active" : ""}`}
            onClick={() => setKind("project")}
          >
            📋 {t("board.recruit")}
          </button>
        </div>
      )}

      {(isProject || (mode === "root" && kind === "text")) && (
        <input
          class="composer-title"
          placeholder={isProject ? t("board.recruitTitlePlaceholder") : t("board.titleOptionalPlaceholder")}
          value={title}
          onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
        />
      )}

      <textarea
        class="composer-text"
        placeholder={
          mode === "reply"
            ? t("board.replyPlaceholder")
            : isProject
              ? t("board.recruitBodyPlaceholder")
              : t("board.bodyPlaceholder")
        }
        rows={mode === "reply" ? 2 : 3}
        value={text}
        autofocus={autoFocus}
        onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
      />

      {isProject && (
        <div class="composer-row">
          <input
            placeholder={t("board.rolesPlaceholder")}
            value={roles}
            onInput={(e) => setRoles((e.target as HTMLInputElement).value)}
          />
          <input
            placeholder={t("board.tagsPlaceholder")}
            value={tags}
            onInput={(e) => setTags((e.target as HTMLInputElement).value)}
          />
        </div>
      )}

      {error && <p class="form-error">{error}</p>}

      <div class="composer-actions">
        {onCancel && (
          <button type="button" class="composer-cancel" onClick={onCancel}>
            {t("common.cancel")}
          </button>
        )}
        <button type="submit" class="send-btn">
          {mode === "reply" ? t("board.reply") : isProject ? t("board.submitRecruit") : t("board.submitPost")}
        </button>
      </div>
    </form>
  );
}
