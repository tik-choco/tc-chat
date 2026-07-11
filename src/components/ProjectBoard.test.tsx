import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup, waitFor } from "@testing-library/preact";
import { ProjectBoard } from "./ProjectBoard";
import type { BoardNode } from "../lib/chatStore";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function makeNode(over: Partial<BoardNode> & Pick<BoardNode, "id">): BoardNode {
  return {
    roomId: "room",
    surface: "board",
    parentId: null,
    fromId: "u1",
    fromName: "U1",
    timestamp: 1,
    kind: "text",
    cid: "cid",
    text: "body",
    reactions: [],
    ...over,
  };
}

describe("ProjectBoard (recursive rendering)", () => {
  const root = makeNode({
    id: "root",
    kind: "project",
    title: "Need an artist",
    text: "looking for a 3D artist",
    roles: ["artist"],
    tags: ["3d"],
    reactions: [{ emoji: "👍", fromId: "u2", fromName: "U2" }],
    timestamp: 10,
  });
  const child = makeNode({
    id: "child",
    parentId: "root",
    text: "I can help!",
    fromName: "U2",
    fromId: "u2",
    timestamp: 20,
  });
  const grandchild = makeNode({
    id: "grandchild",
    parentId: "child",
    text: "great, DM me",
    timestamp: 30,
  });
  const nodes = [root, child, grandchild];

  it("renders a nested thread: project title, comment, and deep reply all show", () => {
    const { getByText } = render(
      <ProjectBoard
        roomName="room"
        localNodeId="u1"
        nodes={nodes}
        ready
        directory={{}}
        onCreate={() => {}}
        onToggleReaction={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(getByText("Need an artist")).toBeTruthy();
    expect(getByText("I can help!")).toBeTruthy();
    expect(getByText("great, DM me")).toBeTruthy();
    // 2 descendants under the root.
    expect(getByText("▾ 2件の返信")).toBeTruthy();
    // Recruitment chips.
    expect(getByText("artist")).toBeTruthy();
    expect(getByText("3d")).toBeTruthy();
  });

  it("shows a reaction chip with its count and toggles it on click", () => {
    const onToggleReaction = vi.fn();
    const { getByText } = render(
      <ProjectBoard
        roomName="room"
        localNodeId="u1"
        nodes={nodes}
        ready
        directory={{}}
        onCreate={() => {}}
        onToggleReaction={onToggleReaction}
        onEdit={() => {}}
        onDelete={() => {}}
      />,
    );
    // Reaction chip renders emoji + count; clicking the count's chip toggles.
    fireEvent.click(getByText("👍").closest("button")!);
    expect(onToggleReaction).toHaveBeenCalledWith("root", "👍");
  });

  it("filters to 話題 hides the project root", () => {
    const { getByText, queryByText } = render(
      <ProjectBoard
        roomName="room"
        localNodeId="u1"
        nodes={nodes}
        ready
        directory={{}}
        onCreate={() => {}}
        onToggleReaction={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />,
    );
    fireEvent.click(getByText("話題"));
    expect(queryByText("Need an artist")).toBeNull();
  });

  it("shows delete only on own nodes and confirms via an in-app dialog", () => {
    const onDelete = vi.fn();
    const { getAllByText, getByText } = render(
      <ProjectBoard
        roomName="room"
        localNodeId="u1"
        nodes={nodes}
        ready
        directory={{}}
        onCreate={() => {}}
        onToggleReaction={() => {}}
        onEdit={() => {}}
        onDelete={onDelete}
      />,
    );
    // Only the two u1-authored nodes (root + grandchild) offer delete.
    const deleteButtons = getAllByText("🗑 削除");
    expect(deleteButtons).toHaveLength(2);
    fireEvent.click(deleteButtons[0]);
    // A modal appears — nothing deleted until confirmed.
    expect(getByText("投稿を削除")).toBeTruthy();
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(getByText("削除する"));
    expect(onDelete).toHaveBeenCalledWith("root");
  });

  it("Shift+click deletes a node immediately, skipping the dialog", () => {
    const onDelete = vi.fn();
    const { getAllByText, queryByText } = render(
      <ProjectBoard
        roomName="room"
        localNodeId="u1"
        nodes={nodes}
        ready
        directory={{}}
        onCreate={() => {}}
        onToggleReaction={() => {}}
        onEdit={() => {}}
        onDelete={onDelete}
      />,
    );
    fireEvent.click(getAllByText("🗑 削除")[0], { shiftKey: true });
    expect(onDelete).toHaveBeenCalledWith("root");
    expect(queryByText("投稿を削除")).toBeNull();
  });

  it("renders a tombstone for a deleted node but keeps its replies", () => {
    const deletedRoot = { ...root, deleted: true, text: undefined, title: undefined };
    const { getByText, queryByText } = render(
      <ProjectBoard
        roomName="room"
        localNodeId="u1"
        nodes={[deletedRoot, child, grandchild]}
        ready
        directory={{}}
        onCreate={() => {}}
        onToggleReaction={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(getByText("この投稿は削除されました")).toBeTruthy();
    expect(queryByText("Need an artist")).toBeNull();
    // The thread beneath the tombstone survives.
    expect(getByText("I can help!")).toBeTruthy();
    expect(getByText("great, DM me")).toBeTruthy();
  });

  it("opens a reply composer under a node", () => {
    const { getAllByText, getByPlaceholderText } = render(
      <ProjectBoard
        roomName="room"
        localNodeId="u1"
        nodes={nodes}
        ready
        directory={{}}
        onCreate={() => {}}
        onToggleReaction={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />,
    );
    fireEvent.click(getAllByText("💬 返信")[0]);
    expect(getByPlaceholderText("返信を書く…")).toBeTruthy();
  });
});

// tc-note article import chip: publishes a "note-article" shared-bus record
// (the same shape tc-note's publishShared("note-article", ...) writes) via
// raw localStorage, then exercises the chip ProjectBoard renders on top of
// useNoteArticleImport. Uses the inline-text fallback shape (cid: "") so the
// test never needs to stub mistlib's storage_get.
function publishNoteArticle(over: { title?: string; text?: string; updatedAt?: string } = {}) {
  const record = {
    cid: "",
    meta: {
      title: over.title ?? "Meeting notes",
      format: "markdown",
      excerpt: "First 200 chars…",
      publishedAt: "2026-07-09T00:00:00.000Z",
      text: over.text ?? "# Meeting notes\n\nFull markdown body.",
    },
    updatedAt: over.updatedAt ?? "2026-07-09T00:00:00.000Z",
    from: "tc-note",
  };
  localStorage.setItem("tc-shared-note-article-v1", JSON.stringify(record));
}

describe("ProjectBoard (tc-note article import chip)", () => {
  const baseProps = {
    roomName: "room",
    localNodeId: "u1",
    nodes: [] as BoardNode[],
    ready: true,
    directory: {},
    onCreate: () => {},
    onToggleReaction: () => {},
    onEdit: () => {},
    onDelete: () => {},
  };

  it("renders nothing when there is no shared note-article record", () => {
    const { queryByText } = render(<ProjectBoard {...baseProps} />);
    expect(queryByText(/tc-note/)).toBeNull();
  });

  it("shows a chip with the note's title when a record is published", () => {
    publishNoteArticle({ title: "Sprint plan" });
    const { getByText } = render(<ProjectBoard {...baseProps} />);
    expect(getByText(/Sprint plan/)).toBeTruthy();
  });

  it("clicking the chip prefills the composer with the article's title and body, and hides the chip", async () => {
    publishNoteArticle({ title: "Sprint plan", text: "# Sprint plan\n\nDetails here." });
    const { getByText, getByDisplayValue, getByPlaceholderText, queryByText } = render(
      <ProjectBoard {...baseProps} />,
    );
    fireEvent.click(getByText(/Sprint plan/));

    await waitFor(() => expect(getByDisplayValue("Sprint plan")).toBeTruthy());
    expect(getByPlaceholderText("内容を書く…")).toHaveProperty("value", "# Sprint plan\n\nDetails here.");
    // The chip is gone once imported — importing also consumes it.
    expect(queryByText("tc-noteの記事を取り込む: Sprint plan")).toBeNull();
  });

  it("dismissing the chip hides it without opening the composer", () => {
    publishNoteArticle({ title: "Sprint plan" });
    const { getByLabelText, queryByText, queryByPlaceholderText } = render(<ProjectBoard {...baseProps} />);
    fireEvent.click(getByLabelText("取り込みを見送る"));
    expect(queryByText(/Sprint plan/)).toBeNull();
    expect(queryByPlaceholderText("内容を書く…")).toBeNull();
  });

  it("consumed state persists: the chip stays hidden after a re-render with the same record", () => {
    publishNoteArticle({ title: "Sprint plan" });
    const first = render(<ProjectBoard {...baseProps} />);
    fireEvent.click(first.getByLabelText("取り込みを見送る"));
    first.unmount();

    const second = render(<ProjectBoard {...baseProps} />);
    expect(second.queryByText(/Sprint plan/)).toBeNull();
  });
});
