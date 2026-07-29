import { describe, it, expect } from "vitest";
import { render } from "@testing-library/preact";
import { QrCode } from "./QrCode";

function svgOf(text: string, label = "qr"): SVGSVGElement {
  const { container } = render(<QrCode text={text} label={label} />);
  return container.querySelector("svg")!;
}

/** viewBox is "0 0 n n", where n = module count + the 2-module quiet zone twice. */
function extentOf(svg: SVGSVGElement): number {
  return Number(svg.getAttribute("viewBox")!.split(" ")[3]);
}

describe("QrCode", () => {
  it("renders the code as a single path inside a square viewBox", () => {
    const svg = svgOf("https://example.test/tc-chat/?name=room#/room-1");
    expect(svg.getAttribute("viewBox")).toMatch(/^0 0 (\d+) \1$/);
    const path = svg.querySelector("path")!;
    // One "M… h1v1h-1z" subpath per dark module — a real code has hundreds.
    expect(path.getAttribute("d")!.split("M").length - 1).toBeGreaterThan(100);
  });

  it("keeps the quiet zone and light background scanners need", () => {
    const svg = svgOf("https://example.test/#/room-1");
    const extent = extentOf(svg);
    // The white rect covers the whole code INCLUDING the margin.
    const rect = svg.querySelector("rect")!;
    expect(rect.getAttribute("fill")).toBe("#ffffff");
    expect(Number(rect.getAttribute("width"))).toBe(extent);
    expect(svg.querySelector("path")!.getAttribute("fill")).toBe("#000000");
  });

  it("grows to a bigger QR version as the link gets longer", () => {
    const short = extentOf(svgOf("https://example.test/#/a"));
    const long = extentOf(svgOf(`https://example.test/?name=${"x".repeat(300)}#/a`));
    expect(long).toBeGreaterThan(short);
  });

  it("labels the image for screen readers", () => {
    const svg = svgOf("https://example.test/#/a", "「部屋」の招待リンクのQRコード");
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe("「部屋」の招待リンクのQRコード");
  });
});
