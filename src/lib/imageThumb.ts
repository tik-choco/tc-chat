// Downscales images client-side before they're attached to board posts:
// full-resolution photos would bloat every peer's mistlib storage and the
// P2P wire payload, so posts carry only a small thumbnail. Encoding prefers
// webp (much smaller than jpeg at equal quality) but falls back to jpeg
// since canvas.toBlob support for webp isn't universal.
//
// Decode/draw/encode all go through canvas APIs that happy-dom doesn't
// implement, so those steps are isolated behind `internal` (a plain object,
// not module-private closures) purely so tests can override individual
// steps and exercise the resize-math/fallback/error logic without a real
// canvas or image decoder.

export interface ThumbResult {
  bytes: Uint8Array;
  mimeType: string;
}

export interface ThumbOptions {
  maxDim?: number;
  quality?: number;
}

const DEFAULT_MAX_DIM = 1024;
const DEFAULT_QUALITY = 0.82;

/** Compute output dimensions for a `width` x `height` image scaled so its
 * longest edge is at most `maxDim`. Images already within bounds are
 * returned unchanged (never upscaled). Result dimensions are always >= 1. */
export function fitDimensions(
  width: number,
  height: number,
  maxDim: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= 0 || longest <= maxDim) {
    return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
  }
  const scale = maxDim / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

interface DecodedImage {
  width: number;
  height: number;
  source: CanvasImageSource;
  /** Releases decoder resources (ImageBitmap.close()); absent for the <img> fallback path. */
  close?: () => void;
}

/** Browser-API-touching steps, isolated so tests can override them (no real
 * canvas/createImageBitmap/Image decoding in happy-dom). Not part of the
 * stable public contract — only `makeThumbnail`/`fitDimensions` are. */
export const internal = {
  async decode(file: File): Promise<DecodedImage> {
    if (!file.type.startsWith("image/")) {
      throw new Error(`makeThumbnail: not an image file (type=${file.type || "unknown"})`);
    }

    if (typeof createImageBitmap === "function") {
      let bitmap: ImageBitmap;
      try {
        bitmap = await createImageBitmap(file);
      } catch (err) {
        throw new Error(`makeThumbnail: failed to decode image: ${(err as Error)?.message ?? err}`);
      }
      return {
        width: bitmap.width,
        height: bitmap.height,
        source: bitmap,
        close: () => bitmap.close(),
      };
    }

    // Fallback for environments without createImageBitmap: decode via <img>.
    // EXIF orientation is not auto-applied on this path (createImageBitmap
    // handles it on the primary path above).
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("makeThumbnail: failed to decode image"));
        img.src = url;
      });
      return { width: img.naturalWidth, height: img.naturalHeight, source: img };
    } finally {
      URL.revokeObjectURL(url);
    }
  },

  drawToCanvas(source: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("makeThumbnail: 2d canvas context unavailable");
    ctx.drawImage(source, 0, 0, width, height);
    return canvas;
  },

  encode(canvas: HTMLCanvasElement, mimeType: string, quality: number): Promise<Blob | null> {
    return new Promise((resolve) => canvas.toBlob(resolve, mimeType, quality));
  },
};

async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  const buf = await blob.arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * Downscales an image File to thumbnail bytes for P2P storage.
 * - maxDim default 1024 (longest edge; smaller images are not upscaled)
 * - prefers image/webp, falls back to image/jpeg (quality default 0.82)
 * - throws on non-image input or decode failure
 */
export async function makeThumbnail(file: File, opts?: ThumbOptions): Promise<ThumbResult> {
  const maxDim = opts?.maxDim ?? DEFAULT_MAX_DIM;
  const quality = opts?.quality ?? DEFAULT_QUALITY;

  const decoded = await internal.decode(file);
  try {
    const { width, height } = fitDimensions(decoded.width, decoded.height, maxDim);
    const canvas = internal.drawToCanvas(decoded.source, width, height);

    const webpBlob = await internal.encode(canvas, "image/webp", quality);
    if (webpBlob) {
      return { bytes: await blobToBytes(webpBlob), mimeType: "image/webp" };
    }

    const jpegBlob = await internal.encode(canvas, "image/jpeg", quality);
    if (jpegBlob) {
      return { bytes: await blobToBytes(jpegBlob), mimeType: "image/jpeg" };
    }

    throw new Error("makeThumbnail: canvas.toBlob returned null for both webp and jpeg");
  } finally {
    decoded.close?.();
  }
}
