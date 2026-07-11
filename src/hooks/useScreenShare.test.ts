import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/preact";
import { useScreenShare } from "./useScreenShare";

const registerLocalTrack = vi.fn();
const unpublishLocalTrack = vi.fn();
const removeLocalTrack = vi.fn();
const sendMessage = vi.fn();
let mediaListener: ((eventType: number, payload: unknown) => void) | null = null;
let rawListener:
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
    (listener: (eventType: number, fromId: string, payload: unknown, roomId: string) => void) => {
      rawListener = listener;
      return () => {
        rawListener = null;
      };
    },
  ),
  isRawEvent: (eventType: number) => eventType === 0,
  // Tests pass the decoded object directly as the payload.
  decodeRawPayload: (payload: unknown) => payload,
  MEDIA_EVENT_TRACK_ADDED: 100,
  MEDIA_EVENT_TRACK_REMOVED: 101,
  EVENT_PEER_DISCONNECTED: 6,
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

describe("useScreenShare", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mediaListener = null;
    rawListener = null;
  });

  it("starts sharing: getDisplayMedia called with video+audio, video track published", async () => {
    const track = makeTrack();
    const stream = { getVideoTracks: () => [track], getAudioTracks: () => [], getTracks: () => [track] };
    const getDisplayMedia = vi.fn(async () => stream);
    vi.stubGlobal("navigator", { mediaDevices: { getDisplayMedia } });

    const { result } = renderHook(() => useScreenShare("room-1"));
    await act(async () => {
      await result.current.start();
    });

    expect(getDisplayMedia).toHaveBeenCalledWith({ video: true, audio: true });
    expect(registerLocalTrack).toHaveBeenCalledWith(
      expect.stringContaining("track-1"),
      track,
      { publish: true, enabled: true },
    );
    expect(result.current.sharing).toBe(true);
  });

  it("registers and publishes a second track when the stream includes audio", async () => {
    const videoTrack = makeTrack("video-1", "video");
    const audioTrack = makeTrack("audio-1", "audio");
    const stream = {
      getVideoTracks: () => [videoTrack],
      getAudioTracks: () => [audioTrack],
      getTracks: () => [videoTrack, audioTrack],
    };
    vi.stubGlobal("navigator", {
      mediaDevices: { getDisplayMedia: vi.fn(async () => stream) },
    });

    const { result } = renderHook(() => useScreenShare("room-1"));
    await act(async () => {
      await result.current.start();
    });

    expect(registerLocalTrack).toHaveBeenCalledTimes(2);
    expect(registerLocalTrack).toHaveBeenCalledWith(
      expect.stringContaining("video-1"),
      videoTrack,
      { publish: true, enabled: true },
    );
    expect(registerLocalTrack).toHaveBeenCalledWith(
      expect.stringContaining("audio-1"),
      audioTrack,
      { publish: true, enabled: true },
    );

    await act(async () => {
      result.current.stop();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(unpublishLocalTrack).toHaveBeenCalledTimes(2);
    expect(removeLocalTrack).toHaveBeenCalledTimes(2);
    expect(videoTrack.stop).toHaveBeenCalled();
    expect(audioTrack.stop).toHaveBeenCalled();
  });

  it("publishes only video when the stream has no audio track (no throw)", async () => {
    const videoTrack = makeTrack("video-1", "video");
    const stream = {
      getVideoTracks: () => [videoTrack],
      getAudioTracks: () => [],
      getTracks: () => [videoTrack],
    };
    vi.stubGlobal("navigator", {
      mediaDevices: { getDisplayMedia: vi.fn(async () => stream) },
    });

    const { result } = renderHook(() => useScreenShare("room-1"));
    await act(async () => {
      await expect(result.current.start()).resolves.toBeUndefined();
    });

    expect(registerLocalTrack).toHaveBeenCalledTimes(1);
    expect(result.current.sharing).toBe(true);
    expect(result.current.error).toBeNull();
    // Silent-success case: getDisplayMedia resolved fine, but there's no
    // audio to publish -- the user likely didn't tick "share audio" in the
    // browser's picker. Surfaced as a non-blocking hint, not `error`.
    expect(result.current.audioMissing).toBe(true);
  });

  it("does not flag audioMissing when the stream includes an audio track", async () => {
    const videoTrack = makeTrack("video-1", "video");
    const audioTrack = makeTrack("audio-1", "audio");
    const stream = {
      getVideoTracks: () => [videoTrack],
      getAudioTracks: () => [audioTrack],
      getTracks: () => [videoTrack, audioTrack],
    };
    vi.stubGlobal("navigator", {
      mediaDevices: { getDisplayMedia: vi.fn(async () => stream) },
    });

    const { result } = renderHook(() => useScreenShare("room-1"));
    await act(async () => {
      await result.current.start();
    });

    expect(result.current.audioMissing).toBe(false);
  });

  it("clears audioMissing after stop, so a later re-share starts clean", async () => {
    const videoTrack = makeTrack("video-1", "video");
    const stream = {
      getVideoTracks: () => [videoTrack],
      getAudioTracks: () => [],
      getTracks: () => [videoTrack],
    };
    vi.stubGlobal("navigator", {
      mediaDevices: { getDisplayMedia: vi.fn(async () => stream) },
    });

    const { result } = renderHook(() => useScreenShare("room-1"));
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.audioMissing).toBe(true);

    await act(async () => {
      result.current.stop();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.audioMissing).toBe(false);
  });

  it("stops sharing: unpublish + track.stop() called", async () => {
    const track = makeTrack();
    const stream = {
      getVideoTracks: () => [track],
      getAudioTracks: () => [],
      getTracks: () => [track],
    };
    vi.stubGlobal("navigator", {
      mediaDevices: { getDisplayMedia: vi.fn(async () => stream) },
    });

    const { result } = renderHook(() => useScreenShare("room-1"));
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
    expect(result.current.sharing).toBe(false);
  });

  it("sets error state on getDisplayMedia rejection without throwing", async () => {
    const getDisplayMedia = vi.fn(async () => {
      throw new Error("Permission denied");
    });
    vi.stubGlobal("navigator", { mediaDevices: { getDisplayMedia } });

    const { result } = renderHook(() => useScreenShare("room-1"));
    await act(async () => {
      await expect(result.current.start()).resolves.toBeUndefined();
    });

    expect(result.current.error).toBeTruthy();
    expect(result.current.sharing).toBe(false);
  });

  it("triggers cleanup/unpublish on native 'ended' event", async () => {
    const track = makeTrack();
    const stream = {
      getVideoTracks: () => [track],
      getAudioTracks: () => [],
      getTracks: () => [track],
    };
    vi.stubGlobal("navigator", {
      mediaDevices: { getDisplayMedia: vi.fn(async () => stream) },
    });

    const { result } = renderHook(() => useScreenShare("room-1"));
    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      track.fireEnded();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(unpublishLocalTrack).toHaveBeenCalled();
    expect(result.current.sharing).toBe(false);
  });

  it("adds remote video track on TRACK_ADDED and removes it on TRACK_REMOVED", async () => {
    const { result } = renderHook(() => useScreenShare("room-1"));

    const remoteTrack = { id: "remote-1" };
    await act(async () => {
      mediaListener?.(100, {
        fromId: "peer-1",
        trackId: "remote-1",
        kind: "video",
        track: remoteTrack,
        stream: { id: "s1" },
      });
    });
    expect(result.current.remoteTracks).toHaveLength(1);
    expect(result.current.remoteTracks[0].trackId).toBe("remote-1");

    await act(async () => {
      mediaListener?.(101, {
        fromId: "peer-1",
        trackId: "remote-1",
        kind: "video",
        track: remoteTrack,
      });
    });
    expect(result.current.remoteTracks).toHaveLength(0);
  });

  it("ignores our own display track looped back by the mesh", async () => {
    const { result } = renderHook(() => useScreenShare("room-1"));
    await act(async () => {
      mediaListener?.(100, {
        fromId: "self-node", // our own node id (see mock localNodeId)
        trackId: "mine-1",
        kind: "video",
        track: { id: "mine-1" },
        stream: { id: "s-self" },
      });
    });
    expect(result.current.remoteTracks).toHaveLength(0);
  });

  it("ignores camera tracks (tc-chat-cam prefix) -- those render in VideoCallStage instead", async () => {
    const { result } = renderHook(() => useScreenShare("room-1"));
    await act(async () => {
      mediaListener?.(100, {
        fromId: "peer-1",
        trackId: "tc-chat-cam:not-a-screen",
        kind: "video",
        track: { id: "not-a-screen" },
        stream: { id: "s1" },
      });
    });
    expect(result.current.remoteTracks).toHaveLength(0);
  });

  it("keeps one tile per sharer: a re-share replaces the sender's previous track", async () => {
    const { result } = renderHook(() => useScreenShare("room-1"));
    await act(async () => {
      mediaListener?.(100, {
        fromId: "peer-1",
        trackId: "screen-a",
        kind: "video",
        track: { id: "screen-a" },
        stream: { id: "sa" },
      });
      mediaListener?.(100, {
        fromId: "peer-1",
        trackId: "screen-b", // same sender re-shares with a new track
        kind: "video",
        track: { id: "screen-b" },
        stream: { id: "sb" },
      });
    });
    expect(result.current.remoteTracks).toHaveLength(1);
    expect(result.current.remoteTracks[0].trackId).toBe("screen-b");

    // A late removal for the stale track must not tear down the current tile.
    await act(async () => {
      mediaListener?.(101, { fromId: "peer-1", trackId: "screen-a", kind: "video", track: {} });
    });
    expect(result.current.remoteTracks).toHaveLength(1);
    expect(result.current.remoteTracks[0].trackId).toBe("screen-b");
  });

  it("stop() broadcasts a share-stopped message on the share room's channel", async () => {
    const track = makeTrack();
    const stream = {
      getVideoTracks: () => [track],
      getAudioTracks: () => [],
      getTracks: () => [track],
    };
    vi.stubGlobal("navigator", {
      mediaDevices: { getDisplayMedia: vi.fn(async () => stream) },
    });

    const { result } = renderHook(() => useScreenShare("room-1"));
    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      result.current.stop();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(sendMessage).toHaveBeenCalledWith(
      null,
      { type: "tc-chat:screen-share-stopped" },
      0, // DELIVERY_RELIABLE
      "room-1",
    );
  });

  it("removes the sender's tile when their share-stopped broadcast arrives", async () => {
    const { result } = renderHook(() => useScreenShare("room-1"));
    await act(async () => {
      mediaListener?.(100, {
        fromId: "peer-1",
        trackId: "remote-1",
        kind: "video",
        track: { id: "remote-1" },
        stream: { id: "s1" },
      });
    });
    expect(result.current.remoteTracks).toHaveLength(1);

    await act(async () => {
      rawListener?.(0, "peer-1", { type: "tc-chat:screen-share-stopped" }, "room-1");
    });
    expect(result.current.remoteTracks).toHaveLength(0);
  });

  it("removes a peer's tile when the peer disconnects (no broadcast ever arrives)", async () => {
    const { result } = renderHook(() => useScreenShare("room-1"));
    await act(async () => {
      mediaListener?.(100, {
        fromId: "peer-1",
        trackId: "remote-1",
        kind: "video",
        track: { id: "remote-1" },
        stream: { id: "s1" },
      });
      mediaListener?.(100, {
        fromId: "peer-2",
        trackId: "remote-2",
        kind: "video",
        track: { id: "remote-2" },
        stream: { id: "s2" },
      });
    });
    expect(result.current.remoteTracks).toHaveLength(2);

    await act(async () => {
      rawListener?.(6, "peer-1", null, ""); // EVENT_PEER_DISCONNECTED
    });
    expect(result.current.remoteTracks).toHaveLength(1);
    expect(result.current.remoteTracks[0].fromId).toBe("peer-2");
  });

  it("removes the tile when the receiving track itself ends (last-resort teardown)", async () => {
    const remoteTrack = makeTrack("remote-1");
    const { result } = renderHook(() => useScreenShare("room-1"));
    await act(async () => {
      mediaListener?.(100, {
        fromId: "peer-1",
        trackId: "remote-1",
        kind: "video",
        track: remoteTrack,
        stream: { id: "s1" },
      });
    });
    expect(result.current.remoteTracks).toHaveLength(1);

    await act(async () => {
      remoteTrack.fireEnded();
    });
    expect(result.current.remoteTracks).toHaveLength(0);
  });
});
