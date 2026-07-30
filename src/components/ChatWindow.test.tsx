import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/preact";
import { ChatWindow, needsDateDivider, dateDividerLabel } from "./ChatWindow";
import type { ChatMessage, ChatDisplay } from "../lib/chatStore";
import { GLOBAL_ROOM_ID } from "../lib/util";
import { translate, SOURCE_LOCALE, type TFunc } from "../lib/i18n";
import type { useVoiceChat } from "../hooks/useVoiceChat";
import type { useScreenShare } from "../hooks/useScreenShare";
import type { useVideoCall } from "../hooks/useVideoCall";

// ChatWindow's voice/screenShare/videoCall props are plain hook *results*
// (ReturnType<typeof useVoiceChat> etc.), not the hooks themselves — so a
// render test only needs object literals matching those shapes, never the
// real hooks (which touch mistlib/getUserMedia). CallControls/CallDock are
// skipped entirely by using GLOBAL_ROOM_ID (see ChatWindow's own
// `roomId !== GLOBAL_ROOM_ID` guards), which keeps this fixture small.

afterEach(cleanup);

// useT() falls back to the source (ja) locale with no <LocaleProvider>, same
// as every other component test in this file's sibling MessageBubble.test.tsx
// — this mirrors that fallback for the pure-function assertions below.
const t: TFunc = (key, params) => translate(SOURCE_LOCALE, key, params);

const noop = () => {};

function msg(over: Partial<ChatMessage>): ChatMessage {
  return {
    id: "m1",
    roomId: GLOBAL_ROOM_ID,
    surface: "chat",
    parentId: null,
    fromId: "did:key:zpeer",
    fromName: "Bob",
    timestamp: 1_700_000_000_000,
    kind: "text",
    text: "hello",
    cid: "c",
    reactions: [],
    ...over,
  };
}

// Typed against the real hook return types (rather than inferred from these
// literals) so a future change to any of the three hooks' shapes fails the
// typecheck here instead of drifting silently. Several of their methods are
// async, so the no-ops have to return a promise, not void.
const asyncNoop = async () => {};

const noopVoice: ReturnType<typeof useVoiceChat> = {
  joined: false,
  muted: false,
  remoteTracks: [],
  join: asyncNoop,
  leave: noop,
  toggleMute: asyncNoop,
};
const noopScreenShare: ReturnType<typeof useScreenShare> = {
  sharing: false,
  error: null,
  audioMissing: false,
  remoteTracks: [],
  start: asyncNoop,
  stop: noop,
};
const noopVideoCall: ReturnType<typeof useVideoCall> = {
  on: false,
  error: null,
  localStream: null,
  remoteTracks: [],
  start: asyncNoop,
  stop: noop,
};

function baseProps(overrides: Partial<Parameters<typeof ChatWindow>[0]> = {}) {
  return {
    roomId: GLOBAL_ROOM_ID,
    roomName: "Global",
    isDm: false,
    localNodeId: "me",
    messages: [] as ChatMessage[],
    ready: true,
    chatDisplay: "list" as ChatDisplay,
    directory: {},
    peers: [],
    selfName: "Me",
    typingNames: [],
    onTyping: noop,
    onSendText: vi.fn(),
    onSendFile: noop,
    onSendStoredFile: noop,
    onToggleReaction: noop,
    onEditMessage: noop,
    onDeleteMessage: noop,
    onOpenProfile: noop,
    onEditSelfRoomName: noop,
    voice: noopVoice,
    screenShare: noopScreenShare,
    videoCall: noopVideoCall,
    ...overrides,
  };
}

