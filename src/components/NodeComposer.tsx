import { useEffect, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import type { BoardNodeKind } from "../lib/chatStore";
import type { CreatePostInput } from "../hooks/usePostStream";
import { makeThumbnail, type ThumbResult } from "../lib/imageThumb";
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
  const [capacity, setCapacity] = useState("");
  const [error, setError] = useState("");
  const [thumb, setThumb] = useState<ThumbResult | null>(null);
  const [thumbPreviewUrl, setThumbPreviewUrl] = useState<string | null>(null);
  const thumbInputRef = useRef<HTMLInputElement>(null);

  const isProject = mode === "root" && kind === "project";

  // Revokes on every change (the previous URL, via the closure this effect's
  // cleanup captured) and on unmount (the last one) — a single spot for it
  // rather than scattering revokes across every place the URL can change.
  useEffect(() => {
    return () => {
      if (thumbPreviewUrl) URL.revokeObjectURL(thumbPreviewUrl);
    };
  }, [thumbPreviewUrl]);

  function clearThumb() {
    setThumb(null);
    setThumbPreviewUrl(null);
    if (thumbInputRef.current) thumbInputRef.current.value = "";
  }

  async function handleThumbPick(e: JSX.TargetedEvent<HTMLInputElement>) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (thumbInputRef.current) thumbInputRef.current.value = "";
    if (!file) return;
    try {
      const result = await makeThumbnail(file);
      setThumb(result);
      setThumbPreviewUrl(URL.createObjectURL(new Blob([result.bytes.slice().buffer], { type: result.mimeType })));
      setError("");
    } catch {
      setError(t("board.thumbError"));
    }
  }

  function reset() {
    setTitle("");
    setText("");
    setRoles("");
    setTags("");
    setCapacity("");
    setError("");
    clearThumb();
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
    const parsedCapacity = Number.parseInt(capacity, 10);
    const capacityValue =
      isProject && capacity.trim() && Number.isInteger(parsedCapacity) && parsedCapacity > 0
        ? parsedCapacity
        : undefined;
    onSubmit({
      parentId,
      kind: mode === "root" ? kind : "text",
      title: mode === "root" ? title.trim() || undefined : undefined,
      text: text.trim(),
      roles: isProject ? splitTokens(roles) : undefined,
      tags: isProject ? splitTokens(tags) : undefined,
      thumb: thumb ?? undefined,
      capacity: capacityValue,
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
          <input
            type="number"
            min="1"
            class="composer-capacity"
            placeholder={t("board.capacityPlaceholder")}
            value={capacity}
            onInput={(e) => setCapacity((e.target as HTMLInputElement).value)}
          />
        </div>
      )}

      {mode === "root" && (
        <div class="composer-thumb-row">
          <input
            ref={thumbInputRef}
            type="file"
            accept="image/*"
            class="file-input"
            onChange={handleThumbPick}
          />
          {thumbPreviewUrl ? (
            <div class="composer-thumb-preview">
              <img src={thumbPreviewUrl} alt={t("board.thumbAlt")} />
              <button
                type="button"
                class="composer-thumb-remove"
                aria-label={t("board.thumbRemove")}
                title={t("board.thumbRemove")}
                onClick={clearThumb}
              >
                ×
              </button>
            </div>
          ) : (
            <button
              type="button"
              class="composer-thumb-add"
              onClick={() => thumbInputRef.current?.click()}
            >
              🖼 {t("board.thumbAdd")}
            </button>
          )}
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
