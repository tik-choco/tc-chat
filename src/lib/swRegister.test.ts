import { describe, it, expect } from "vitest";
import { swPaths } from "./swRegister";

// registerServiceWorker isn't covered here: mocking import.meta.env plus
// navigator.serviceWorker/window.load would test the mocks more than the
// logic. swPaths is the pure part and carries the actual base-path math.
describe("swPaths", () => {
  it("resolves the root base path (dev)", () => {
    expect(swPaths("/")).toEqual({ url: "/sw.js", scope: "/" });
  });

  it("resolves the GitHub Pages sub-path base", () => {
    expect(swPaths("/tc-chat/")).toEqual({ url: "/tc-chat/sw.js", scope: "/tc-chat/" });
  });

  it("appends a missing trailing slash before joining", () => {
    expect(swPaths("/tc-chat")).toEqual({ url: "/tc-chat/sw.js", scope: "/tc-chat/" });
  });

  it("falls back to root for an empty base", () => {
    expect(swPaths("")).toEqual({ url: "/sw.js", scope: "/" });
  });
});
