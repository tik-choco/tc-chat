import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/preact";
import { MessageInput } from "./MessageInput";

// MessageInput reads tc-storage files on every render to decide whether to
// show the "pick from storage" button; stub it out so it stays empty/quiet.
vi.mock("../interop/tcStorageFiles", () => ({
  loadTcStorageFiles: () => [],
}));

afterEach(cleanup);

const noop = () => {};

function renderInput(overrides?: Partial<Parameters<typeof MessageInput>[0]>) {
  const onSendText = vi.fn();
  const utils = render(
    <MessageInput
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
