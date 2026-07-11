// Parses the "note-article" shared-bus record published by tc-note (see
// protocol/docs/data-contracts/docs/SHARED_BUS.md) and gates whether it has
// already been imported into the board composer. Kept pure/sync — no
// mistlib, no DOM — so the parsing and consumed-gating rules are unit
// testable on their own; resolving the CID to bytes (an async mistlib call)
// lives in useNoteArticleImport.ts instead.
import type { SharedRecord } from "./sharedBus";

export interface NoteArticle {
  title: string;
  format: string;
  excerpt: string;
  publishedAt: string;
  /** mistlib CID to resolve via storage_get, or "" when `text` carries the
   * body inline (tc-note's fallback when its OPFS store is unavailable). */
  cid: string;
  /** Inline markdown body — only set when `cid === ""`. */
  text?: string;
  /** The record's own updatedAt, used as the consumed-gating key. */
  updatedAt: string;
}

/**
 * Validates and narrows a raw SharedRecord's `meta` into a NoteArticle.
 * Returns null if the record is absent or its shape doesn't match the
 * note-article contract (missing required fields, or neither a CID nor an
 * inline `meta.text` fallback).
 */
export function parseNoteArticle(record: SharedRecord | null): NoteArticle | null {
  if (!record) return null;
  const meta = record.meta;
  if (
    typeof meta.title !== "string" ||
    typeof meta.excerpt !== "string" ||
    typeof meta.publishedAt !== "string"
  ) {
    return null;
  }
  const hasCid = typeof record.cid === "string" && record.cid.length > 0;
  const hasInlineText = typeof meta.text === "string";
  if (!hasCid && !hasInlineText) return null;

  return {
    title: meta.title,
    format: typeof meta.format === "string" ? meta.format : "markdown",
    excerpt: meta.excerpt,
    publishedAt: meta.publishedAt,
    cid: record.cid,
    text: hasInlineText ? (meta.text as string) : undefined,
    updatedAt: record.updatedAt,
  };
}

/**
 * True when `article` should NOT be surfaced: there is no article, or its
 * `updatedAt` matches the last-consumed marker the UI persisted
 * (`tc-chat-note-article-consumed-v1`). A fresh publish always carries a new
 * `updatedAt` (see tc-note's publishShared), so re-publishing the same note
 * re-surfaces the banner even if an older version was already consumed.
 */
export function isNoteArticleConsumed(article: NoteArticle | null, consumedUpdatedAt: string | null): boolean {
  if (!article) return true;
  return article.updatedAt === consumedUpdatedAt;
}
