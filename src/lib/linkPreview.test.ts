import { afterEach, describe, expect, it, vi } from "vitest";
import { extractHttpUrls, fetchLinkPreview, parseLinkPreviewHtml, splitByUrls } from "./linkPreview";

function stubFetch(impl: (url: string) => Promise<unknown>) {
  vi.stubGlobal("fetch", vi.fn(impl));
}

function htmlResponse(html: string, contentType = "text/html; charset=utf-8") {
  return {
    ok: true,
    status: 200,
    headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? contentType : null) },
    text: async () => html,
  };
}

describe("extractHttpUrls", () => {
  it("finds a plain URL", () => {
    expect(extractHttpUrls("https://example.com")).toEqual(["https://example.com"]);
  });

  it("finds a URL mid-sentence and trims trailing punctuation", () => {
    expect(extractHttpUrls("Check this out: https://example.com/path, it's great.")).toEqual([
      "https://example.com/path",
    ]);
  });

  it("finds multiple URLs in order", () => {
    expect(
      extractHttpUrls("first https://a.example/one then https://b.example/two done"),
    ).toEqual(["https://a.example/one", "https://b.example/two"]);
  });

  it("handles japanese text around URLs", () => {
    expect(extractHttpUrls("これを見て https://example.com/path をチェックして")).toEqual([
      "https://example.com/path",
    ]);
  });

  it("ignores javascript: and ftp: schemes", () => {
    expect(extractHttpUrls("javascript:alert(1) and ftp://example.com/file and data:text/plain,hi")).toEqual([]);
  });

  it("returns an empty array when there are no URLs", () => {
    expect(extractHttpUrls("just some plain text, no links here")).toEqual([]);
  });

  it("keeps a trailing closing paren when the URL contains a matching opening paren", () => {
    expect(extractHttpUrls("see https://en.wikipedia.org/wiki/Cat_(disambiguation)")).toEqual([
      "https://en.wikipedia.org/wiki/Cat_(disambiguation)",
    ]);
  });

  it("strips an unmatched trailing closing paren", () => {
    expect(extractHttpUrls("(see https://example.com/path)")).toEqual(["https://example.com/path"]);
  });
});

describe("splitByUrls", () => {
  function concatValues(text: string): string {
    return splitByUrls(text)
      .map((seg) => seg.value)
      .join("");
  }

  it("round-trips arbitrary text by concatenating segment values", () => {
    const samples = [
      "no urls at all here",
      "https://example.com",
      "prefix https://example.com/a suffix",
      "https://a.example first, https://b.example second",
      "こんにちは https://example.com/path です",
      "",
    ];
    for (const text of samples) {
      expect(concatValues(text)).toBe(text);
    }
  });

  it("returns a single text segment for text-only input", () => {
    expect(splitByUrls("just plain text")).toEqual([{ type: "text", value: "just plain text" }]);
  });

  it("returns a single url segment for url-only input", () => {
    expect(splitByUrls("https://example.com")).toEqual([{ type: "url", value: "https://example.com" }]);
  });

  it("handles a URL at the start followed by text", () => {
    expect(splitByUrls("https://example.com rest of message")).toEqual([
      { type: "url", value: "https://example.com" },
      { type: "text", value: " rest of message" },
    ]);
  });

  it("handles a URL at the end preceded by text", () => {
    expect(splitByUrls("check this out https://example.com")).toEqual([
      { type: "text", value: "check this out " },
      { type: "url", value: "https://example.com" },
    ]);
  });
});

describe("parseLinkPreviewHtml", () => {
  it("prefers full OGP tags", () => {
    const html = `<!doctype html><html><head>
      <title>Plain Title</title>
      <meta name="description" content="Plain description">
      <meta property="og:title" content="OG Title">
      <meta property="og:description" content="OG description">
      <meta property="og:image" content="https://cdn.example.com/img.png">
    </head><body></body></html>`;
    const preview = parseLinkPreviewHtml(html, "https://example.com/page");
    expect(preview).toEqual({
      url: "https://example.com/page",
      domain: "example.com",
      faviconUrl: "https://icons.duckduckgo.com/ip3/example.com.ico",
      title: "OG Title",
      description: "OG description",
      imageUrl: "https://cdn.example.com/img.png",
    });
  });

  it("falls back to <title> and <meta name=description> when og tags are absent", () => {
    const html = `<!doctype html><html><head>
      <title>Plain Title</title>
      <meta name="description" content="Plain description">
    </head><body></body></html>`;
    const preview = parseLinkPreviewHtml(html, "https://example.com/page");
    expect(preview.title).toBe("Plain Title");
    expect(preview.description).toBe("Plain description");
    expect(preview.imageUrl).toBeUndefined();
  });

  it("resolves a relative og:image against baseUrl", () => {
    const html = `<!doctype html><html><head>
      <meta property="og:image" content="/assets/img.png">
    </head><body></body></html>`;
    const preview = parseLinkPreviewHtml(html, "https://example.com/blog/post");
    expect(preview.imageUrl).toBe("https://example.com/assets/img.png");
  });

  it("returns only the minimal fields when nothing is present", () => {
    const preview = parseLinkPreviewHtml("<html><head></head><body></body></html>", "https://example.com/page");
    expect(preview).toEqual({
      url: "https://example.com/page",
      domain: "example.com",
      faviconUrl: "https://icons.duckduckgo.com/ip3/example.com.ico",
      title: undefined,
      description: undefined,
      imageUrl: undefined,
    });
  });
});

describe("fetchLinkPreview", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches and parses the HTML body on success", async () => {
    stubFetch(async () =>
      htmlResponse(
        `<html><head><meta property="og:title" content="Hello"><meta property="og:image" content="https://example.com/img.png"></head></html>`,
      ),
    );
    const preview = await fetchLinkPreview("https://example.com/success-1");
    expect(preview.title).toBe("Hello");
    expect(preview.imageUrl).toBe("https://example.com/img.png");
    expect(preview.domain).toBe("example.com");
  });

  it("falls back to the minimal preview when fetch rejects, without throwing", async () => {
    stubFetch(async () => {
      throw new Error("network down");
    });
    const preview = await fetchLinkPreview("https://example.com/fails-1");
    expect(preview).toEqual({
      url: "https://example.com/fails-1",
      domain: "example.com",
      faviconUrl: "https://icons.duckduckgo.com/ip3/example.com.ico",
    });
  });

  it("falls back to the minimal preview on a non-ok response", async () => {
    stubFetch(async () => ({
      ok: false,
      status: 404,
      headers: { get: () => "text/html" },
      text: async () => "<html></html>",
    }));
    const preview = await fetchLinkPreview("https://example.com/fails-2");
    expect(preview.title).toBeUndefined();
    expect(preview.domain).toBe("example.com");
  });

  it("falls back to the minimal preview on a non-HTML content type", async () => {
    stubFetch(async () => htmlResponse('{"not":"html"}', "application/json"));
    const preview = await fetchLinkPreview("https://example.com/fails-3");
    expect(preview.title).toBeUndefined();
  });

  it("caches results per URL, fetching only once for concurrent/repeated calls", async () => {
    const fetchMock = vi.fn(async () => htmlResponse("<html><head><title>Cached</title></head></html>"));
    vi.stubGlobal("fetch", fetchMock);

    const [first, second] = await Promise.all([
      fetchLinkPreview("https://example.com/cache-me"),
      fetchLinkPreview("https://example.com/cache-me"),
    ]);
    expect(first.title).toBe("Cached");
    expect(second.title).toBe("Cached");

    const third = await fetchLinkPreview("https://example.com/cache-me");
    expect(third.title).toBe("Cached");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
