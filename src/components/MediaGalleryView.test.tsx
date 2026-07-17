import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, fireEvent, cleanup, waitFor } from "@testing-library/preact";
import { MediaGalleryView } from "./MediaGalleryView";
import type { PostNode } from "../lib/chatStore";

// The gallery resolves each tile's cid to a blob URL via resolveStorageUrl
// (same module the Lightbox itself uses), so this mock covers both.
vi.mock("../lib/mediaUrl", () => ({
  resolveStorageUrl: vi.fn(async (cid: string) => `blob:${cid}`),
  invalidateStorageUrl: vi.fn(),
}));

import { resolveStorageUrl, invalidateStorageUrl } from "../lib/mediaUrl";
const resolveStorageUrlMock = vi.mocked(resolveStorageUrl);
const invalidateStorageUrlMock = vi.mocked(invalidateStorageUrl);

beforeEach(() => {
  resolveStorageUrlMock.mockReset();
  resolveStorageUrlMock.mockImplementation(async (cid: string) => `blob:${cid}`);
  invalidateStorageUrlMock.mockReset();
});

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

  it("shows a passive reaction summary pill as the resting-state display", () => {
    const item = makeItem({
      id: "img",
      reactions: [
        { emoji: "👍", fromId: "u2", fromName: "U2" },
        { emoji: "👍", fromId: "u3", fromName: "U3" },
        { emoji: "❤️", fromId: "u4", fromName: "U4" },
      ],
    });
    const { container } = render(<MediaGalleryView {...baseProps} items={[item]} />);
    const badge = container.querySelector(".gallery-tile-reactions");
    expect(badge?.textContent).toBe("👍❤️ 3");
  });

  it("does not render a reaction badge when there are no reactions", () => {
    const item = makeItem({ id: "img", reactions: [] });
    const { container } = render(<MediaGalleryView {...baseProps} items={[item]} />);
    expect(container.querySelector(".gallery-tile-reactions")).toBeNull();
  });

  it("renders a hover-revealed ReactionBar as a sibling of the media button, wired to onToggleReaction", () => {
    const onToggleReaction = vi.fn();
    const item = makeItem({
      id: "img",
      reactions: [{ emoji: "👍", fromId: "u2", fromName: "U2" }],
    });
    const { container, getByText } = render(
      <MediaGalleryView {...baseProps} items={[item]} onToggleReaction={onToggleReaction} />,
    );
    const reactWrap = container.querySelector(".gallery-tile-react");
    expect(reactWrap).toBeTruthy();
    // Interactive — not nested inside the media <button> (invalid HTML) —
    // and not inert like the passive pill.
    expect(reactWrap?.querySelector(".reaction-bar")).toBeTruthy();
    expect(container.querySelector(".gallery-tile-media .reaction-bar")).toBeNull();

    fireEvent.click(getByText("👍").closest("button")!);
    expect(onToggleReaction).toHaveBeenCalledWith("img", "👍");
  });

  it("renders an always-visible play badge on video tiles but not image tiles", () => {
    const image = makeItem({ id: "img", mimeType: "image/png" });
    const video = makeItem({ id: "vid", mimeType: "video/mp4", cid: "cid-vid" });
    const { container } = render(<MediaGalleryView {...baseProps} items={[image, video]} />);
    expect(container.querySelectorAll(".gallery-tile-badge")).toHaveLength(1);
  });

  it("shows the resolved poster name and time in the hover overlay", () => {
    const directory = {
      u1: { displayName: "Directory Name", updatedAt: 1 },
    };
    const item = makeItem({ id: "img", fromId: "u1", fromName: "Fallback Name" });
    const { container } = render(
      <MediaGalleryView {...baseProps} directory={directory} items={[item]} />,
    );
    const overlay = container.querySelector(".gallery-tile-overlay");
    expect(overlay?.textContent).toContain("Directory Name");
    expect(overlay?.textContent).not.toContain("Fallback Name");
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

  describe("encrypted media resolve / failure / retry", () => {
    it("passes the post's enc envelope through to resolveStorageUrl for decryption", async () => {
      const enc = { v: 1 as const, alg: "A256GCM" as const, key: "k" };
      const item = makeItem({ id: "img", cid: "cid-enc", enc });
      render(<MediaGalleryView {...baseProps} items={[item]} />);
      await waitFor(() => expect(resolveStorageUrlMock).toHaveBeenCalledWith("cid-enc", enc));
    });

    it("shows a distinct unavailable state (not the loading placeholder) when the fetch fails", async () => {
      resolveStorageUrlMock.mockRejectedValueOnce(new Error("author offline"));
      const item = makeItem({ id: "img" });
      const { container, getByText } = render(<MediaGalleryView {...baseProps} items={[item]} />);
      await waitFor(() =>
        expect(getByText("コンテンツを利用できません（投稿者がオフラインの可能性があります）")).toBeTruthy(),
      );
      expect(container.querySelector("img.gallery-tile-thumb")).toBeNull();
      expect(container.querySelector(".gallery-tile-placeholder--error")).toBeTruthy();
    });

    it("clicking a failed tile retries instead of opening the Lightbox", async () => {
      resolveStorageUrlMock.mockRejectedValueOnce(new Error("author offline"));
      const item = makeItem({ id: "img" });
      const { container, queryByRole, getByText } = render(
        <MediaGalleryView {...baseProps} items={[item]} />,
      );
      await waitFor(() => getByText("コンテンツを利用できません（投稿者がオフラインの可能性があります）"));

      const tileBtn = container.querySelector(".gallery-tile-media") as HTMLButtonElement;
      fireEvent.click(tileBtn);

      expect(invalidateStorageUrlMock).toHaveBeenCalledWith("cid-1");
      expect(queryByRole("dialog")).toBeNull(); // did not open the Lightbox

      const img = await waitFor(() => {
        const el = container.querySelector<HTMLImageElement>("img.gallery-tile-thumb");
        if (!el) throw new Error("not resolved yet");
        return el;
      });
      expect(img.getAttribute("src")).toBe("blob:cid-1");
    });
  });
});
