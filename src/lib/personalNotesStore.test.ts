import { describe, it, expect, beforeEach, vi } from "vitest";

const kvStore = new Map<string, Uint8Array>();
/** cid -> the bytes handed to storage_add_pinned (ciphertext, in practice). */
const blocks = new Map<string, Uint8Array>();
const pinned = new Set<string>();
/** Flipped on to simulate the OPFS KV being unreadable mid-session. */
let kvReadFails = false;
let nextCid = 0;

vi.mock("./mistClient", () => ({
  storage_kv_set: vi.fn(async (key: string, data: Uint8Array) => {
    kvStore.set(key, data);
  }),
  storage_kv_get: vi.fn(async (key: string) => {
    if (kvReadFails) throw new Error("kv unavailable");
    return kvStore.get(key);
  }),
  storage_add_pinned: vi.fn(async (_name: string, data: Uint8Array) => {
    const cid = `cid-${nextCid++}`;
    blocks.set(cid, data);
    pinned.add(cid);
    return cid;
  }),
  storage_unpin: vi.fn(async (cid: string) => {
    pinned.delete(cid);
  }),
}));

import {
  addPersonalAttachment,
  addPersonalTextNote,
  loadPersonalNotes,
  removePersonalNote,
  updatePersonalNoteText,
  PersonalNotesUnavailable,
} from "./personalNotesStore";
import { decryptPostBytes } from "../crypto/postCipher";

const KEY = "tc-chat:personal-notes";

function fileOf(bytes: number[], name: string, type: string): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

