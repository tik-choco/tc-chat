import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, fireEvent, cleanup, waitFor } from "@testing-library/preact";
import { MessageBubble, groupPosAt } from "./MessageBubble";
import type { ChatMessage } from "../lib/chatStore";

// MediaContent resolves a post's CID to blob bytes via mistClient storage.
vi.mock("../lib/mistClient", () => ({
  storage_get: vi.fn(async () => new Uint8Array([1, 2, 3])),
}));

// happy-dom has no URL.createObjectURL — stub it so blob resolution succeeds.
beforeAll(() => {
  if (!URL.createObjectURL) {
    URL.createObjectURL = vi.fn(() => "blob:mock-url") as unknown as typeof URL.createObjectURL;
  }
});

afterEach(cleanup);

function msg(over: Partial<ChatMessage>): ChatMessage {
  return {
    id: "m",
    roomId: "r",
    surface: "chat",
    parentId: null,
    fromId: "did:key:zpeer",
    fromName: "Bob",
    timestamp: 1000,
    kind: "text",
    text: "hello",
    cid: "c",
    reactions: [],
    ...over,
  };
}

const noop = () => {};

describe("MessageBubble display modes", () => {
  const meDirectory = { me: { displayName: "Me", updatedAt: 1 } };

  it("list mode resolves the sender's name from the directory (falls back to signed name)", () => {
    const directory = { "did:key:zpeer": { displayName: "Bobby", updatedAt: 1 } };
    const { getByText } = render(
      <MessageBubble
        message={msg({})}
        isOwn={false}
        localId="me"
        display="list"
        directory={directory}
        onToggleReaction={noop}
        onEditMessage={noop}
        onDeleteMessage={noop}
        onOpenProfile={noop}
        onMaximize={noop}
      />,
    );
    expect(getByText("Bobby")).toBeTruthy(); // directory name wins over "Bob"
    expect(getByText("hello")).toBeTruthy();
  });

  it("list mode renders own messages with the directory display name (not '自分')", () => {
    const { getByText, queryByText } = render(
      <MessageBubble
        message={msg({ fromId: "me", fromName: "自分", text: "yo" })}
        isOwn
        localId="me"
        display="list"
        directory={meDirectory}
        onToggleReaction={noop}
        onEditMessage={noop}
        onDeleteMessage={noop}
        onOpenProfile={noop}
        onMaximize={noop}
      />,
    );
    expect(getByText("Me")).toBeTruthy();
    expect(queryByText("自分")).toBeNull();
    expect(getByText("yo")).toBeTruthy();
  });

  it("clicking a sender's name opens their profile (by DID + resolved name)", () => {
    const onOpenProfile = vi.fn();
    const directory = { "did:key:zpeer": { displayName: "Bobby", updatedAt: 1 } };
    const { getByText } = render(
      <MessageBubble
        message={msg({})}
        isOwn={false}
        localId="me"
        display="list"
        directory={directory}
        onToggleReaction={noop}
        onEditMessage={noop}
        onDeleteMessage={noop}
        onOpenProfile={onOpenProfile}
        onMaximize={noop}
      />,
    );
    fireEvent.click(getByText("Bobby"));
    expect(onOpenProfile).toHaveBeenCalledWith("did:key:zpeer", "Bobby");
  });

  it("bubble mode hides the name on own messages", () => {
    const { queryByText, getByText } = render(
      <MessageBubble
        message={msg({ fromId: "me", fromName: "自分", text: "mine" })}
        isOwn
        localId="me"
        display="bubble"
        directory={meDirectory}
        onToggleReaction={noop}
        onEditMessage={noop}
        onDeleteMessage={noop}
        onOpenProfile={noop}
        onMaximize={noop}
      />,
    );
    // Own bubble shows no name label.
    expect(queryByText("Me")).toBeNull();
    expect(queryByText("自分")).toBeNull();
    expect(getByText("mine")).toBeTruthy();
  });
});

