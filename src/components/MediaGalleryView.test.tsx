import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup, waitFor } from "@testing-library/preact";
import { MediaGalleryView } from "./MediaGalleryView";
import type { PostNode } from "../lib/chatStore";

// The gallery resolves each tile's cid to a blob URL via resolveStorageUrl
// (same module the Lightbox itself uses), so this mock covers both.
vi.mock("../lib/mediaUrl", () => ({
  resolveStorageUrl: vi.fn(async (cid: string) => `blob:${cid}`),
}));

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function makeItem(over: Partial<PostNode> & Pick<PostNode, "id">): PostNode {
  return {
    roomId: "room",
    surface: "gallery",
    parentId: null,
    fromId: "u1",
    fromName: "U1",
    timestamp: 1,
    kind: "media",
    cid: "cid-1",
    mimeType: "image/png",
    fileName: "pic.png",
    reactions: [],
    ...over,
  };
}

const baseProps = {
  roomName: "room",
  localNodeId: "u1",
  ready: true,
  directory: {},
  onAddFiles: () => {},
  onAddStoredFile: () => {},
  onToggleReaction: () => {},
  onDelete: () => {},
};

describe("MediaGalleryView", () => {
  it("shows the empty state when there are no media posts", () => {
    const { getByText } = render(<MediaGalleryView {...baseProps} items={[]} />);
    expect(getByText("まだ写真や動画がありません")).toBeTruthy();
    expect(getByText("最初のメディアを共有しましょう")).toBeTruthy();
  });

  it("shows the loading state instead of the grid/empty state while !ready", () => {
    const item = makeItem({ id: "a" });
    const { getByText, queryByText } = render(
      <MediaGalleryView {...baseProps} ready={false} items={[item]} />,
    );
    expect(getByText("読み込み中…")).toBeTruthy();
    expect(queryByText("まだ写真や動画がありません")).toBeNull();
  });

  it("renders image and video posts, resolving each thumbnail via resolveStorageUrl", async () => {
    const image = makeItem({ id: "img", cid: "cid-img", mimeType: "image/png", fileName: "photo.png" });
    const video = makeItem({
      id: "vid",
      cid: "cid-vid",
      mimeType: "video/mp4",
      fileName: "clip.mp4",
      fromId: "u2",
      fromName: "U2",
      timestamp: 2,
    });
    const { container } = render(<MediaGalleryView {...baseProps} items={[image, video]} />);

    const img = await waitFor(() => {
      const el = container.querySelector<HTMLImageElement>("img.gallery-tile-thumb");
      if (!el) throw new Error("not resolved yet");
      return el;
    });
    expect(img.getAttribute("src")).toBe("blob:cid-img");

    const video1 = await waitFor(() => {
      const el = container.querySelector<HTMLVideoElement>("video.gallery-tile-thumb");
      if (!el) throw new Error("not resolved yet");
      return el;
    });
    expect(video1.getAttribute("src")).toBe("blob:cid-vid");
    expect(video1.hasAttribute("muted")).toBe(true);

    expect(container.querySelectorAll(".gallery-tile")).toHaveLength(2);
  });

  it("excludes deleted posts and non-image/video posts from the grid", () => {
    const deleted = makeItem({ id: "del", deleted: true });
    const textPost = makeItem({ id: "txt", kind: "text", mimeType: undefined, cid: "" });
    const filePost = makeItem({ id: "file", kind: "file", mimeType: "application/pdf", fileName: "doc.pdf" });
    const live = makeItem({ id: "live" });
    const { container } = render(
      <MediaGalleryView {...baseProps} items={[deleted, textPost, filePost, live]} />,
    );
    expect(container.querySelectorAll(".gallery-tile")).toHaveLength(1);
  });

  it("shows a delete button only on the local user's own tiles", () => {
    const own = makeItem({ id: "own", fromId: "u1" });
    const other = makeItem({ id: "other", fromId: "u2", cid: "cid-2" });
    const { container } = render(<MediaGalleryView {...baseProps} items={[own, other]} />);
    expect(container.querySelectorAll(".gallery-tile-delete")).toHaveLength(1);
  });

  it("confirms via an in-app dialog before calling onDelete", () => {
    const onDelete = vi.fn();
    const own = makeItem({ id: "own", fromId: "u1" });
    const { container, getByText } = render(
      <MediaGalleryView {...baseProps} items={[own]} onDelete={onDelete} />,
    );
    const deleteBtn = container.querySelector(".gallery-tile-delete") as HTMLButtonElement;
    fireEvent.click(deleteBtn);
    expect(onDelete).not.toHaveBeenCalled();
    expect(getByText("このメディアを削除しますか？")).toBeTruthy();
    fireEvent.click(getByText("削除する"));
    expect(onDelete).toHaveBeenCalledWith("own");
  });

  it("opens the shared Lightbox when a tile is clicked", async () => {
    const item = makeItem({ id: "img" });
    const { container, getByRole } = render(<MediaGalleryView {...baseProps} items={[item]} />);
    const tileBtn = container.querySelector(".gallery-tile-media") as HTMLButtonElement;
    fireEvent.click(tileBtn);
    const dialog = getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
  });

  it("toggles a reaction via the shared ReactionBar", () => {
    const onToggleReaction = vi.fn();
    const item = makeItem({ id: "img", reactions: [{ emoji: "👍", fromId: "u2", fromName: "U2" }] });
    const { getByText } = render(
      <MediaGalleryView {...baseProps} items={[item]} onToggleReaction={onToggleReaction} />,
    );
    fireEvent.click(getByText("👍").closest("button")!);
    expect(onToggleReaction).toHaveBeenCalledWith("img", "👍");
  });

  it("triggers onAddFiles when files are picked from the hidden file input", () => {
    const onAddFiles = vi.fn();
    const { container } = render(
      <MediaGalleryView {...baseProps} items={[]} onAddFiles={onAddFiles} />,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["x"], "photo.png", { type: "image/png" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    // preact/compat keeps type="file" inputs bound to the native "change" event
    // (unlike text inputs, which it remaps to "input") — but
    // @testing-library/preact's fireEvent.change unconditionally rewrites
    // "change" to "input" once compat is detected (as it is here, transitively,
    // via Lightbox's `createPortal` import), which would dispatch the wrong
    // event for a file input. Dispatch the real "change" event directly.
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onAddFiles).toHaveBeenCalledWith([file]);
  });
});