describe("personalNotesStore", () => {
  beforeEach(() => {
    kvStore.clear();
    blocks.clear();
    pinned.clear();
    kvReadFails = false;
    nextCid = 0;
  });

  it("starts empty", async () => {
    expect(await loadPersonalNotes()).toEqual([]);
  });

  it("appends a text note with a generated id and createdAt", async () => {
    await addPersonalTextNote("買い物リスト");
    const notes = await loadPersonalNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ kind: "text", text: "買い物リスト" });
    expect(typeof notes[0].id).toBe("string");
    expect(typeof notes[0].createdAt).toBe("number");
    expect(notes[0].editedAt).toBeUndefined();
  });

  it("trims the body and ignores a blank note", async () => {
    await addPersonalTextNote("  spaced  ");
    await addPersonalTextNote("   ");
    const notes = await loadPersonalNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0].text).toBe("spaced");
  });

  it("keeps notes in insertion order", async () => {
    await addPersonalTextNote("first");
    await addPersonalTextNote("second");
    expect((await loadPersonalNotes()).map((n) => n.text)).toEqual(["first", "second"]);
  });

  it("edits a note by id and stamps editedAt, leaving others untouched", async () => {
    await addPersonalTextNote("first");
    await addPersonalTextNote("second");
    const [first] = await loadPersonalNotes();

    await updatePersonalNoteText(first.id, "first (revised)");

    const notes = await loadPersonalNotes();
    expect(notes.find((n) => n.id === first.id)?.text).toBe("first (revised)");
    expect(notes.find((n) => n.id === first.id)?.editedAt).toEqual(expect.any(Number));
    expect(notes.find((n) => n.text === "second")?.editedAt).toBeUndefined();
  });

  it("refuses to blank a text note's body", async () => {
    await addPersonalTextNote("keep me");
    const [note] = await loadPersonalNotes();

    await updatePersonalNoteText(note.id, "   ");

    const [after] = await loadPersonalNotes();
    expect(after.text).toBe("keep me");
    expect(after.editedAt).toBeUndefined();
  });

  it("removes a note by id", async () => {
    await addPersonalTextNote("temporary");
    const [note] = await loadPersonalNotes();
    await removePersonalNote(note.id);
    expect(await loadPersonalNotes()).toEqual([]);
  });

  describe("attachments", () => {
    it("stores an image as an encrypted, pinned block and records its metadata", async () => {
      const plain = [1, 2, 3, 4, 5];
      await addPersonalAttachment(fileOf(plain, "photo.png", "image/png"));

      const [note] = await loadPersonalNotes();
      expect(note).toMatchObject({
        kind: "media",
        mimeType: "image/png",
        fileName: "photo.png",
        // The PLAINTEXT length, not the ciphertext's.
        fileSize: plain.length,
      });
      expect(note.cid).toBeTruthy();
      // Pinned, or mistlib's LRU could evict bytes that exist nowhere else.
      expect(pinned.has(note.cid!)).toBe(true);
    });

    it("writes ciphertext, never the plaintext bytes", async () => {
      const plain = [9, 8, 7, 6];
      await addPersonalAttachment(fileOf(plain, "secret.bin", "application/octet-stream"));

      const [note] = await loadPersonalNotes();
      const stored = blocks.get(note.cid!)!;
      expect(Array.from(stored)).not.toEqual(plain);
      // IV (12) + ciphertext + GCM tag (16) is strictly longer than the input.
      expect(stored.byteLength).toBeGreaterThan(plain.length);
    });

    it("round-trips through the recorded content key", async () => {
      const plain = [42, 43, 44];
      await addPersonalAttachment(fileOf(plain, "photo.png", "image/png"));

      const [note] = await loadPersonalNotes();
      const decrypted = await decryptPostBytes(note.enc!, blocks.get(note.cid!)!);
      expect(Array.from(decrypted)).toEqual(plain);
    });

    it("classifies non-media as the 'file' kind", async () => {
      await addPersonalAttachment(fileOf([1], "notes.pdf", "application/pdf"));
      await addPersonalAttachment(fileOf([1], "clip.mp4", "video/mp4"));

      const notes = await loadPersonalNotes();
      expect(notes.map((n) => n.kind)).toEqual(["file", "media"]);
    });

    it("keeps an optional caption and drops a blank one", async () => {
      await addPersonalAttachment(fileOf([1], "a.png", "image/png"), "  a caption ");
      await addPersonalAttachment(fileOf([2], "b.png", "image/png"), "   ");

      const notes = await loadPersonalNotes();
      expect(notes[0].text).toBe("a caption");
      expect(notes[1].text).toBeUndefined();
    });

    it("releases the pin when the note is removed", async () => {
      await addPersonalAttachment(fileOf([1, 2], "photo.png", "image/png"));
      const [note] = await loadPersonalNotes();
      expect(pinned.has(note.cid!)).toBe(true);

      await removePersonalNote(note.id);

      expect(pinned.has(note.cid!)).toBe(false);
      expect(await loadPersonalNotes()).toEqual([]);
    });

    it("still removes the note when unpinning fails", async () => {
      const { storage_unpin } = await import("./mistClient");
      await addPersonalAttachment(fileOf([1], "photo.png", "image/png"));
      const [note] = await loadPersonalNotes();
      vi.mocked(storage_unpin).mockRejectedValueOnce(new Error("unpin exploded"));

      await removePersonalNote(note.id);

      expect(await loadPersonalNotes()).toEqual([]);
    });
  });

  // The point of separating "empty" from "couldn't read": a transient KV
  // failure that degraded to [] would let the very next write persist an
  // empty list over every existing note.
  describe("when the store can't be read", () => {
    it("refuses to add, leaving the persisted notes untouched", async () => {
      await addPersonalTextNote("precious");
      const before = kvStore.get(KEY);
      kvReadFails = true;

      await expect(addPersonalTextNote("clobber")).rejects.toBeInstanceOf(
        PersonalNotesUnavailable,
      );
      expect(kvStore.get(KEY)).toBe(before);
    });

    it("refuses to edit or remove", async () => {
      await addPersonalTextNote("precious");
      const [note] = await loadPersonalNotes();
      kvReadFails = true;

      await expect(updatePersonalNoteText(note.id, "nope")).rejects.toBeInstanceOf(
        PersonalNotesUnavailable,
      );
      await expect(removePersonalNote(note.id)).rejects.toBeInstanceOf(PersonalNotesUnavailable);
    });

    it("treats a corrupt payload as unreadable rather than empty", async () => {
      kvStore.set(KEY, new TextEncoder().encode("{ not json"));

      expect(await loadPersonalNotes()).toEqual([]);
      await expect(addPersonalTextNote("clobber")).rejects.toBeInstanceOf(
        PersonalNotesUnavailable,
      );
      // The damaged value is still on disk for manual recovery.
      expect(new TextDecoder().decode(kvStore.get(KEY)!)).toBe("{ not json");
    });

    it("treats a non-array payload as unreadable", async () => {
      kvStore.set(KEY, new TextEncoder().encode('{"notes":[]}'));
      await expect(addPersonalTextNote("clobber")).rejects.toBeInstanceOf(
        PersonalNotesUnavailable,
      );
    });
  });
});