describe("MessageBubble grouping (bubble mode)", () => {
  const meDirectory = { me: { displayName: "Me", updatedAt: 1 } };
  const directory = { "did:key:zpeer": { displayName: "Bobby", updatedAt: 1 } };

  it('groupPos="middle": no sender name, no avatar button, avatar-gap spacer present', () => {
    const { queryByText, queryByLabelText, container } = render(
      <MessageBubble
        message={msg({})}
        isOwn={false}
        localId="me"
        display="bubble"
        directory={directory}
        groupPos="middle"
        onToggleReaction={noop}
        onEditMessage={noop}
        onDeleteMessage={noop}
        onOpenProfile={noop}
        onMaximize={noop}
      />,
    );
    expect(queryByText("Bobby")).toBeNull();
    expect(queryByLabelText("Bobby のプロフィールを表示")).toBeNull();
    expect(container.querySelector(".avatar-btn")).toBeNull();
    expect(container.querySelector(".bubble-avatar-gap")).toBeTruthy();
  });

  it('groupPos="last": no sender name, no avatar button, avatar-gap spacer present', () => {
    const { queryByText, container } = render(
      <MessageBubble
        message={msg({})}
        isOwn={false}
        localId="me"
        display="bubble"
        directory={directory}
        groupPos="last"
        onToggleReaction={noop}
        onEditMessage={noop}
        onDeleteMessage={noop}
        onOpenProfile={noop}
        onMaximize={noop}
      />,
    );
    expect(queryByText("Bobby")).toBeNull();
    expect(container.querySelector(".avatar-btn")).toBeNull();
    expect(container.querySelector(".bubble-avatar-gap")).toBeTruthy();
  });

  it('groupPos="first": sender name and avatar button are shown, no spacer', () => {
    const { getByText, getByLabelText, container } = render(
      <MessageBubble
        message={msg({})}
        isOwn={false}
        localId="me"
        display="bubble"
        directory={directory}
        groupPos="first"
        onToggleReaction={noop}
        onEditMessage={noop}
        onDeleteMessage={noop}
        onOpenProfile={noop}
        onMaximize={noop}
      />,
    );
    expect(getByText("Bobby")).toBeTruthy();
    expect(getByLabelText("Bobby のプロフィールを表示")).toBeTruthy();
    expect(container.querySelector(".avatar-btn")).toBeTruthy();
    expect(container.querySelector(".bubble-avatar-gap")).toBeNull();
  });

  it('groupPos omitted defaults to "single": sender name and avatar button are shown, no spacer', () => {
    const { getByText, container } = render(
      <MessageBubble
        message={msg({})}
        isOwn={false}
        localId="me"
        display="bubble"
        directory={directory}
        onToggleReaction={noop}
        onEditMessage={noop}
        onDeleteMessage={noop}
        onOpenProfile={noop}
        onMaximize={noop}
      />,
    );
    expect(getByText("Bobby")).toBeTruthy();
    expect(container.querySelector(".avatar-btn")).toBeTruthy();
    expect(container.querySelector(".bubble-avatar-gap")).toBeNull();
  });

  it("bubble row root carries the bubble-row--<groupPos> class", () => {
    const { container } = render(
      <MessageBubble
        message={msg({})}
        isOwn={false}
        localId="me"
        display="bubble"
        directory={directory}
        groupPos="middle"
        onToggleReaction={noop}
        onEditMessage={noop}
        onDeleteMessage={noop}
        onOpenProfile={noop}
        onMaximize={noop}
      />,
    );
    const row = container.querySelector(".bubble-row");
    expect(row).toBeTruthy();
    expect(row!.classList.contains("bubble-row--middle")).toBe(true);
  });

  it('bubble row root carries "bubble-row--first" for groupPos="first"', () => {
    const { container } = render(
      <MessageBubble
        message={msg({})}
        isOwn={false}
        localId="me"
        display="bubble"
        directory={directory}
        groupPos="first"
        onToggleReaction={noop}
        onEditMessage={noop}
        onDeleteMessage={noop}
        onOpenProfile={noop}
        onMaximize={noop}
      />,
    );
    const row = container.querySelector(".bubble-row");
    expect(row!.classList.contains("bubble-row--first")).toBe(true);
  });

  it("timestamp/verified live in .bubble-meta beside the bubble, not inside .bubble", () => {
    const { container } = render(
      <MessageBubble
        message={msg({ fromId: "me" })}
        isOwn
        localId="me"
        display="bubble"
        directory={meDirectory}
        groupPos="single"
        onToggleReaction={noop}
        onEditMessage={noop}
        onDeleteMessage={noop}
        onOpenProfile={noop}
        onMaximize={noop}
      />,
    );
    expect(container.querySelector(".bubble .bubble-time")).toBeNull();
    expect(container.querySelector(".bubble-meta .bubble-time")).toBeTruthy();
    expect(container.querySelector(".bubble .bubble-verified")).toBeNull();
    expect(container.querySelector(".bubble-meta .bubble-verified")).toBeTruthy();
  });
});

