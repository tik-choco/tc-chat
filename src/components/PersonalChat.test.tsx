import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, fireEvent, cleanup, waitFor, screen } from "@testing-library/preact";
import { PersonalChat } from "./PersonalChat";
import type { PersonalNote } from "../lib/personalNotesStore";

// Attachments resolve through the same helper the chat/gallery use.
vi.mock("../lib/mediaUrl", () => ({
  resolveStorageUrl: vi.fn(async (cid: string) => `blob:${cid}`),
  invalidateStorageUrl: vi.fn(),
}));

import { resolveStorageUrl } from "../lib/mediaUrl";
const resolveStorageUrlMock = vi.mocked(resolveStorageUrl);

beforeEach(() => {
  resolveStorageUrlMock.mockReset();
  resolveStorageUrlMock.mockImplementation(async (cid: string) => `blob:${cid}`);
});

afterEach(() => {
  cleanup();
});

function note(over: Partial<PersonalNote> & Pick<PersonalNote, "id">): PersonalNote {
  return {
    kind: "text",
    text: "a note",
    createdAt: new Date("2026-07-30T10:00:00").getTime(),
    ...over,
  };
}

const baseProps = {
  notes: [] as PersonalNote[],
  ready: true,
  error: null,
  onDismissError: () => {},
  onOpenSidebar: () => {},
  onAddText: () => {},
  onAddAttachment: () => {},
  onEditNote: () => {},
  onRemoveNote: () => {},
};

