import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/preact";
import { useChatRoom } from "./useChatRoom";

const mock = vi.hoisted(() => {
  let releaseInit!: () => void;
  return {
    init: new Promise<void>(resolve => { releaseInit = resolve; }),
    releaseInit: () => releaseInit(),
    joined: new Set<string>(),
    join: vi.fn(),
    initStarted: vi.fn(),
  };
});
vi.mock("../vendor/mistlib/wrappers/web/index.js", () => ({
  MistNode: class {
    async init() { mock.initStarted(); await mock.init; }
    onEvent() {}
    onMediaEvent() {}
    isRoomJoined(room: string) { return mock.joined.has(room); }
    async joinRoomAsync(room: string) { mock.join(room); mock.joined.add(room); }
    leaveRoom(room: string) { mock.joined.delete(room); }
  },
  EVENT_RAW: 0,
}));
vi.mock("../lib/mistBuildInfo", () => ({ captureMistBuildInfo() {}, markMistLoadError() {} }));
vi.mock("./usePresence", () => ({ usePresence: () => [] }));
vi.mock("./usePostStream", () => ({ usePostStream: () => ({ nodes: [] }) }));
vi.mock("./useTyping", () => ({ useTyping: () => ({ typingNames: [] }) }));
afterEach(cleanup);

it("switching during node initialization cancels the unopened room", async () => {
  const { result, rerender } = renderHook(({ room }) => useChatRoom(room, "Alice"), {
    initialProps: { room: "cancelled-room" },
  });
  await waitFor(() => expect(mock.initStarted).toHaveBeenCalledOnce());
  await act(async () => { rerender({ room: "new-room" }); });
  expect(mock.join).not.toHaveBeenCalled();
  await act(async () => { mock.releaseInit(); });
  await waitFor(() => expect(result.current.status).toBe("joined"));
  expect(mock.joined.has("cancelled-room")).toBe(false);
  expect(mock.joined.has("new-room")).toBe(true);
  expect(mock.join).toHaveBeenCalledExactlyOnceWith("new-room");
});
