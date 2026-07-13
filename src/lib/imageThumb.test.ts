import { describe, it, expect, vi, afterEach } from "vitest";
import { makeThumbnail, fitDimensions, internal } from "./imageThumb";

function pngFile(name = "a.png"): File {
  return new File([new Uint8Array([0, 1, 2, 3])], name, { type: "image/png" });
}

describe("fitDimensions", () => {
  it("does not upscale images already within bounds", () => {
    expect(fitDimensions(400, 300, 1024)).toEqual({ width: 400, height: 300 });
  });

  it("leaves an image exactly at maxDim unchanged", () => {
    expect(fitDimensions(1024, 512, 1024)).toEqual({ width: 1024, height: 512 });
  });

  it("scales down a wide image so the width matches maxDim", () => {
    expect(fitDimensions(2000, 1000, 1024)).toEqual({ width: 1024, height: 512 });
  });

  it("scales down a tall image so the height matches maxDim", () => {
    expect(fitDimensions(1000, 2000, 1024)).toEqual({ width: 512, height: 1024 });
  });

  it("scales a square image proportionally", () => {
    expect(fitDimensions(4096, 4096, 1024)).toEqual({ width: 1024, height: 1024 });
  });

  it("never returns a zero dimension", () => {
    expect(fitDimensions(0, 0, 1024)).toEqual({ width: 1, height: 1 });
  });
});

describe("makeThumbnail", () => {
  const originalDecode = internal.decode;
  const originalDraw = internal.drawToCanvas;
  const originalEncode = internal.encode;

  afterEach(() => {
    internal.decode = originalDecode;
    internal.drawToCanvas = originalDraw;
    internal.encode = originalEncode;
  });

  it("rejects non-image files (real decode guard, no mocking needed)", async () => {
    const drawSpy = vi.fn();
    internal.drawToCanvas = drawSpy;
    const file = new File([new Uint8Array([0])], "a.txt", { type: "text/plain" });

    await expect(makeThumbnail(file)).rejects.toThrow(/not an image/);
    expect(drawSpy).not.toHaveBeenCalled();
  });

  it("prefers webp and passes computed dimensions + default quality to encode", async () => {
    internal.decode = vi.fn().mockResolvedValue({ width: 2000, height: 1000, source: {} });
    internal.drawToCanvas = vi.fn().mockReturnValue({});
    const webpBytes = new Uint8Array([1, 2, 3]);
    internal.encode = vi.fn().mockResolvedValue(new Blob([webpBytes], { type: "image/webp" }));

    const result = await makeThumbnail(pngFile());

    expect(result.mimeType).toBe("image/webp");
    expect(Array.from(result.bytes)).toEqual(Array.from(webpBytes));
    expect(internal.drawToCanvas).toHaveBeenCalledWith(expect.anything(), 1024, 512);
    expect(internal.encode).toHaveBeenCalledWith(expect.anything(), "image/webp", 0.82);
  });

  it("falls back to jpeg when webp encoding returns null", async () => {
    internal.decode = vi.fn().mockResolvedValue({ width: 100, height: 100, source: {} });
    internal.drawToCanvas = vi.fn().mockReturnValue({});
    const jpegBytes = new Uint8Array([9, 9]);
    const encodeMock = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(new Blob([jpegBytes], { type: "image/jpeg" }));
    internal.encode = encodeMock;

    const result = await makeThumbnail(pngFile());

    expect(result.mimeType).toBe("image/jpeg");
    expect(Array.from(result.bytes)).toEqual(Array.from(jpegBytes));
    expect(encodeMock).toHaveBeenNthCalledWith(1, expect.anything(), "image/webp", 0.82);
    expect(encodeMock).toHaveBeenNthCalledWith(2, expect.anything(), "image/jpeg", 0.82);
  });

  it("throws when both webp and jpeg encoding fail", async () => {
    internal.decode = vi.fn().mockResolvedValue({ width: 10, height: 10, source: {} });
    internal.drawToCanvas = vi.fn().mockReturnValue({});
    internal.encode = vi.fn().mockResolvedValue(null);

    await expect(makeThumbnail(pngFile())).rejects.toThrow(/canvas\.toBlob returned null/);
  });

  it("propagates decode failures", async () => {
    internal.decode = vi.fn().mockRejectedValue(new Error("boom"));

    await expect(makeThumbnail(pngFile())).rejects.toThrow("boom");
  });

  it("respects custom maxDim and quality options", async () => {
    internal.decode = vi.fn().mockResolvedValue({ width: 500, height: 500, source: {} });
    internal.drawToCanvas = vi.fn().mockReturnValue({});
    const encodeMock = vi.fn().mockResolvedValue(new Blob([new Uint8Array([1])], { type: "image/webp" }));
    internal.encode = encodeMock;

    await makeThumbnail(pngFile(), { maxDim: 100, quality: 0.5 });

    expect(internal.drawToCanvas).toHaveBeenCalledWith(expect.anything(), 100, 100);
    expect(encodeMock).toHaveBeenCalledWith(expect.anything(), "image/webp", 0.5);
  });

  it("releases decoder resources via close() even when encoding fails", async () => {
    const close = vi.fn();
    internal.decode = vi.fn().mockResolvedValue({ width: 10, height: 10, source: {}, close });
    internal.drawToCanvas = vi.fn().mockReturnValue({});
    internal.encode = vi.fn().mockResolvedValue(null);

    await expect(makeThumbnail(pngFile())).rejects.toThrow();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
