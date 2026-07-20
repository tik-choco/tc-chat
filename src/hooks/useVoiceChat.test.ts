import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/preact";
import { useVoiceChat } from "./useVoiceChat";

const registerLocalTrack = vi.fn();
const unpublishLocalTrack = vi.fn();
const removeLocalTrack = vi.fn();
const setLocalTrackEnabled = vi.fn();
let mediaListener: ((eventType: number, payload: unknown) => void) | null = null;

vi.mock("../lib/mistClient", () => ({
  getNode: vi.fn(async () => ({
    registerLocalTrack,
    unpublishLocalTrack,
    removeLocalTrack,
    setLocalTrackEnabled,
  })),
  localNodeId: () => "self-node",
  subscribeMediaEvent: vi.fn((listener: (eventType: number, payload: unknown) => void) => {
    mediaListener = listener;
    return () => {
      mediaListener = null;
    };
  }),
  MEDIA_EVENT_TRACK_ADDED: 100,
  MEDIA_EVENT_TRACK_REMOVED: 101,
}));

function makeTrack(id = "track-1", kind = "audio") {
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

describe("useVoiceChat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mediaListener = null;
  });

  it("joins: getUserMedia audio-only, track published under the tc-chat-mic prefix", async () => {
    const track = makeTrack();
    const stream = { getAudioTracks: () => [track], getTracks: () => [track] };
    const getUserMedia = vi.fn(async () => stream);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });

    const { result } = renderHook(() => useVoiceChat("room-1"));
    await act(async () => {
      await result.current.join();
    });

    expect(getUserMedia).toHaveBeenCalledWith({ audio: true, video: false });
    expect(registerLocalTrack).toHaveBeenCalledWith(
      expect.stringContaining("track-1"),
      track,
      { publish: true, enabled: true },
    );
    expect(result.current.joined).toBe(true);
    expect(result.current.muted).toBe(false);
  });

  it("leaves: unpublish + track.stop() called", async () => {
    const track = makeTrack();
    const stream = { getAudioTracks: () => [track], getTracks: () => [track] };
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn(async () => stream) } });

    const { result } = renderHook(() => useVoiceChat("room-1"));
    await act(async () => {
      await result.current.join();
    });
    await act(async () => {
      result.current.leave();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(unpublishLocalTrack).toHaveBeenCalled();
    expect(removeLocalTrack).toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalled();
    expect(result.current.joined).toBe(false);
  });

  it("toggleMute flips muted and disables the local track", async () => {
    const track = makeTrack();
    const stream = { getAudioTracks: () => [track], getTracks: () => [track] };
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn(async () => stream) } });

    const { result } = renderHook(() => useVoiceChat("room-1"));
    await act(async () => {
      await result.current.join();
    });
    await act(async () => {
      await result.current.toggleMute();
    });

    expect(setLocalTrackEnabled).toHaveBeenCalledWith(expect.stringContaining("track-1"), false);
    expect(result.current.muted).toBe(true);
  });

  it("adds a remote audio track on TRACK_ADDED and removes it on TRACK_REMOVED", async () => {
    const { result } = renderHook(() => useVoiceChat("room-1"));

    await act(async () => {
      mediaListener?.(100, {
        fromId: "peer-1",
        trackId: "remote-1",
        kind: "audio",
        track: makeTrack("remote-1"),
        stream: { id: "s1" },
      });
    });
    expect(result.current.remoteTracks).toHaveLength(1);
    expect(result.current.remoteTracks[0].trackId).toBe("remote-1");

    await act(async () => {
      mediaListener?.(101, {
        fromId: "peer-1",
        trackId: "remote-1",
        kind: "audio",
        track: { id: "remote-1" },
      });
    });
    expect(result.current.remoteTracks).toHaveLength(0);
  });

  it("ignores our own mic looped back by the mesh", async () => {
    const { result } = renderHook(() => useVoiceChat("room-1"));
    await act(async () => {
      mediaListener?.(100, {
        fromId: "self-node",
        trackId: "mine-1",
        kind: "audio",
        track: makeTrack("mine-1"),
        stream: { id: "s-self" },
      });
    });
    expect(result.current.remoteTracks).toHaveLength(0);
  });

  it("blocks a second join() while the first getUserMedia call is still pending", async () => {
    const track = makeTrack();
    const stream = { getAudioTracks: () => [track], getTracks: () => [track] };
    let resolveMedia: (s: typeof stream) => void;
    const mediaPromise = new Promise<typeof stream>((resolve) => {
      resolveMedia = resolve;
    });
    const getUserMedia = vi.fn(() => mediaPromise);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });

    const { result } = renderHook(() => useVoiceChat("room-1"));
    let firstDone: Promise<void>;
    await act(async () => {
      firstDone = result.current.join();
      // Second call issued while the first's media promise is still unresolved.
      await result.current.join();
    });

    expect(getUserMedia).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveMedia(stream);
      await firstDone;
    });

    expect(registerLocalTrack).toHaveBeenCalledTimes(1);
    expect(result.current.joined).toBe(true);
  });

  it("discards the capture if leave() runs while getUserMedia is still pending", async () => {
    const track = makeTrack();
    const stream = { getAudioTracks: () => [track], getTracks: () => [track] };
    let resolveMedia: (s: typeof stream) => void;
    const mediaPromise = new Promise<typeof stream>((resolve) => {
      resolveMedia = resolve;
    });
    const getUserMedia = vi.fn(() => mediaPromise);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });

    const { result } = renderHook(() => useVoiceChat("room-1"));
    let joinDone: Promise<void>;
    await act(async () => {
      joinDone = result.current.join();
      // Let the getNode() await ahead of getUserMedia settle first, so the
      // pending await when leave() runs below is genuinely getUserMedia.
      await Promise.resolve();
      await Promise.resolve();
    });

    // leave() (e.g. the room-change/unmount cleanup) runs before getUserMedia
    // resolves -- localStreamRef is still null at this point.
    await act(async () => {
      result.current.leave();
    });

    await act(async () => {
      resolveMedia(stream);
      await joinDone;
    });

    expect(track.stop).toHaveBeenCalled();
    expect(registerLocalTrack).not.toHaveBeenCalled();
    expect(result.current.joined).toBe(false);
  });

  it("bails out of join() if leave() runs while getNode() is still pending", async () => {
    const { getNode } = await import("../lib/mistClient");
    let resolveNode: (node: unknown) => void;
    const nodePromise = new Promise((resolve) => {
      resolveNode = resolve;
    });
    (getNode as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => nodePromise);

    const track = makeTrack();
    const stream = { getAudioTracks: () => [track], getTracks: () => [track] };
    const getUserMedia = vi.fn(async () => stream);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });

    const { result } = renderHook(() => useVoiceChat("room-1"));
    let joinDone: Promise<void>;
    act(() => {
      joinDone = result.current.join();
    });

    // leave() runs while still awaiting getNode() -- getUserMedia must never
    // even be called once the join is cancelled.
    await act(async () => {
      result.current.leave();
    });

    await act(async () => {
      resolveNode({ registerLocalTrack, unpublishLocalTrack, removeLocalTrack, setLocalTrackEnabled });
      await joinDone;
    });

    expect(getUserMedia).not.toHaveBeenCalled();
    expect(registerLocalTrack).not.toHaveBeenCalled();
    expect(result.current.joined).toBe(false);
  });
});
