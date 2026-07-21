import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/preact";
import { useHistorySync } from "./useHistorySync";
import { appendWireLog } from "../lib/chatStore";
import { GLOBAL_ROOM_ID } from "../lib/util";

const sendMessage = vi.fn();
let eventListener: ((eventType: number, fromId: string, payload: unknown) => void) | null = null;

vi.mock("../lib/mistClient", () => ({
  getNode: vi.fn(async () => ({ sendMessage })),
  subscribeEvent: vi.fn((listener: (eventType: number, fromId: string, payload: unknown) => void) => {
    eventListener = listener;
    return () => {
      eventListener = null;
    };
  }),
  isRawEvent: vi.fn((eventType: number) => eventType === 0),
  decodeRawPayload: vi.fn((payload: unknown) => payload),
  localNodeId: vi.fn(() => "self"),
  DELIVERY_RELIABLE: 1,
}));

describe("useHistorySync", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    eventListener = null;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("broadcasts a history-request shortly after joining", async () => {
    renderHook(() => useHistorySync("r1"));
    await vi.runAllTimersAsync();

    const req = sendMessage.mock.calls.find(
      ([, msg]) => (msg as { type?: string })?.type === "tc-chat:history-request",
    );
    expect(req).toBeTruthy();
    expect(req![0]).toBeNull(); // broadcast
    expect((req![1] as { roomId: string }).roomId).toBe("r1");
  });

  it("replays the signed wire log to a requesting peer", async () => {
    appendWireLog("r1", { id: "w1", type: "tc-chat:message", cid: "c1" });
    appendWireLog("r1", { id: "w2", type: "tc-chat:node", cid: "c2" });

    renderHook(() => useHistorySync("r1"));
    eventListener?.(0, "peer-x", { type: "tc-chat:history-request", id: "q1", roomId: "r1" });
    await vi.runAllTimersAsync();

    const replayed = sendMessage.mock.calls.filter(([to]) => to === "peer-x");
    expect(replayed.map(([, msg]) => (msg as { id: string }).id)).toEqual(["w1", "w2"]);
  });

  it("ignores its own request echo (fromId is the local node id)", async () => {
    appendWireLog("r1", { id: "w1", type: "tc-chat:message" });
    renderHook(() => useHistorySync("r1"));
    eventListener?.(0, "self", { type: "tc-chat:history-request", id: "q", roomId: "r1" });
    await vi.runAllTimersAsync();

    expect(sendMessage.mock.calls.some(([to]) => to === "self")).toBe(false);
  });

  it("does not replay history for a different room", async () => {
    appendWireLog("r1", { id: "w1", type: "tc-chat:message" });
    renderHook(() => useHistorySync("r1"));
    eventListener?.(0, "peer-x", { type: "tc-chat:history-request", id: "q", roomId: "OTHER" });
    await vi.runAllTimersAsync();

    expect(sendMessage.mock.calls.some(([to]) => to === "peer-x")).toBe(false);
  });

  it("never requests or answers history for the ephemeral global room", async () => {
    appendWireLog(GLOBAL_ROOM_ID, { id: "w1", type: "tc-chat:message" });
    renderHook(() => useHistorySync(GLOBAL_ROOM_ID));
    eventListener?.(0, "peer-x", {
      type: "tc-chat:history-request",
      id: "q",
      roomId: GLOBAL_ROOM_ID,
    });
    await vi.runAllTimersAsync();

    expect(sendMessage).not.toHaveBeenCalled();
  });
});
