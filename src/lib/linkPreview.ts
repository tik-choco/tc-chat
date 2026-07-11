// Link-preview cards for URLs posted in chat. This app is browser-only —
// there is no backend to proxy fetches through — so a direct
// `fetch(arbitraryUrl)` from the page is subject to CORS like any other
// cross-origin request. Most sites don't send permissive CORS headers on
// their HTML, so most previews WILL fail to fetch title/description/image
// and that is expected, not a bug: fetchLinkPreview() degrades silently to
// a minimal card (domain + favicon only) rather than surfacing an error to
// the user. Anything reachable via CORS (or same-origin in dev) upgrades
// to a rich card for free.

/** Favicon service — hostname-keyed, no API key, CORS-friendly for <img src>.
 *  Kept as a named constant so it's easy to swap providers later. */
const FAVICON_SERVICE = "https://icons.duckduckgo.com/ip3/";

/** How long a single preview fetch may hang before we give up and fall back. */
const FETCH_TIMEOUT_MS = 5000;

export interface LinkPreview {
  /** The URL the preview is for (as posted). */
  url: string;
  /** Hostname, e.g. "example.com". */
  domain: string;
  /** Always set — favicon service URL usable directly in an <img>. */
  faviconUrl: string;
  title?: string;
  description?: string;
  /** Absolute og:image URL if present. */
  imageUrl?: string;
}

// Matches http(s) URLs up to the next whitespace run. Trailing punctuation
// that's almost never part of the URL itself (sentence-ending punctuation,
// and a lone closing paren when there's no matching opening paren) is
// trimmed by trimTrailingPunctuation() below rather than in the regex, so
// URLs containing balanced parens — e.g. Wikipedia links — survive intact.
const URL_RE = /https?:\/\/\S+/g;

function trimTrailingPunctuation(candidate: string): string {
  let s = candidate.replace(/[.,;:!?]+$/, "");
  if (s.endsWith(")") && !s.includes("(")) {
    s = s.slice(0, -1);
  }
  return s;
}

/** Extract http/https URLs from message text, in order. Non-http schemes (javascript:, ftp:, data:) must be ignored. */
export function extractHttpUrls(text: string): string[] {
  const matches = text.match(URL_RE) ?? [];
  const urls: string[] = [];
  for (const raw of matches) {
    const trimmed = trimTrailingPunctuation(raw);
    try {
      // new URL() both validates and normalizes; also re-confirms the
      // scheme since trimming could theoretically shift things.
      const parsed = new URL(trimmed);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        urls.push(trimmed);
      }
    } catch {
      // Not a valid URL once trimmed — skip it.
    }
  }
  return urls;
}

/** Split text into segments so the UI can linkify: [{type:"text",value},{type:"url",value},...]. Adjacent text preserved verbatim; whole input round-trips by concatenating values. */
export function splitByUrls(text: string): Array<{ type: "text" | "url"; value: string }> {
  const urls = extractHttpUrls(text);
  const segments: Array<{ type: "text" | "url"; value: string }> = [];
  let cursor = 0;
  for (const url of urls) {
    const idx = text.indexOf(url, cursor);
    if (idx === -1) continue; // shouldn't happen, but keep round-trip safety
    if (idx > cursor) {
      segments.push({ type: "text", value: text.slice(cursor, idx) });
    }
    segments.push({ type: "url", value: url });
    cursor = idx + url.length;
  }
  if (cursor < text.length) {
    segments.push({ type: "text", value: text.slice(cursor) });
  }
  return segments;
}

function faviconUrlFor(hostname: string): string {
  return `${FAVICON_SERVICE}${hostname}.ico`;
}

function minimalPreview(url: string): LinkPreview {
  let domain = url;
  try {
    domain = new URL(url).hostname;
  } catch {
    // Caller is expected to pass a validated URL, but never throw here.
  }
  return { url, domain, faviconUrl: faviconUrlFor(domain) };
}

function absolutize(maybeRelative: string | null, baseUrl: string): string | undefined {
  if (!maybeRelative) return undefined;
  try {
    return new URL(maybeRelative, baseUrl).toString();
  } catch {
    return undefined;
  }
}

function metaContent(doc: Document, selector: string): string | undefined {
  const el = doc.querySelector(selector);
  const content = el?.getAttribute("content")?.trim();
  return content ? content : undefined;
}

/** Parse an HTML document string into a LinkPreview (og:title/og:description/og:image, falling back to <title> and <meta name="description">). Relative og:image URLs resolved against baseUrl. Pure — uses DOMParser, no network. */
export function parseLinkPreviewHtml(html: string, baseUrl: string): LinkPreview {
  const base = minimalPreview(baseUrl);
  const doc = new DOMParser().parseFromString(html, "text/html");

  const ogTitle = metaContent(doc, 'meta[property="og:title"]');
  const plainTitle = doc.querySelector("title")?.textContent?.trim();
  const title = ogTitle ?? (plainTitle ? plainTitle : undefined);

  const ogDescription = metaContent(doc, 'meta[property="og:description"]');
  const metaDescription = metaContent(doc, 'meta[name="description"]');
  const description = ogDescription ?? metaDescription;

  const ogImage = metaContent(doc, 'meta[property="og:image"]');
  const imageUrl = absolutize(ogImage ?? null, baseUrl);

  return { ...base, title, description, imageUrl };
}

/** In-flight/completed preview fetches, keyed by URL, so repeated calls
 *  (e.g. the same link posted twice, or re-renders) fetch at most once. */
const previewCache = new Map<string, Promise<LinkPreview>>();

async function doFetchLinkPreview(url: string): Promise<LinkPreview> {
  const fallback = minimalPreview(url);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, { signal: controller.signal, redirect: "follow" });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return fallback;
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) return fallback;
    const html = await res.text();
    return parseLinkPreviewHtml(html, url);
  } catch {
    // Cross-origin fetches routinely fail here with an opaque CORS error,
    // plus plain network failures / aborts — all expected, all fall back.
    return fallback;
  }
}

/** Fetch + parse a preview. NEVER rejects: on any failure (CORS, network, timeout ~5s via AbortController, non-HTML content-type) resolves to the minimal fallback {url, domain, faviconUrl}. Results cached per URL in a module-level Map (in-flight promises shared too, so concurrent calls for the same URL fetch once). */
export function fetchLinkPreview(url: string): Promise<LinkPreview> {
  const cached = previewCache.get(url);
  if (cached) return cached;
  const promise = doFetchLinkPreview(url);
  previewCache.set(url, promise);
  return promise;
}
