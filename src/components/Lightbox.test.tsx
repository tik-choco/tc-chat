import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup, waitFor } from "@testing-library/preact";
import { Lightbox, type LightboxItem } from "./Lightbox";
import { formatTime } from "../lib/util";

// The Lightbox resolves each item's cid to a blob URL via resolveStorageUrl.
vi.mock("../lib/mediaUrl", () => ({
  resolveStorageUrl: vi.fn(async (cid: string) => `blob:${cid}`),
}));

afterEach(cleanup);

function imageItems(n: number): LightboxItem[] {
  return Array.from({ length: n }, (_, i) => ({
    key: `k${i}`,
    kind: "image" as const,
    cid: `cid-${i}`,
    fileName: `pic${i}.png`,
    size: 10 + i,
  }));
}

const noop = () => {};

describe("Lightbox", () => {
  it("renders items[index] as an aria-modal dialog portaled under <body>", async () => {
    const items = imageItems(3);
    const { getByRole } = render(
      <Lightbox items={items} index={1} onIndexChange={noop} onClose={noop} />,
    );
    const dialog = getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    // Portaled directly to document.body, not the RTL render container.
    expect(document.body.contains(dialog)).toBe(true);

    const img = await waitFor(() => {
      const el = dialog.querySelector<HTMLImageElement>("img.lightbox-media");
      if (!el) throw new Error("not resolved yet");
      return el;
    });
    expect(img.getAttribute("src")).toBe("blob:cid-1");
  });

  it("◀ ▶ buttons and Arrow keys navigate with the right index", () => {
    const onIndexChange = vi.fn();
    const { getByLabelText } = render(
      <Lightbox items={imageItems(3)} index={1} onIndexChange={onIndexChange} onClose={noop} />,
    );
    fireEvent.click(getByLabelText("前へ"));
    expect(onIndexChange).toHaveBeenLastCalledWith(0);
    fireEvent.click(getByLabelText("次へ"));
    expect(onIndexChange).toHaveBeenLastCalledWith(2);

    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(onIndexChange).toHaveBeenLastCalledWith(0);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(onIndexChange).toHaveBeenLastCalledWith(2);
  });

  it("clamps at the start: prev is disabled and ArrowLeft is a no-op", () => {
    const onIndexChange = vi.fn();
    const { getByLabelText } = render(
      <Lightbox items={imageItems(3)} index={0} onIndexChange={onIndexChange} onClose={noop} />,
    );
    expect((getByLabelText("前へ") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(getByLabelText("前へ"));
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(onIndexChange).not.toHaveBeenCalled();
  });

  it("clamps at the end: next is disabled and ArrowRight is a no-op", () => {
    const onIndexChange = vi.fn();
    const { getByLabelText } = render(
      <Lightbox items={imageItems(3)} index={2} onIndexChange={onIndexChange} onClose={noop} />,
    );
    expect((getByLabelText("次へ") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(getByLabelText("次へ"));
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(onIndexChange).not.toHaveBeenCalled();
  });

  it("with a single item shows no nav controls or mode toggle", () => {
    const { queryByLabelText, queryByText } = render(
      <Lightbox items={imageItems(1)} index={0} onIndexChange={noop} onClose={noop} />,
    );
    expect(queryByLabelText("前へ")).toBeNull();
    expect(queryByLabelText("次へ")).toBeNull();
    expect(queryByText("1枚")).toBeNull();
    expect(queryByText("フロー")).toBeNull();
  });

  it("Single/Flow toggle switches the rendered structure", () => {
    const items = imageItems(3);
    const { getByText, getByRole } = render(
      <Lightbox items={items} index={0} onIndexChange={noop} onClose={noop} />,
    );
    const dialog = getByRole("dialog");
    // Single mode: no flow list, nav buttons present.
    expect(dialog.querySelector(".lightbox-flow-list")).toBeNull();
    expect(dialog.querySelector(".lightbox-nav")).toBeTruthy();

    fireEvent.click(getByText("フロー"));
    // Flow mode: one item per gallery entry, nav buttons gone.
    expect(dialog.querySelectorAll(".lightbox-flow-item")).toHaveLength(items.length);
    expect(dialog.querySelector(".lightbox-nav")).toBeNull();
  });

  it("closes on Escape, backdrop click, and the close button", () => {
    const onClose = vi.fn();
    const { getByRole, getByLabelText, unmount } = render(
      <Lightbox items={imageItems(2)} index={0} onIndexChange={noop} onClose={onClose} />,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(getByRole("dialog")); // empty backdrop
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.click(getByLabelText("閉じる"));
    expect(onClose).toHaveBeenCalledTimes(3);
    unmount();
  });

  it("does NOT close when the media element itself is clicked", async () => {
    const onClose = vi.fn();
    const { getByRole } = render(
      <Lightbox items={imageItems(2)} index={0} onIndexChange={noop} onClose={onClose} />,
    );
    const img = await waitFor(() => {
      const el = getByRole("dialog").querySelector("img.lightbox-media");
      if (!el) throw new Error("not resolved yet");
      return el;
    });
    fireEvent.click(img);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("locks body scroll while open and restores it on unmount", () => {
    const { unmount } = render(
      <Lightbox items={imageItems(1)} index={0} onIndexChange={noop} onClose={noop} />,
    );
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).not.toBe("hidden");
  });

  describe("bottom meta bar", () => {
    it("renders name/time/reactions for an item carrying meta", () => {
      const items = imageItems(1);
      const timestamp = new Date(2024, 0, 1, 9, 5).getTime();
      items[0] = {
        ...items[0],
        fromId: "u1",
        fromName: "Alice",
        timestamp,
        reactions: [{ emoji: "👍", fromId: "u2", fromName: "Bob" }],
      };
      const { getByRole } = render(
        <Lightbox
          items={items}
          index={0}
          onIndexChange={noop}
          onClose={noop}
          onToggleReaction={noop}
        />,
      );
      const dialog = getByRole("dialog");
      const bottom = dialog.querySelector(".lightbox-bottom");
      expect(bottom).toBeTruthy();
      expect(bottom!.textContent).toContain("Alice");
      expect(bottom!.textContent).toContain(formatTime(timestamp));
      expect(bottom!.querySelector(".reaction-chip")).toBeTruthy();
    });

    it("does not render for a meta-less item (the chat case)", () => {
      const { getByRole } = render(
        <Lightbox items={imageItems(1)} index={0} onIndexChange={noop} onClose={noop} />,
      );
      const dialog = getByRole("dialog");
      expect(dialog.querySelector(".lightbox-bottom")).toBeNull();
    });

    it("does not render when reactions/meta are absent even with onToggleReaction wired", () => {
      const { getByRole } = render(
        <Lightbox
          items={imageItems(1)}
          index={0}
          onIndexChange={noop}
          onClose={noop}
          onToggleReaction={noop}
        />,
      );
      const dialog = getByRole("dialog");
      expect(dialog.querySelector(".lightbox-bottom")).toBeNull();
    });

    it("calls onToggleReaction(key, emoji) when a palette emoji is picked", () => {
      const items = imageItems(1);
      items[0] = { ...items[0], reactions: [] };
      const onToggleReaction = vi.fn();
      const { getByRole, getByLabelText, getByText } = render(
        <Lightbox
          items={items}
          index={0}
          onIndexChange={noop}
          onClose={noop}
          onToggleReaction={onToggleReaction}
        />,
      );
      const dialog = getByRole("dialog");
      expect(dialog.querySelector(".lightbox-bottom")).toBeTruthy();
      fireEvent.click(getByLabelText("リアクションを追加"));
      fireEvent.click(getByText("👍"));
      expect(onToggleReaction).toHaveBeenCalledWith("k0", "👍");
    });
  });

  describe("delete", () => {
    it("shows the delete button only when canDelete && onDelete are both present", () => {
      const items = imageItems(1);
      items[0] = { ...items[0], canDelete: true };

      const { queryByLabelText: q1 } = render(
        <Lightbox items={items} index={0} onIndexChange={noop} onClose={noop} />,
      );
      expect(q1("削除")).toBeNull(); // canDelete but no onDelete handler

      cleanup();
      const plainItems = imageItems(1);
      const { queryByLabelText: q2 } = render(
        <Lightbox items={plainItems} index={0} onIndexChange={noop} onClose={noop} onDelete={noop} />,
      );
      expect(q2("削除")).toBeNull(); // onDelete but item isn't deletable

      cleanup();
      const { queryByLabelText: q3 } = render(
        <Lightbox items={items} index={0} onIndexChange={noop} onClose={noop} onDelete={noop} />,
      );
      expect(q3("削除")).toBeTruthy();
    });

    it("confirm flow calls onDelete with the item key", () => {
      const items = imageItems(1);
      items[0] = { ...items[0], canDelete: true };
      const onDelete = vi.fn();
      const { getByLabelText, getByRole, getByText } = render(
        <Lightbox items={items} index={0} onIndexChange={noop} onClose={noop} onDelete={onDelete} />,
      );
      fireEvent.click(getByLabelText("削除"));
      expect(getByRole("alertdialog")).toBeTruthy();
      fireEvent.click(getByText("削除する"));
      expect(onDelete).toHaveBeenCalledWith("k0");
    });

    it("Escape while the confirm dialog is open cancels the confirm, not the Lightbox", () => {
      const items = imageItems(1);
      items[0] = { ...items[0], canDelete: true };
      const onClose = vi.fn();
      const onDelete = vi.fn();
      const { getByLabelText, getByRole, queryByRole } = render(
        <Lightbox
          items={items}
          index={0}
          onIndexChange={noop}
          onClose={onClose}
          onDelete={onDelete}
        />,
      );
      fireEvent.click(getByLabelText("削除"));
      expect(getByRole("alertdialog")).toBeTruthy();

      fireEvent.keyDown(window, { key: "Escape" });
      expect(onClose).not.toHaveBeenCalled();
      expect(onDelete).not.toHaveBeenCalled();
      expect(queryByRole("alertdialog")).toBeNull();
    });
  });
});