describe("PersonalChat", () => {
  it("shows the empty state with the local-only reassurance", () => {
    render(<PersonalChat {...baseProps} />);
    expect(screen.getByText(/まだメモはありません/)).toBeTruthy();
    expect(screen.getByText(/誰にも送信されません/)).toBeTruthy();
  });

  it("renders the note body as markdown", () => {
    const { container } = render(
      <PersonalChat {...baseProps} notes={[note({ id: "n1", text: "**bold**" })]} />,
    );
    expect(container.querySelector(".note-body strong")?.textContent).toBe("bold");
  });

  it("submits a trimmed note and clears the composer", () => {
    const onAddText = vi.fn();
    const { container } = render(<PersonalChat {...baseProps} onAddText={onAddText} />);
    const input = container.querySelector(".personal-input") as HTMLTextAreaElement;

    fireEvent.input(input, { target: { value: "買い物" } });
    fireEvent.submit(container.querySelector(".personal-composer") as HTMLFormElement);

    expect(onAddText).toHaveBeenCalledWith("買い物");
    expect(input.value).toBe("");
  });

  it("sends on Enter but not on Shift+Enter", () => {
    const onAddText = vi.fn();
    const { container } = render(<PersonalChat {...baseProps} onAddText={onAddText} />);
    const input = container.querySelector(".personal-input") as HTMLTextAreaElement;
    fireEvent.input(input, { target: { value: "hi" } });

    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(onAddText).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAddText).toHaveBeenCalledWith("hi");
  });

  it("disables the composer until the store has loaded", () => {
    const { container } = render(<PersonalChat {...baseProps} ready={false} />);
    expect((container.querySelector(".personal-input") as HTMLTextAreaElement).disabled).toBe(true);
    expect((container.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("keeps the send button disabled for a blank draft", () => {
    const { container } = render(<PersonalChat {...baseProps} />);
    const send = container.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(send.disabled).toBe(true);

    fireEvent.input(container.querySelector(".personal-input") as HTMLTextAreaElement, {
      target: { value: "   " },
    });
    expect(send.disabled).toBe(true);
  });

  it("marks an edited note", () => {
    render(
      <PersonalChat
        {...baseProps}
        notes={[note({ id: "n1", editedAt: Date.now() })]}
      />,
    );
    expect(screen.getByText("編集済み")).toBeTruthy();
  });

  it("edits a note in place and commits on save", () => {
    const onEditNote = vi.fn();
    const { container } = render(
      <PersonalChat {...baseProps} notes={[note({ id: "n1" })]} onEditNote={onEditNote} />,
    );

    fireEvent.click(screen.getByLabelText("メモを編集"));
    const editor = container.querySelector(".note-edit-input") as HTMLTextAreaElement;
    expect(editor.value).toBe("a note");

    fireEvent.input(editor, { target: { value: "revised" } });
    // Scoped to the editor: the composer's send button carries the same label.
    fireEvent.click(container.querySelector(".note-edit-actions .send-btn") as HTMLButtonElement);

    expect(onEditNote).toHaveBeenCalledWith("n1", "revised");
    expect(container.querySelector(".note-edit-input")).toBeNull();
  });

  it("abandons an edit on Escape without calling back", () => {
    const onEditNote = vi.fn();
    const { container } = render(
      <PersonalChat {...baseProps} notes={[note({ id: "n1" })]} onEditNote={onEditNote} />,
    );

    fireEvent.click(screen.getByLabelText("メモを編集"));
    fireEvent.keyDown(container.querySelector(".note-edit-input") as HTMLTextAreaElement, {
      key: "Escape",
    });

    expect(onEditNote).not.toHaveBeenCalled();
    expect(container.querySelector(".note-edit-input")).toBeNull();
  });

  it("confirms before deleting", () => {
    const onRemoveNote = vi.fn();
    render(
      <PersonalChat {...baseProps} notes={[note({ id: "n1" })]} onRemoveNote={onRemoveNote} />,
    );

    fireEvent.click(screen.getByLabelText("メモを削除"));
    // The dialog is up, but nothing is removed until it's confirmed.
    expect(screen.getByText("このメモを削除しますか？")).toBeTruthy();
    expect(onRemoveNote).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "削除する" }));
    expect(onRemoveNote).toHaveBeenCalledWith("n1");
  });

  it("renders an image attachment from its cid and content key", async () => {
    const enc = { v: 1, alg: "A256GCM", key: "k" } as const;
    const { container } = render(
      <PersonalChat
        {...baseProps}
        notes={[
          note({
            id: "n1",
            kind: "media",
            text: undefined,
            cid: "cid-1",
            enc,
            mimeType: "image/png",
            fileName: "photo.png",
          }),
        ]}
      />,
    );

    await waitFor(() =>
      expect((container.querySelector(".note-image") as HTMLImageElement)?.src).toContain(
        "blob:cid-1",
      ),
    );
    // The content key must be handed to the resolver, or the bytes stay
    // ciphertext and the image never decodes.
    expect(resolveStorageUrlMock).toHaveBeenCalledWith("cid-1", enc);
  });

  it("renders a non-media attachment as a download link", async () => {
    const { container } = render(
      <PersonalChat
        {...baseProps}
        notes={[
          note({
            id: "n1",
            kind: "file",
            text: undefined,
            cid: "cid-2",
            mimeType: "application/pdf",
            fileName: "notes.pdf",
            fileSize: 2048,
          }),
        ]}
      />,
    );

    await waitFor(() => expect(container.querySelector(".note-file")).toBeTruthy());
    const link = container.querySelector(".note-file") as HTMLAnchorElement;
    expect(link.getAttribute("download")).toBe("notes.pdf");
    expect(link.textContent).toContain("2.0 KB");
  });

  it("offers a retry when an attachment fails to resolve", async () => {
    resolveStorageUrlMock.mockRejectedValue(new Error("gone"));
    const { container } = render(
      <PersonalChat
        {...baseProps}
        notes={[note({ id: "n1", kind: "media", text: undefined, cid: "cid-3", mimeType: "image/png" })]}
      />,
    );

    await waitFor(() => expect(container.querySelector(".note-attach-error")).toBeTruthy());
  });

  it("groups notes under a date divider per local day", () => {
    const { container } = render(
      <PersonalChat
        {...baseProps}
        notes={[
          note({ id: "n1", createdAt: new Date("2026-07-28T10:00:00").getTime() }),
          note({ id: "n2", createdAt: new Date("2026-07-28T18:00:00").getTime() }),
          note({ id: "n3", createdAt: new Date("2026-07-29T09:00:00").getTime() }),
        ]}
      />,
    );
    // Two calendar days across three notes.
    expect(container.querySelectorAll(".date-divider")).toHaveLength(2);
  });

  it("surfaces a store error and can dismiss it", () => {
    const onDismissError = vi.fn();
    render(<PersonalChat {...baseProps} error="save" onDismissError={onDismissError} />);

    expect(screen.getByRole("alert").textContent).toContain("メモを保存できませんでした");
    fireEvent.click(screen.getByLabelText("閉じる"));
    expect(onDismissError).toHaveBeenCalled();
  });
});
