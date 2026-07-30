import { useEffect, useState } from "preact/hooks";
import { getNode } from "../lib/mistClient";
import {
  addPersonalAttachment,
  addPersonalTextNote,
  loadPersonalNotes,
  removePersonalNote,
  updatePersonalNoteText,
  type PersonalNote,
} from "../lib/personalNotesStore";

/**
 * Which operation failed, rather than a ready-made sentence — the hook has no
 * locale, so the component maps these onto its own t() keys.
 */
export type PersonalNotesError = "load" | "save" | "attach";

export function usePersonalNotes() {
  const [notes, setNotes] = useState<PersonalNote[]>([]);
  // The composer stays disabled until the first read lands. Without this a
  // note typed during startup would be written against an empty in-memory
  // list; the store refuses that too, but disabling is the honest signal.
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<PersonalNotesError | null>(null);

  // Notes live in mistlib's OPFS KV, which needs the wasm runtime up first
  // (same async-load shape as usePersonalEvents).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await getNode();
      } catch {
        // Fall through: the KV read below reports the failure on its own.
      }
      try {
        const loaded = await loadPersonalNotes();
        if (!cancelled) setNotes(loaded);
      } catch {
        if (!cancelled) setError("load");
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Runs a store mutation, replacing the list on success and flagging `kind` on failure. */
  async function run(kind: PersonalNotesError, op: () => Promise<PersonalNote[]>) {
    try {
      setNotes(await op());
      setError(null);
    } catch (err) {
      console.warn("tc-chat: personal note operation failed", err);
      setError(kind);
    }
  }

  return {
    notes,
    ready,
    error,
    dismissError: () => setError(null),
    addText: (text: string) => run("save", () => addPersonalTextNote(text)),
    addAttachment: (file: File, caption?: string) =>
      run("attach", () => addPersonalAttachment(file, caption)),
    editNote: (id: string, text: string) => run("save", () => updatePersonalNoteText(id, text)),
    removeNote: (id: string) => run("save", () => removePersonalNote(id)),
  };
}
