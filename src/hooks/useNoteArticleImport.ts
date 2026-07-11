// Live-subscribes to tc-note's "note-article" shared-bus topic (see
// protocol/docs/data-contracts/docs/SHARED_BUS.md) so the board composer can
// offer to import a note published from an open tc-note tab on the same
// origin. Parsing/gating is pure (see lib/noteArticleImport.ts); this hook
// only wires that logic up to the DOM (localStorage consumed marker,
// subscribeShared) and to mistlib (resolving the CID to markdown bytes).
import { useEffect, useState } from "preact/hooks";
import { readShared, subscribeShared } from "../lib/sharedBus";
import { parseNoteArticle, isNoteArticleConsumed, type NoteArticle } from "../lib/noteArticleImport";
import { getNode, storage_get } from "../lib/mistClient";

const TOPIC = "note-article";
const CONSUMED_KEY = "tc-chat-note-article-consumed-v1";

function loadConsumedMarker(): string | null {
  try {
    return localStorage.getItem(CONSUMED_KEY);
  } catch {
    return null;
  }
}

function saveConsumedMarker(updatedAt: string) {
  try {
    localStorage.setItem(CONSUMED_KEY, updatedAt);
  } catch {
    // best-effort; worst case the banner re-shows next load.
  }
}

export function useNoteArticleImport() {
  const [article, setArticle] = useState<NoteArticle | null>(() => parseNoteArticle(readShared(TOPIC)));
  const [consumedUpdatedAt, setConsumedUpdatedAt] = useState<string | null>(() => loadConsumedMarker());

  useEffect(() => {
    // Pick up a publish that happened before this component mounted, then
    // stay live for one from an open tc-note tab / another tc-chat tab.
    setArticle(parseNoteArticle(readShared(TOPIC)));
    return subscribeShared(TOPIC, (record) => setArticle(parseNoteArticle(record)));
  }, []);

  const pending = isNoteArticleConsumed(article, consumedUpdatedAt) ? null : article;

  function markConsumed() {
    if (!article) return;
    saveConsumedMarker(article.updatedAt);
    setConsumedUpdatedAt(article.updatedAt);
  }

  /** Resolves the pending article's full markdown body — either the inline
   * fallback text, or a mistlib storage_get() by CID. */
  async function resolveBody(): Promise<string> {
    if (!article) return "";
    if (article.text !== undefined) return article.text;
    if (!article.cid) return "";
    await getNode();
    const bytes = await storage_get(article.cid);
    return new TextDecoder().decode(bytes);
  }

  return { pending, markConsumed, resolveBody };
}
