import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/preact";
import { useVideoCall } from "./useVideoCall";

const registerLocalTrack = vi.fn();
const unpublishLocalTrack = vi.fn();
const removeLocalTrack = vi.fn();
const sendMessage = vi.fn();
let mediaListener: ((eventType: number, payload: unknown) => void) | null = null;
let eventListener:
  | ((eventType: number, fromId: string, payload: unknown, roomId: string) => void)
  | null = null;

vi.mock("../lib/mistClient", () => ({
  getNode: vi.fn(async () => ({
    registerLocalTrack,
    unpublishLocalTrack,
    removeLocalTrack,
    sendMessage,
  })),
  localNodeId: () => "self-node",
  subscribeMediaEvent: vi.fn((listener: (eventType: number, payload: unknown) => void) => {
    mediaListener = listener;
    return () => {
      mediaListener = null;
    };
  }),
  subscribeEvent: vi.fn(
    (
      listener: (eventType: number, fromId: string, payload: unknown, roomId: string) => void,
    ) => {
      eventListener = listener;
      return () => {
        eventListener = null;
      };
    },
  ),
  isRawEvent: (eventType: number) => eventType === 1,
  decodeRawPayload: (payload: unknown) => payload,
  MEDIA_EVENT_TRACK_ADDED: 100,
  MEDIA_EVENT_TRACK_REMOVED: 101,
  EVENT_PEER_DISCONNECTED: 2,
  DELIVERY_RELIABLE: 0,
}));

function makeTrack(id = "track-1", kind = "video") {
  const listeners: Record<string, () => void> = {};
  return {
    id,
    kind,
    stop: vi.fn(),
    addEventListener: vi.fn((event: string, handler: () => void) => {
      listeners[event] = handler;
    }),
    fireEnded: () => listeners["ended"]?.(),
  };
}

describe("useVideoCall", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mediaListener = null;
    eventListener = null;
  });

  it("starts the camera: getUserMedia video-only, track published under the tc-chat-cam prefix", async () => {
    const track = makeTrack();
    const stream = { getVideoTracks: () => [track], getTracks: () => [track] };
    const getUserMedia = vi.fn(async () => stream);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });

    const { result } = renderHook(() => useVideoCall("room-1"));
    await act(async () => {
      await result.current.start();
    });

    expect(getUserMedia).toHaveBeenCalledWith({ video: true, audio: false });
    expect(registerLocalTrack).toHaveBeenCalledWith(
      expect.stringMatching(/^tc-chat-cam:/),
      track,
      { publish: true, enabled: true },
    );
    expect(result.current.on).toBe(true);
    expect(result.current.localStream).toBe(stream);
  });

  it("stops the camera: unpublish + track.stop() + a room-scoped stopped wire", async () => {
    const track = makeTrack();
    const stream = { getVideoTracks: () => [track], getTracks: () => [track] };
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn(async () => stream) } });

    const { result } = renderHook(() => useVideoCall("room-1"));
    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      result.current.stop();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(unpublishLocalTrack).toHaveBeenCalled();
    expect(removeLocalTrack).toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalled();
    expect(result.current.on).toBe(false);
    expect(result.current.localStream).toBeNull();
    expect(sendMessage).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ type: "tc-chat:camera-stopped" }),
      0,
      "room-1",
    );
  });

  it("adds a remote camera track on TRACK_ADDED and removes it on TRACK_REMOVED", async () => {
    const { result } = renderHook(() => useVideoCall("room-1"));

    await act(async () => {
      mediaListener?.(100, {
        fromId: "peer-1",
        trackId: "tc-chat-cam:remote-1",
        kind: "video",
        track: makeTrack("remote-1"),
        stream: { id: "s1" },
      });
    });
    expect(result.current.remoteTracks).toHaveLength(1);
    expect(result.current.remoteTracks[0].trackId).toBe("tc-chat-cam:remote-1");

    await act(async () => {
      mediaListener?.(101, {
        fromId: "peer-1",
        trackId: "tc-chat-cam:remote-1",
        kind: "video",
        track: { id: "remote-1" },
      });
    });
    expect(result.current.remoteTracks).toHaveLength(0);
  });

  it("ignores our own camera track looped back by the mesh", async () => {
    const { result } = renderHook(() => useVideoCall("room-1"));
    await act(async () => {
      mediaListener?.(100, {
        fromId: "self-node",
        trackId: "tc-chat-cam:mine-1",
        kind: "video",
        track: makeTrack("mine-1"),
        stream: { id: "s-self" },
      });
    });
    expect(result.current.remoteTracks).toHaveLength(0);
  });

  it("ignores screen-share tracks (tc-chat-screen prefix) -- those belong to useScreenShare", async () => {
    const { result } = renderHook(() => useVideoCall("room-1"));
    await act(async () => {
      mediaListener?.(100, {
        fromId: "peer-1",
        trackId: "tc-chat-screen:not-a-camera",
        kind: "video",
        track: makeTrack("not-a-camera"),
        stream: { id: "s1" },
      });
    });
    expect(result.current.remoteTracks).toHaveLength(0);
  });

  it("keeps one tile per sender: a re-start replaces the sender's previous track", async () => {
    const { result } = renderHook(() => useVideoCall("room-1"));
    await act(async () => {
      mediaListener?.(100, {
        fromId: "peer-1",
        trackId: "tc-chat-cam:cam-a",
        kind: "video",
        track: makeTrack("cam-a"),
        stream: { id: "sa" },
      });
      mediaListener?.(100, {
        fromId: "peer-1",
        trackId: "tc-chat-cam:cam-b",
        kind: "video",
        track: makeTrack("cam-b"),
        stream: { id: "sb" },
      });
    });
    expect(result.current.remoteTracks).toHaveLength(1);
    expect(result.current.remoteTracks[0].trackId).toBe("tc-chat-cam:cam-b");
  });

  it("drops a sender's tile on the camera-stopped wire", async () => {
    const { result } = renderHook(() => useVideoCall("room-1"));
    await act(async () => {
      mediaListener?.(100, {
        fromId: "peer-1",
        trackId: "tc-chat-cam:cam-a",
        kind: "video",
        track: makeTrack("cam-a"),
        stream: { id: "sa" },
      });
    });
    expect(result.current.remoteTracks).toHaveLength(1);

    await act(async () => {
      eventListener?.(1, "peer-1", { type: "tc-chat:camera-stopped" }, "room-1");
    });
    expect(result.current.remoteTracks).toHaveLength(0);
  });

  it("drops a sender's tile on EVENT_PEER_DISCONNECTED", async () => {
    const { result } = renderHook(() => useVideoCall("room-1"));
    await act(async () => {
      mediaListener?.(100, {
        fromId: "peer-1",
        trackId: "tc-chat-cam:cam-a",
        kind: "video",
        track: makeTrack("cam-a"),
        stream: { id: "sa" },
      });
    });
    expect(result.current.remoteTracks).toHaveLength(1);

    await act(async () => {
      eventListener?.(2, "peer-1", null, "room-1");
    });
    expect(result.current.remoteTracks).toHaveLength(0);
  });
});
