// The personal notes space — a chat-shaped scratchpad that lives only on this
// device. Unlike every other surface in this app it has NO wire protocol at
// all: nothing here is signed, broadcast, replayed, relayed or history-synced,
// and PERSONAL_ROOM_ID is never joined as a swarm topic (see util.ts).
//
// That promise is kept structurally rather than by discipline: this module
// imports nothing that can transmit, and the UI path never goes through
// usePostStream. Resist "unifying" it with the post engine — the moment a
// personal note can reach a channelId, the feature is broken.
//
// Storage is split the same way personalCalendarStore.ts splits it:
//   - the note list (unbounded free text) -> mistlib's OPFS KV
//   - attachment bytes                    -> mistlib's content-addressed store
//
// Attachments differ from a room post's attachment in two deliberate ways:
//
//  1. PINNED (storage_add_pinned). A room post's bytes can always be re-fetched
//     from some peer that also holds them, so mistlib's LRU eviction of an
//     unpinned block is recoverable. A personal note's bytes exist in exactly
//     one place on earth, so the same eviction would destroy them permanently.
//     removeNote releases the pin again so deleted attachments stop occupying
//     the budget.
//
//  2. ENCRYPTED anyway (postCipher), even though the key never leaves this
//     device. mistlib serves any block it holds to whoever asks for the CID,
//     so plaintext personal bytes in the local block store would be readable
//     by anyone who learned or guessed the CID. The content key lives in the
//     note record here, so only this device can open them.
//
// Note that unpinning is not erasure: mistlib exposes no delete-block API, so
// a removed note's bytes linger (unreadable without the key, and now
// evictable) until eviction reclaims them.
import { newId } from "./util";
import { storage_kv_set, storage_kv_get, storage_add_pinned, storage_unpin } from "./mistClient";
import { generatePostEnc, encryptPostBytes, type PostEnc } from "../crypto/postCipher";

/** A rendering hint, mirroring PostNode's `kind` — not a storage distinction. */
export type PersonalNoteKind = "text" | "media" | "file";

export interface PersonalNote {
  id: string;
  kind: PersonalNoteKind;
  /** Markdown body for a text note; an optional caption on an attachment. */
  text?: string;
  /** Pinned, encrypted attachment bytes ("media"/"file" kinds). */
  cid?: string;
  /** Content key for `cid`. Local-only, never broadcast — see postCipher. */
  enc?: PostEnc;
  mimeType?: string;
  fileName?: string;
  /** PLAINTEXT byte length, so the UI reports the file's real size. */
  fileSize?: number;
  createdAt: number;
  /** Set once the body has been edited after it was first written. */
  editedAt?: number;
}

const KEY = "tc-chat:personal-notes";
// Attachments go in under their own name so they're distinguishable from a
// room post's encrypted body ("enc.bin") when inspecting the block store.
const STORAGE_NAME = "personal.bin";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Read outcome. "Empty" and "couldn't read" must stay distinguishable: a
 * transient KV failure that silently degraded to `[]` would let the very next
 * write persist that empty list over real notes. Every mutation below refuses
 * to write unless the read genuinely succeeded.
 */
type ReadResult = { ok: true; notes: PersonalNote[] } | { ok: false };

async function readNotes(): Promise<ReadResult> {
  let bytes: Uint8Array | undefined;
  try {
    bytes = await storage_kv_get(KEY);
  } catch (error) {
    console.warn("tc-chat: failed to read personal notes", error);
    return { ok: false };
  }
  // Absent key: a genuinely empty store, safe to write over.
  if (!bytes) return { ok: true, notes: [] };
  try {
    const parsed: unknown = JSON.parse(decoder.decode(bytes));
    if (!Array.isArray(parsed)) throw new Error("not an array");
    return { ok: true, notes: parsed as PersonalNote[] };
  } catch (error) {
    // Corrupt payload. Treated as a failure, NOT as empty, so the damaged
    // value stays on disk for manual recovery instead of being overwritten
    // by the next note the user types.
    console.warn("tc-chat: personal notes are unreadable; refusing to overwrite", error);
    return { ok: false };
  }
}

