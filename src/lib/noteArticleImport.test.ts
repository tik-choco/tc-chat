import { describe, it, expect } from "vitest";
import { parseNoteArticle, isNoteArticleConsumed } from "./noteArticleImport";
import type { SharedRecord } from "./sharedBus";

function record(over: Partial<SharedRecord> = {}): SharedRecord {
  return {
    cid: "cid-1",
    meta: { title: "My note", format: "markdown", excerpt: "First 200 chars…", publishedAt: "2026-07-09T00:00:00.000Z" },
    updatedAt: "2026-07-09T00:00:00.000Z",
    from: "tc-note",
    ...over,
  };
}

describe("parseNoteArticle", () => {
  it("returns null for a missing record", () => {
    expect(parseNoteArticle(null)).toBeNull();
  });

  it("parses a well-formed CID-backed record", () => {
    const article = parseNoteArticle(record());
    expect(article).toEqual({
      title: "My note",
      format: "markdown",
      excerpt: "First 200 chars…",
      publishedAt: "2026-07-09T00:00:00.000Z",
      cid: "cid-1",
      text: undefined,
      updatedAt: "2026-07-09T00:00:00.000Z",
    });
  });

  it("accepts the inline-text fallback shape (cid: '')", () => {
    const article = parseNoteArticle(
      record({ cid: "", meta: { ...record().meta, text: "# Full markdown body" } }),
    );
    expect(article?.cid).toBe("");
    expect(article?.text).toBe("# Full markdown body");
  });

  it("defaults format to markdown when meta.format is missing", () => {
    const meta = { ...record().meta } as Record<string, unknown>;
    delete meta.format;
    const article = parseNoteArticle(record({ meta }));
    expect(article?.format).toBe("markdown");
  });

  it("rejects a record with neither a CID nor inline text", () => {
    expect(parseNoteArticle(record({ cid: "" }))).toBeNull();
  });

  it("rejects a record missing required meta fields", () => {
    expect(parseNoteArticle(record({ meta: { title: "Only a title" } }))).toBeNull();
  });
});

describe("isNoteArticleConsumed", () => {
  it("treats a missing article as already consumed (nothing to show)", () => {
    expect(isNoteArticleConsumed(null, null)).toBe(true);
  });

  it("is unconsumed when there is no stored marker yet", () => {
    const article = parseNoteArticle(record())!;
    expect(isNoteArticleConsumed(article, null)).toBe(false);
  });

  it("is consumed once the marker matches the article's updatedAt", () => {
    const article = parseNoteArticle(record())!;
    expect(isNoteArticleConsumed(article, article.updatedAt)).toBe(true);
  });

  it("re-surfaces after a re-publish changes updatedAt, even if an older one was consumed", () => {
    const article = parseNoteArticle(record({ updatedAt: "2026-07-09T01:00:00.000Z" }))!;
    expect(isNoteArticleConsumed(article, "2026-07-09T00:00:00.000Z")).toBe(false);
  });
});
