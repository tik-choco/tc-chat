import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/preact";
import { MessageInput } from "./MessageInput";
import { loadDraft, saveDraft } from "../lib/draftStore";

// MessageInput reads tc-storage files on every render to decide whether to
// show the "pick from storage" button; stub it out so it stays empty/quiet.
vi.mock("../interop/tcStorageFiles", () => ({
  loadTcStorageFiles: () => [],
}));

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const noop = () => {};

function renderInput(overrides?: Partial<Parameters<typeof MessageInput>[0]>) {
  const onSendText = vi.fn();
  const utils = render(
    <MessageInput
      roomId="room1"
      disabled={false}
      onSendText={onSendText}
      onSendFile={noop}
      onSendStoredFile={noop}
      {...overrides}
    />,
  );
  const textarea = utils.container.querySelector<HTMLTextAreaElement>(".text-input")!;
  return { ...utils, onSendText, textarea };
}

describe("MessageInput", () => {
  it("Enter sends the trimmed text and clears the field", () => {
    const { textarea, onSendText } = renderInput();
    fireEvent.input(textarea, { target: { value: "  hello world  " } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSendText).toHaveBeenCalledWith("hello world");
    expect(textarea.value).toBe("");
  });

  it("Shift+Enter does not send and keeps the newline as more text is typed", () => {
    const { textarea, onSendText } = renderInput();
    fireEvent.input(textarea, { target: { value: "line1" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(onSendText).not.toHaveBeenCalled();
    // Simulate the browser inserting the newline + further typing.
    fireEvent.input(textarea, { target: { value: "line1\nline2" } });
    expect(textarea.value).toBe("line1\nline2");
    expect(onSendText).not.toHaveBeenCalled();
  });

  it("Enter while IME-composing (isComposing) does not send", () => {
    const { textarea, onSendText } = renderInput();
    fireEvent.input(textarea, { target: { value: "日本語" } });
    fireEvent.keyDown(textarea, { key: "Enter", isComposing: true });
    expect(onSendText).not.toHaveBeenCalled();
    expect(textarea.value).toBe("日本語");
  });

  it("Enter with keyCode 229 (IME composition fallback) does not send", () => {
    const { textarea, onSendText } = renderInput();
    fireEvent.input(textarea, { target: { value: "こんにちは" } });
    fireEvent.keyDown(textarea, { key: "Enter", keyCode: 229 });
    expect(onSendText).not.toHaveBeenCalled();
  });

  it("whitespace-only text is not sent", () => {
    const { textarea, onSendText } = renderInput();
    fireEvent.input(textarea, { target: { value: "   " } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSendText).not.toHaveBeenCalled();
  });

  it("multi-line text is sent with the interior newline preserved", () => {
    const { textarea, onSendText } = renderInput();
    fireEvent.input(textarea, { target: { value: "line1\nline2" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSendText).toHaveBeenCalledWith("line1\nline2");
  });
});

describe("MessageInput drafts", () => {
  it("loads a previously saved draft into the input on mount", () => {
    saveDraft("room1", "half-typed message");
    const { textarea } = renderInput();
    expect(textarea.value).toBe("half-typed message");
  });

  it("persists typed text to the draft store once the debounce elapses", () => {
    vi.useFakeTimers();
    const { textarea } = renderInput();
    fireEvent.input(textarea, { target: { value: "typing..." } });
    // Not yet — the write is debounced, not immediate.
    expect(loadDraft("room1")).toBe("");
    vi.advanceTimersByTime(500);
    expect(loadDraft("room1")).toBe("typing...");
  });

  it("clears the draft after a successful send", () => {
    vi.useFakeTimers();
    const { textarea, onSendText } = renderInput();
    fireEvent.input(textarea, { target: { value: "hello" } });
    vi.advanceTimersByTime(500);
    expect(loadDraft("room1")).toBe("hello");

    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(onSendText).toHaveBeenCalledWith("hello");
    expect(loadDraft("room1")).toBe("");
  });

  it("flushes an unsaved (still-debounced) draft on unmount", () => {
    vi.useFakeTimers();
    const { textarea, unmount } = renderInput();
    fireEvent.input(textarea, { target: { value: "not yet flushed" } });
    // Unmount before the debounce timer would have fired on its own.
    unmount();
    expect(loadDraft("room1")).toBe("not yet flushed");
  });

  it("switching roomId flushes the outgoing room's draft and loads the incoming one", () => {
    vi.useFakeTimers();
    saveDraft("room2", "room2's saved draft");
    const { textarea, rerender } = renderInput({ roomId: "room1" });

    fireEvent.input(textarea, { target: { value: "room1 in progress" } });
    // Switch rooms before the debounce for room1 would have fired.
    rerender(
      <MessageInput
        roomId="room2"
        disabled={false}
        onSendText={noop}
        onSendFile={noop}
        onSendStoredFile={noop}
      />,
    );

    // The room1 draft must have been flushed, not dropped, on the way out.
    expect(loadDraft("room1")).toBe("room1 in progress");
    expect(textarea.value).toBe("room2's saved draft");
  });
});
