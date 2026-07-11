// Minimal GIPHY v1 client (search + trending). Dependency-free — just
// fetch() — because this is the only GIPHY call site in the app: the selected
// GIF's bytes are re-fetched and sent through the normal P2P media pipeline
// (see GifPicker), so this module never touches storage or the mesh.
//
// GIPHY replaced Tenor here after Google shut the Tenor API down for third
// parties on 2026-06-30 (new key signups had been closed since January).
// Free GIPHY keys start as rate-limited beta keys (~100 calls/hour), which is
// plenty for a personal picker.

export interface GiphyGif {
  id: string;
  description: string;
  /** Small fixed-width rendition, used for the picker grid. */
  previewUrl: string;
  /** Downsized (≤2MB) or original GIF, fetched only once the user picks it. */
  url: string;
  width: number;
  height: number;
}

const GIPHY_BASE = "https://api.giphy.com/v1/gifs";

interface GiphyImage {
  url?: string;
  width?: string;
  height?: string;
}

interface GiphyResult {
  id: string;
  title?: string;
  images?: {
    /** 200px-wide animated rendition — the grid preview. */
    fixed_width?: GiphyImage;
    /** Original capped at 2MB — preferred for the actual send. */
    downsized?: GiphyImage;
    original?: GiphyImage;
  };
}

interface GiphyResponse {
  data: GiphyResult[];
}

function toGifs(json: GiphyResponse): GiphyGif[] {
  const gifs: GiphyGif[] = [];
  for (const r of json.data ?? []) {
    // The picked GIF travels the P2P swarm as raw bytes, so prefer the
    // ≤2MB downsized rendition over the unbounded original.
    const full = r.images?.downsized?.url ? r.images.downsized : r.images?.original;
    const preview = r.images?.fixed_width?.url ? r.images.fixed_width : full;
    if (!full?.url || !preview?.url) continue; // skip results missing the renditions we need
    gifs.push({
      id: r.id,
      description: r.title ?? "",
      previewUrl: preview.url,
      url: full.url,
      // GIPHY serializes dimensions as strings.
      width: Number(full.width ?? 0),
      height: Number(full.height ?? 0),
    });
  }
  return gifs;
}

async function getJson(url: string): Promise<GiphyResponse> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`GIPHY request failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as GiphyResponse;
}

export async function searchGifs(
  apiKey: string,
  query: string,
  limit = 24,
): Promise<GiphyGif[]> {
  const params = new URLSearchParams({
    api_key: apiKey,
    q: query,
    limit: String(limit),
    rating: "g",
  });
  const json = await getJson(`${GIPHY_BASE}/search?${params.toString()}`);
  return toGifs(json);
}

/** Trending GIFs — the picker's empty-query state. */
export async function featuredGifs(apiKey: string, limit = 24): Promise<GiphyGif[]> {
  const params = new URLSearchParams({
    api_key: apiKey,
    limit: String(limit),
    rating: "g",
  });
  const json = await getJson(`${GIPHY_BASE}/trending?${params.toString()}`);
  return toGifs(json);
}