/** Thrown when the notes can't be read; the hook surfaces it to the user. */
export class PersonalNotesUnavailable extends Error {
  constructor() {
    super("personalNotesStore: storage unavailable");
    this.name = "PersonalNotesUnavailable";
  }
}

/** Loads every note, oldest first. Returns [] when nothing has been saved. */
export async function loadPersonalNotes(): Promise<PersonalNote[]> {
  const result = await readNotes();
  return result.ok ? result.notes : [];
}

async function writeNotes(notes: PersonalNote[]): Promise<void> {
  await storage_kv_set(KEY, encoder.encode(JSON.stringify(notes)));
}

/**
 * Read-modify-write against the current notes. Throws
 * {@link PersonalNotesUnavailable} rather than writing when the read failed,
 * so a mutation can never clobber notes it couldn't see.
 */
async function mutate(
  apply: (notes: PersonalNote[]) => PersonalNote[],
): Promise<PersonalNote[]> {
  const result = await readNotes();
  if (!result.ok) throw new PersonalNotesUnavailable();
  const next = apply(result.notes);
  await writeNotes(next);
  return next;
}

/** Appends a markdown text note. */
export async function addPersonalTextNote(text: string): Promise<PersonalNote[]> {
  const body = text.trim();
  if (!body) return loadPersonalNotes();
  return mutate((notes) => [
    ...notes,
    { id: newId(), kind: "text", text: body, createdAt: Date.now() },
  ]);
}

/**
 * Encrypts a file, pins it into mistlib's block store and appends a note
 * pointing at it. The bytes are written before the note is recorded, so a
 * failure here leaves no note referencing a CID that was never stored.
 */
export async function addPersonalAttachment(
  file: File,
  caption?: string,
): Promise<PersonalNote[]> {
  const plain = new Uint8Array(await file.arrayBuffer());
  const enc = generatePostEnc();
  const cipher = await encryptPostBytes(enc, plain);
  const cid = await storage_add_pinned(STORAGE_NAME, cipher);
  const body = caption?.trim();
  return mutate((notes) => [
    ...notes,
    {
      id: newId(),
      // "media" gets an inline preview; everything else renders as a download
      // chip. Same split MessageBubble makes for a room post.
      kind: file.type.startsWith("image/") || file.type.startsWith("video/") ? "media" : "file",
      text: body || undefined,
      cid,
      enc,
      mimeType: file.type,
      fileName: file.name,
      fileSize: file.size,
      createdAt: Date.now(),
    },
  ]);
}

/** Rewrites a note's body (text note, or an attachment's caption). */
export async function updatePersonalNoteText(id: string, text: string): Promise<PersonalNote[]> {
  const body = text.trim();
  return mutate((notes) =>
    notes.map((note) =>
      note.id === id
        ? // A text note must keep a body; an attachment may have its caption
          // cleared entirely.
          note.kind === "text" && !body
          ? note
          : { ...note, text: body || undefined, editedAt: Date.now() }
        : note,
    ),
  );
}

/**
 * Drops a note and releases its attachment's pin. The unpin is best-effort:
 * losing it only means the bytes keep occupying pinned space, which must not
 * block removing the note itself.
 */
export async function removePersonalNote(id: string): Promise<PersonalNote[]> {
  const result = await readNotes();
  if (!result.ok) throw new PersonalNotesUnavailable();
  const target = result.notes.find((note) => note.id === id);
  const next = result.notes.filter((note) => note.id !== id);
  await writeNotes(next);
  if (target?.cid) {
    try {
      await storage_unpin(target.cid);
    } catch (error) {
      console.warn(`tc-chat: failed to unpin personal attachment "${target.cid}"`, error);
    }
  }
  return next;
}
