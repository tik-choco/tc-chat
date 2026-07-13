import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/preact";
import { ProjectCard } from "./ProjectCard";
import type { BoardNode } from "../lib/chatStore";
import type { NodeTree } from "../lib/boardTree";

afterEach(() => {
  cleanup();
});

function makeEntry(over: Partial<BoardNode> & Pick<BoardNode, "id">, replyCount = 0): NodeTree {
  const node: BoardNode = {
    roomId: "room",
    surface: "board",
    parentId: null,
    fromId: "u1",
    fromName: "U1",
    timestamp: 1,
    kind: "project",
    cid: "cid",
    title: "Need an artist",
    text: "Looking for a 3D artist to join our VRChat world project.",
    roles: ["artist"],
    tags: ["3d"],
    reactions: [],
    ...over,
  };
  return { node, children: [], replyCount };
}

describe("ProjectCard", () => {
  it("renders the title, excerpt, and role/tag chips", () => {
    const { getByText } = render(
      <ProjectCard
        entry={makeEntry({ id: "root" })}
        localId="u1"
        onOpen={() => {}}
        onToggleReaction={() => {}}
      />,
    );
    expect(getByText("Need an artist")).toBeTruthy();
    expect(getByText("Looking for a 3D artist to join our VRChat world project.")).toBeTruthy();
    expect(getByText("artist")).toBeTruthy();
    expect(getByText("3d")).toBeTruthy();
  });

  it("shows the join count without a capacity when the post has none", () => {
    const entry = makeEntry({
      id: "root",
      capacity: undefined,
      reactions: [
        { emoji: "🙋", fromId: "u2", fromName: "U2" },
        { emoji: "🙋", fromId: "u3", fromName: "U3" },
      ],
    });
    const { getByText } = render(
      <ProjectCard entry={entry} localId="u1" onOpen={() => {}} onToggleReaction={() => {}} />,
    );
    expect(getByText(/参加希望 2人/)).toBeTruthy();
  });

  it("shows the join count against capacity when the post has one", () => {
    const entry = makeEntry({
      id: "root",
      capacity: 5,
      reactions: [{ emoji: "🙋", fromId: "u2", fromName: "U2" }],
    });
    const { getByText } = render(
      <ProjectCard entry={entry} localId="u1" onOpen={() => {}} onToggleReaction={() => {}} />,
    );
    expect(getByText(/参加希望 1\/5人/)).toBeTruthy();
  });

  it("marks the join button active when the local user already joined", () => {
    const entry = makeEntry({
      id: "root",
      reactions: [{ emoji: "🙋", fromId: "u1", fromName: "U1" }],
    });
    const { getByText } = render(
      <ProjectCard entry={entry} localId="u1" onOpen={() => {}} onToggleReaction={() => {}} />,
    );
    const btn = getByText(/参加希望/).closest("button")!;
    expect(btn.className).toContain("project-card-join--mine");
  });

  it("toggles the 🙋 reaction on join-button click without opening the card", () => {
    const onToggleReaction = vi.fn();
    const onOpen = vi.fn();
    const entry = makeEntry({ id: "root" });
    const { getByText } = render(
      <ProjectCard entry={entry} localId="u1" onOpen={onOpen} onToggleReaction={onToggleReaction} />,
    );
    fireEvent.click(getByText(/参加希望/).closest("button")!);
    expect(onToggleReaction).toHaveBeenCalledWith("root", "🙋");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("toggles the ❤️ reaction on heart-button click, showing its count, without opening the card", () => {
    const onToggleReaction = vi.fn();
    const onOpen = vi.fn();
    const entry = makeEntry({
      id: "root",
      reactions: [{ emoji: "❤️", fromId: "u2", fromName: "U2" }],
    });
    const { getByText } = render(
      <ProjectCard entry={entry} localId="u1" onOpen={onOpen} onToggleReaction={onToggleReaction} />,
    );
    const heartBtn = getByText("❤️ 1");
    fireEvent.click(heartBtn);
    expect(onToggleReaction).toHaveBeenCalledWith("root", "❤️");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("shows the reply count", () => {
    const entry = makeEntry({ id: "root" }, 3);
    const { getByText } = render(
      <ProjectCard entry={entry} localId="u1" onOpen={() => {}} onToggleReaction={() => {}} />,
    );
    expect(getByText("💬 3")).toBeTruthy();
  });

  it("opens the thread when the card body is clicked", () => {
    const onOpen = vi.fn();
    const entry = makeEntry({ id: "root" });
    const { getByText } = render(
      <ProjectCard entry={entry} localId="u1" onOpen={onOpen} onToggleReaction={() => {}} />,
    );
    fireEvent.click(getByText("Need an artist"));
    expect(onOpen).toHaveBeenCalledWith("root");
  });

  it("shows a 募集 badge on project cards and a 話題 badge on text cards", () => {
    const project = render(
      <ProjectCard
        entry={makeEntry({ id: "p" })}
        localId="u1"
        onOpen={() => {}}
        onToggleReaction={() => {}}
      />,
    );
    expect(project.getByText("募集")).toBeTruthy();
    project.unmount();

    const topic = render(
      <ProjectCard
        entry={makeEntry({ id: "t", kind: "text", roles: undefined, tags: undefined })}
        localId="u1"
        onOpen={() => {}}
        onToggleReaction={() => {}}
      />,
    );
    expect(topic.getByText("話題")).toBeTruthy();
  });

  it("hides the 🙋 join toggle on text (topic) cards", () => {
    const { queryByText, getByText } = render(
      <ProjectCard
        entry={makeEntry({ id: "t", kind: "text", roles: undefined, tags: undefined })}
        localId="u1"
        onOpen={() => {}}
        onToggleReaction={() => {}}
      />,
    );
    expect(queryByText(/参加希望/)).toBeNull();
    // Heart + reply count still render.
    expect(getByText(/❤️/)).toBeTruthy();
  });

  it("renders a deleted root as a tombstone card that still opens its thread", () => {
    const onOpen = vi.fn();
    const entry = makeEntry(
      { id: "root", deleted: true, title: undefined, text: undefined },
      2,
    );
    const { getByText, queryByText } = render(
      <ProjectCard entry={entry} localId="u1" onOpen={onOpen} onToggleReaction={() => {}} />,
    );
    expect(getByText("この投稿は削除されました")).toBeTruthy();
    expect(getByText("💬 2")).toBeTruthy();
    expect(queryByText(/参加希望/)).toBeNull();
    fireEvent.click(getByText("この投稿は削除されました"));
    expect(onOpen).toHaveBeenCalledWith("root");
  });
});
