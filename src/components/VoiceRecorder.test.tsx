import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { render, fireEvent, cleanup, waitFor } from "@testing-library/preact";
import { VoiceRecorder } from "./VoiceRecorder";

// happy-dom has no URL.createObjectURL/revokeObjectURL — stub them so the
// recorder's preview step (which creates a blob URL) doesn't throw.
beforeAll(() => {
  if (!URL.createObjectURL) {
    URL.createObjectURL = vi.fn(() => "blob:mock-voice") as unknown as typeof URL.createObjectURL;
  }
  if (!URL.revokeObjectURL) {
    URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL;
  }
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const noop = () => {};

describe("VoiceRecorder without MediaRecorder support", () => {
  it("renders nothing (mic button hidden) when MediaRecorder is unavailable", () => {
    // happy-dom doesn't implement MediaRecorder at all — this is the real
    // "unsupported browser" case the component guards against.
    expect(typeof MediaRecorder).toBe("undefined");
    const { container } = render(<VoiceRecorder disabled={false} onSend={noop} onActiveChange={noop} />);
    expect(container.innerHTML).toBe("");
  });
});

// happy-dom has no MediaRecorder, so the rest of the flow is exercised
// against a minimal fake that mimics the start()/stop()/ondataavailable/
// onstop contract the component relies on.
class FakeMediaRecorder {
  static isTypeSupported = vi.fn(() => true);
  state: "inactive" | "recording" = "inactive";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(_stream: MediaStream) {}
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["x"], { type: "audio/webm" }) });
    this.onstop?.();
  }
}

describe("VoiceRecorder recording flow (mocked MediaRecorder)", () => {
  let fakeTrackStop: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fakeTrackStop = vi.fn();
    const fakeStream = { getTracks: () => [{ stop: fakeTrackStop }] } as unknown as MediaStream;
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: vi.fn().mockResolvedValue(fakeStream) },
      configurable: true,
    });
  });

  it("clicking the mic starts recording and reports active state", async () => {
    const onActiveChange = vi.fn();
    const { getByLabelText, queryByLabelText } = render(
      <VoiceRecorder disabled={false} onSend={noop} onActiveChange={onActiveChange} />,
    );
    fireEvent.click(getByLabelText("音声メッセージを録音"));
    await waitFor(() => expect(getByLabelText("録音を停止")).toBeTruthy());
    expect(onActiveChange).toHaveBeenCalledWith(true);
    // The mic button itself is replaced by the recording row while active.
    expect(queryByLabelText("音声メッセージを録音")).toBeNull();
  });

  it("stop shows a send/cancel preview; send hands a File to onSend and releases the mic", async () => {
    const onSend = vi.fn();
    const { getByLabelText, getByText } = render(
      <VoiceRecorder disabled={false} onSend={onSend} onActiveChange={noop} />,
    );
    fireEvent.click(getByLabelText("音声メッセージを録音"));
    await waitFor(() => getByLabelText("録音を停止"));
    fireEvent.click(getByLabelText("録音を停止"));
    await waitFor(() => getByText("送信"));
    expect(fakeTrackStop).toHaveBeenCalled(); // mic released once recording stops

    fireEvent.click(getByText("送信"));
    expect(onSend).toHaveBeenCalledTimes(1);
    const file = onSend.mock.calls[0][0] as File;
    expect(file).toBeInstanceOf(File);
    expect(file.name).toMatch(/^voice-\d+\.webm$/);
    expect(file.type).toBe("audio/webm;codecs=opus");
  });

  it("cancelling mid-recording discards the clip and releases the mic without previewing", async () => {
    const onSend = vi.fn();
    const { getByLabelText, queryByText } = render(
      <VoiceRecorder disabled={false} onSend={onSend} onActiveChange={noop} />,
    );
    fireEvent.click(getByLabelText("音声メッセージを録音"));
    await waitFor(() => getByLabelText("録音を停止"));
    fireEvent.click(getByLabelText("録音をキャンセル"));
    expect(fakeTrackStop).toHaveBeenCalled();
    expect(queryByText("送信")).toBeNull();
    expect(onSend).not.toHaveBeenCalled();
    // Back to idle: the mic button reappears.
    expect(getByLabelText("音声メッセージを録音")).toBeTruthy();
  });

  it("cancelling the preview discards the clip without sending", async () => {
    const onSend = vi.fn();
    const { getByLabelText, getByText, queryByText } = render(
      <VoiceRecorder disabled={false} onSend={onSend} onActiveChange={noop} />,
    );
    fireEvent.click(getByLabelText("音声メッセージを録音"));
    await waitFor(() => getByLabelText("録音を停止"));
    fireEvent.click(getByLabelText("録音を停止"));
    await waitFor(() => getByText("キャンセル"));
    fireEvent.click(getByText("キャンセル"));
    expect(onSend).not.toHaveBeenCalled();
    expect(queryByText("送信")).toBeNull();
    expect(getByLabelText("音声メッセージを録音")).toBeTruthy();
  });
});

describe("VoiceRecorder mic permission denied", () => {
  it("shows an inline error when getUserMedia rejects", async () => {
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: vi.fn().mockRejectedValue(new Error("denied")) },
      configurable: true,
    });
    const { getByLabelText, getByText } = render(
      <VoiceRecorder disabled={false} onSend={noop} onActiveChange={noop} />,
    );
    fireEvent.click(getByLabelText("音声メッセージを録音"));
    await waitFor(() =>
      expect(
        getByText("マイクにアクセスできませんでした。ブラウザの設定でマイクの利用を許可してください。"),
      ).toBeTruthy(),
    );
  });
});