describe("MessageBubble edit/delete", () => {
  const meDirectory = { me: { displayName: "Me", updatedAt: 1 } };

  it("renders a deleted message as a muted placeholder with no actions or reactions", () => {
    const { getByText, queryByLabelText, container } = render(
      <MessageBubble
        message={msg({ fromId: "me", deleted: true, text: undefined })}
        isOwn
        localId="me"
        display="list"
        directory={meDirectory}
        onToggleReaction={noop}
        onEditMessage={noop}
        onDeleteMessage={noop}
        onOpenProfile={noop}
        onMaximize={noop}
      />,
    );
    expect(getByText("このメッセージは削除されました")).toBeTruthy();
    expect(queryByLabelText("削除")).toBeNull();
    expect(container.querySelector(".reaction-bar")).toBeNull();
  });

  it("shows edit/delete only on own messages, edit only for text kind", () => {
    const other = render(
      <MessageBubble
        message={msg({})}
        isOwn={false}
        localId="me"
        display="list"
        directory={meDirectory}
        onToggleReaction={noop}
        onEditMessage={noop}
        onDeleteMessage={noop}
        onOpenProfile={noop}
        onMaximize={noop}
      />,
    );
    expect(other.queryByLabelText("編集")).toBeNull();
    expect(other.queryByLabelText("削除")).toBeNull();
    cleanup();

    const ownMedia = render(
      <MessageBubble
        message={msg({ fromId: "me", kind: "media", mimeType: "image/png", text: undefined })}
        isOwn
        localId="me"
        display="list"
        directory={meDirectory}
        onToggleReaction={noop}
        onEditMessage={noop}
        onDeleteMessage={noop}
        onOpenProfile={noop}
        onMaximize={noop}
      />,
    );
    // Media can be deleted but not edited.
    expect(ownMedia.queryByLabelText("編集")).toBeNull();
    expect(ownMedia.getByLabelText("削除")).toBeTruthy();
  });

  it("edit opens a prefilled field; Enter saves via onEditMessage", () => {
    const onEditMessage = vi.fn();
    const { getByLabelText, container } = render(
      <MessageBubble
        message={msg({ fromId: "me", text: "before" })}
        isOwn
        localId="me"
        display="list"
        directory={meDirectory}
        onToggleReaction={noop}
        onEditMessage={onEditMessage}
        onDeleteMessage={noop}
        onOpenProfile={noop}
        onMaximize={noop}
      />,
    );
    fireEvent.click(getByLabelText("編集"));
    const input = container.querySelector<HTMLTextAreaElement>(".msg-edit-input")!;
    expect(input.value).toBe("before");
    fireEvent.input(input, { target: { value: "after" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onEditMessage).toHaveBeenCalledWith("m", "after");
  });

  it("delete opens an in-app confirm dialog; confirming calls onDeleteMessage", () => {
    const onDeleteMessage = vi.fn();
    const { getByLabelText, getByText, queryByText } = render(
      <MessageBubble
        message={msg({ fromId: "me" })}
        isOwn
        localId="me"
        display="list"
        directory={meDirectory}
        onToggleReaction={noop}
        onEditMessage={noop}
        onDeleteMessage={onDeleteMessage}
        onOpenProfile={noop}
        onMaximize={noop}
      />,
    );
    fireEvent.click(getByLabelText("削除"));
    // A modal appears — nothing deleted yet.
    expect(getByText("メッセージを削除")).toBeTruthy();
    expect(onDeleteMessage).not.toHaveBeenCalled();
    fireEvent.click(getByText("削除する"));
    expect(onDeleteMessage).toHaveBeenCalledWith("m");
    // Dialog closes after confirming.
    expect(queryByText("メッセージを削除")).toBeNull();
  });

  it("cancelling the confirm dialog does not delete", () => {
    const onDeleteMessage = vi.fn();
    const { getByLabelText, getByText, queryByText } = render(
      <MessageBubble
        message={msg({ fromId: "me" })}
        isOwn
        localId="me"
        display="list"
        directory={meDirectory}
        onToggleReaction={noop}
        onEditMessage={noop}
        onDeleteMessage={onDeleteMessage}
        onOpenProfile={noop}
        onMaximize={noop}
      />,
    );
    fireEvent.click(getByLabelText("削除"));
    fireEvent.click(getByText("キャンセル"));
    expect(onDeleteMessage).not.toHaveBeenCalled();
    expect(queryByText("メッセージを削除")).toBeNull();
  });

  it("Shift+click deletes immediately, skipping the confirm dialog", () => {
    const onDeleteMessage = vi.fn();
    const { getByLabelText, queryByText } = render(
      <MessageBubble
        message={msg({ fromId: "me" })}
        isOwn
        localId="me"
        display="list"
        directory={meDirectory}
        onToggleReaction={noop}
        onEditMessage={noop}
        onDeleteMessage={onDeleteMessage}
        onOpenProfile={noop}
        onMaximize={noop}
      />,
    );
    fireEvent.click(getByLabelText("削除"), { shiftKey: true });
    expect(onDeleteMessage).toHaveBeenCalledWith("m");
    // No dialog was shown.
    expect(queryByText("メッセージを削除")).toBeNull();
  });

  it("shows the (編集済み) marker when editedAt is set", () => {
    const { getByText } = render(
      <MessageBubble
        message={msg({ editedAt: 2000 })}
        isOwn={false}
        localId="me"
        display="list"
        directory={meDirectory}
        onToggleReaction={noop}
        onEditMessage={noop}
        onDeleteMessage={noop}
        onOpenProfile={noop}
        onMaximize={noop}
      />,
    );
    expect(getByText("(編集済み)")).toBeTruthy();
  });
});

describe("MessageBubble media lightbox", () => {
  const meDirectory = { me: { displayName: "Me", updatedAt: 1 } };

  function imageMsg(): ChatMessage {
    return msg({
      id: "img1",
      kind: "media",
      mimeType: "image/png",
      fileName: "shot.png",
      cid: "cid-img",
      text: undefined,
    });
  }

  it("clicking an image asks to maximize it (by message id) — the gallery lives in ChatWindow", async () => {
    const onMaximize = vi.fn();
    const { getByLabelText } = render(
      <MessageBubble
        message={imageMsg()}
        isOwn={false}
        localId="me"
        display="list"
        directory={meDirectory}
        onToggleReaction={noop}
        onEditMessage={noop}
        onDeleteMessage={noop}
        onOpenProfile={noop}
        onMaximize={onMaximize}
      />,
    );

    // The thumbnail resolves asynchronously; wait for the zoom button.
    const zoom = await waitFor(() => getByLabelText("shot.png を全画面表示"));
    fireEvent.click(zoom);
    expect(onMaximize).toHaveBeenCalledWith("img1");
  });
});

describe("groupPosAt", () => {
  // Convenience: build a stream where each entry is (sender, timestamp, deleted?).
  function stream(...rows: Array<[string, number, boolean?]>): ChatMessage[] {
    return rows.map(([fromId, timestamp, deleted], i) =>
      msg({ id: `m${i}`, fromId, timestamp, ...(deleted ? { deleted: true } : {}) }),
    );
  }

  it("marks a lone message as single", () => {
    expect(groupPosAt(stream(["a", 0]), 0)).toBe("single");
  });

  it("splits a same-sender run into first / middle / last", () => {
    const ms = stream(["a", 0], ["a", 1000], ["a", 2000]);
    expect(groupPosAt(ms, 0)).toBe("first");
    expect(groupPosAt(ms, 1)).toBe("middle");
    expect(groupPosAt(ms, 2)).toBe("last");
  });

  it("a different sender breaks the run", () => {
    const ms = stream(["a", 0], ["b", 1000], ["a", 2000]);
    expect(groupPosAt(ms, 0)).toBe("single");
    expect(groupPosAt(ms, 1)).toBe("single");
    expect(groupPosAt(ms, 2)).toBe("single");
  });

  it("messages more than 5 minutes apart do not group", () => {
    const ms = stream(["a", 0], ["a", 5 * 60_000], ["a", 5 * 60_000 + 300_001]);
    // First pair is exactly at the window edge (inclusive) — still groups.
    expect(groupPosAt(ms, 0)).toBe("first");
    expect(groupPosAt(ms, 1)).toBe("last");
    // Second gap exceeds the window — new group.
    expect(groupPosAt(ms, 2)).toBe("single");
  });

  it("a deleted tombstone breaks the run on both sides", () => {
    const ms = stream(["a", 0], ["a", 1000, true], ["a", 2000]);
    expect(groupPosAt(ms, 0)).toBe("single");
    expect(groupPosAt(ms, 1)).toBe("single");
    expect(groupPosAt(ms, 2)).toBe("single");
  });
});