describe("ChatWindow reply bar", () => {
  it("opens with the quoted author + snippet when a message's reply action is clicked, and clears on cancel", () => {
    const { getByLabelText, getByText, queryByText, container } = render(
      <ChatWindow {...baseProps({ messages: [msg({ id: "m1", text: "let's meet at noon" })] })} />,
    );
    fireEvent.click(getByLabelText("返信"));
    expect(getByText("Bob に返信")).toBeTruthy();
    expect(container.querySelector(".reply-bar-snippet")?.textContent).toBe("let's meet at noon");

    fireEvent.click(getByLabelText("返信をキャンセル"));
    expect(queryByText("Bob に返信")).toBeNull();
    expect(container.querySelector(".reply-bar")).toBeNull();
  });

  it("passes the reply target's id through to onSendText, then clears the reply bar", () => {
    const onSendText = vi.fn();
    const { getByLabelText, getByPlaceholderText, getByText, queryByText } = render(
      <ChatWindow {...baseProps({ onSendText, messages: [msg({ id: "m1" })] })} />,
    );
    fireEvent.click(getByLabelText("返信"));
    expect(getByText("Bob に返信")).toBeTruthy();

    const textarea = getByPlaceholderText("メッセージを入力");
    fireEvent.input(textarea, { target: { value: "sounds good" } });
    fireEvent.click(getByText("送信"));

    expect(onSendText).toHaveBeenCalledWith("sounds good", "m1");
    // Sending closes the loop — the next message starts fresh, not still "replying".
    expect(queryByText("Bob に返信")).toBeNull();
  });

  it("sending with no active reply passes undefined as the parent id (existing behavior preserved)", () => {
    const onSendText = vi.fn();
    const { getByPlaceholderText, getByText } = render(
      <ChatWindow {...baseProps({ onSendText, messages: [] })} />,
    );
    const textarea = getByPlaceholderText("メッセージを入力");
    fireEvent.input(textarea, { target: { value: "hi there" } });
    fireEvent.click(getByText("送信"));
    expect(onSendText).toHaveBeenCalledWith("hi there", null);
  });

  it("clicking a reply's quoted header jumps to (and flashes) the original message", () => {
    const parent = msg({ id: "orig1", text: "original text" });
    const reply = msg({ id: "reply1", parentId: "orig1", text: "reply text", timestamp: parent.timestamp + 1000 });
    const { getByLabelText, container } = render(
      <ChatWindow {...baseProps({ messages: [parent, reply] })} />,
    );
    // Not flashed yet.
    expect(container.querySelector('[data-message-id="orig1"]')?.classList.contains("msg-row--flash")).toBe(
      false,
    );
    fireEvent.click(getByLabelText("元のメッセージにジャンプ"));
    expect(container.querySelector('[data-message-id="orig1"]')?.classList.contains("msg-row--flash")).toBe(
      true,
    );
  });
});

describe("ChatWindow date separators", () => {
  it("inserts a divider before the first message and across a day boundary, but not within the same day", () => {
    const day1Morning = new Date(2024, 0, 1, 9, 0, 0).getTime();
    const day1Evening = new Date(2024, 0, 1, 20, 0, 0).getTime();
    const day2Morning = new Date(2024, 0, 2, 8, 0, 0).getTime();
    const messages = [
      msg({ id: "m1", timestamp: day1Morning }),
      msg({ id: "m2", timestamp: day1Evening }),
      msg({ id: "m3", timestamp: day2Morning }),
    ];
    const { container } = render(<ChatWindow {...baseProps({ messages })} />);
    // One before the whole list, one at the day1 -> day2 boundary; none
    // between the two same-day messages.
    expect(container.querySelectorAll(".date-divider").length).toBe(2);
  });

  it("needsDateDivider: always before the first message, then only across a local calendar-day change", () => {
    const day1a = new Date(2024, 5, 10, 1, 0, 0).getTime();
    const day1b = new Date(2024, 5, 10, 23, 59, 0).getTime();
    const day2 = new Date(2024, 5, 11, 0, 1, 0).getTime();
    const messages = [msg({ id: "a", timestamp: day1a }), msg({ id: "b", timestamp: day1b }), msg({ id: "c", timestamp: day2 })];
    expect(needsDateDivider(messages, 0)).toBe(true);
    expect(needsDateDivider(messages, 1)).toBe(false);
    expect(needsDateDivider(messages, 2)).toBe(true);
  });

  it("dateDividerLabel: today/yesterday get dedicated labels; older falls back to toLocaleDateString", () => {
    const now = Date.now();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const twoDaysAgo = new Date(now);
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

    expect(dateDividerLabel(now, t)).toBe("今日");
    expect(dateDividerLabel(yesterday.getTime(), t)).toBe("昨日");
    expect(dateDividerLabel(twoDaysAgo.getTime(), t)).toBe(new Date(twoDaysAgo.getTime()).toLocaleDateString());
  });
});
