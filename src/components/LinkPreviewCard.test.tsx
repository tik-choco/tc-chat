import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/preact";
import { LinkPreviewCard } from "./LinkPreviewCard";
import { MessageBubble } from "./MessageBubble";
import type { ChatMessage } from "../lib/chatStore";

// Mock the sibling worker's lib module directly — LinkPreviewCard.tsx only
// needs its declared contract (fetchLinkPreview), so tests don't depend on
// the real implementation (network/CORS/DOM parsing) landing first.
const { fetchLinkPreview } = vi.hoisted(() => ({ fetchLinkPreview: vi.fn() }));
vi.mock("../lib/linkPreview", async () => {
  const actual = await vi.importActual<typeof import("../lib/linkPreview")>("../lib/linkPreview");
  return {
    ...actual,
    fetchLinkPreview,
  };
});

// MediaContent (used for non-text messages) touches mistClient/storage —
// irrelevant here, but MessageBubble imports it unconditionally.
vi.mock("../lib/mistClient", () => ({
  storage_get: vi.fn(async () => new Uint8Array()),
}));

afterEach(() => {
  cleanup();
  fetchLinkPreview.mockReset();
});

describe("LinkPreviewCard", () => {
  it("renders the rich layout once fetchLinkPreview resolves title/description", async () => {
    fetchLinkPreview.mockResolvedValue({
      url: "https://example.com/post",
      domain: "example.com",
      faviconUrl: "https://icons.duckduckgo.com/ip3/example.com.ico",
      title: "Example Post",
      description: "A description of the post.",
      imageUrl: "https://example.com/og.png",
    });
    const { getByText } = render(<LinkPreviewCard url="https://example.com/post" />);
    expect(await waitFor(() => getByText("Example Post"))).toBeTruthy();
    expect(getByText("A description of the post.")).toBeTruthy();
    expect(getByText("example.com")).toBeTruthy();
  });

  it("falls back to domain + raw URL when only the minimal preview is available", async () => {
    fetchLinkPreview.mockResolvedValue({
      url: "https://example.com/post",
      domain: "example.com",
      faviconUrl: "https://icons.duckduckgo.com/ip3/example.com.ico",
    });
    const { getByText } = render(<LinkPreviewCard url="https://example.com/post" />);
    expect(await waitFor(() => getByText("example.com"))).toBeTruthy();
    expect(getByText("https://example.com/post")).toBeTruthy();
  });

  it("anchor opens the URL in a new tab without leaking window.opener", async () => {
    fetchLinkPreview.mockResolvedValue({
      url: "https://example.com/post",
      domain: "example.com",
      faviconUrl: "https://icons.duckduckgo.com/ip3/example.com.ico",
    });
    const { container } = render(<LinkPreviewCard url="https://example.com/post" />);
    const anchor = await waitFor(() => {
      const el = container.querySelector("a.link-card");
      if (!el) throw new Error("not rendered yet");
      return el;
    });
    expect(anchor.getAttribute("href")).toBe("https://example.com/post");
    expect(anchor.getAttribute("target")).toBe("_blank");
    expect(anchor.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("renders nothing while the fetch is still pending", () => {
    fetchLinkPreview.mockReturnValue(new Promise(() => {})); // never resolves
    const { container } = render(<LinkPreviewCard url="https://example.com/post" />);
    expect(container.querySelector("a.link-card")).toBeNull();
  });
});

describe("MessageBubble text linkification", () => {
  const meDirectory = { me: { displayName: "Me", updatedAt: 1 } };
  const noop = () => {};

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

  it("renders a URL in message text as a clickable link and shows its preview card", async () => {
    fetchLinkPreview.mockResolvedValue({
      url: "https://example.com/post",
      domain: "example.com",
      faviconUrl: "https://icons.duckduckgo.com/ip3/example.com.ico",
    });
    const { container, getByText } = render(
      <MessageBubble
        message={msg({ text: "check this out https://example.com/post cool right" })}
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
    const link = container.querySelector<HTMLAnchorElement>("a.msg-link");
    expect(link).toBeTruthy();
    expect(link!.getAttribute("href")).toBe("https://example.com/post");
    expect(link!.getAttribute("target")).toBe("_blank");
    expect(getByText("check this out", { exact: false })).toBeTruthy();
    await waitFor(() => expect(container.querySelector("a.link-card")).toBeTruthy());
  });

  it("plain text without a URL renders no link and no preview card", () => {
    const { container, getByText } = render(
      <MessageBubble
        message={msg({ text: "just a normal message" })}
        isOwn={false}
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
    expect(getByText("just a normal message")).toBeTruthy();
    expect(container.querySelector("a.msg-link")).toBeNull();
    expect(container.querySelector("a.link-card")).toBeNull();
  });
});
