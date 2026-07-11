import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { searchGifs, featuredGifs } from "./giphy";

function giphyResult(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: `gif ${id}`,
    images: {
      fixed_width: { url: `https://media.giphy.com/${id}/200w.gif`, width: "200", height: "112" },
      downsized: { url: `https://media.giphy.com/${id}/downsized.gif`, width: "480", height: "270" },
      original: { url: `https://media.giphy.com/${id}/original.gif`, width: "480", height: "270" },
    },
    ...overrides,
  };
}

describe("giphy", () => {
  let calledUrl = "";

  beforeEach(() => {
    calledUrl = "";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(body: unknown, ok = true, status = 200) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calledUrl = url;
        return {
          ok,
          status,
          statusText: ok ? "OK" : "Forbidden",
          json: async () => body,
        };
      }),
    );
  }

  it("parses a search response into GiphyGif[], skipping results missing renditions", async () => {
    stubFetch({
      data: [
        giphyResult("abc"),
        // No usable full-size rendition at all — must be skipped.
        giphyResult("broken", { images: { fixed_width: { url: "https://x/200w.gif" } } }),
      ],
    });
    const gifs = await searchGifs("test-key", "cats", 10);
    expect(calledUrl).toContain("https://api.giphy.com/v1/gifs/search?");
    expect(calledUrl).toContain("api_key=test-key");
    expect(calledUrl).toContain("q=cats");
    expect(calledUrl).toContain("limit=10");
    expect(gifs).toEqual([
      {
        id: "abc",
        description: "gif abc",
        previewUrl: "https://media.giphy.com/abc/200w.gif",
        url: "https://media.giphy.com/abc/downsized.gif",
        width: 480,
        height: 270,
      },
    ]);
  });

  it("falls back to the original rendition when downsized is absent", async () => {
    stubFetch({
      data: [
        giphyResult("orig", {
          images: {
            fixed_width: { url: "https://media.giphy.com/orig/200w.gif", width: "200", height: "112" },
            original: { url: "https://media.giphy.com/orig/original.gif", width: "500", height: "280" },
          },
        }),
      ],
    });
    const [gif] = await searchGifs("test-key", "dogs");
    expect(gif.url).toBe("https://media.giphy.com/orig/original.gif");
    expect(gif.width).toBe(500);
  });

  it("hits the trending endpoint when no query is given", async () => {
    stubFetch({ data: [giphyResult("t1")] });
    const gifs = await featuredGifs("test-key");
    expect(calledUrl).toContain("https://api.giphy.com/v1/gifs/trending?");
    expect(calledUrl).toContain("api_key=test-key");
    expect(gifs).toHaveLength(1);
  });

  it("surfaces HTTP errors", async () => {
    stubFetch({}, false, 403);
    await expect(searchGifs("bad-key", "cats")).rejects.toThrow("GIPHY request failed: 403");
  });
});
