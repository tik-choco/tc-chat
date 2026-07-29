import { useMemo } from "preact/hooks";
import qrcode from "qrcode-generator";

/**
 * Renders a string as a QR code SVG.
 *
 * The modules are emitted as ONE `<path>` of 1x1 squares (one `M…h1v1h-1z`
 * per dark module) inside a viewBox sized in module units, so the code stays
 * crisp at any size and needs no canvas, no image encoding and no innerHTML.
 * Colors are hard-coded black-on-white rather than themed: scanners need the
 * dark/light contrast in that polarity, and a dark-theme inversion would make
 * some readers fail.
 */
export function QrCode(props: { text: string; size?: number; label?: string }) {
  const { text, size = 176, label } = props;

  const { path, extent } = useMemo(() => {
    // Type 0 = pick the smallest version that fits; "M" error correction is the
    // usual trade-off for URLs (still readable with a bit of glare/damage).
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const count = qr.getModuleCount();
    const margin = 2; // "quiet zone" — scanners need clear space around the code
    let d = "";
    for (let row = 0; row < count; row += 1) {
      for (let col = 0; col < count; col += 1) {
        if (qr.isDark(row, col)) d += `M${col + margin} ${row + margin}h1v1h-1z`;
      }
    }
    return { path: d, extent: count + margin * 2 };
  }, [text]);

  return (
    <svg
      class="qr-code"
      width={size}
      height={size}
      viewBox={`0 0 ${extent} ${extent}`}
      role="img"
      aria-label={label}
      shape-rendering="crispEdges"
    >
      <rect width={extent} height={extent} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}
