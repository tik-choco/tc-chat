import { useEffect, useState } from "preact/hooks";
import { fetchLinkPreview, type LinkPreview } from "../lib/linkPreview";

// Renders a rich card below a linkified URL. fetchLinkPreview() never
// rejects, but most cross-origin fetches are blocked by CORS and resolve to
// the minimal fallback (domain + favicon only) — the layout below is
// designed to look intentional with just that, and upgrades automatically
// when title/description/image are available.
export function LinkPreviewCard(props: { url: string }) {
  const { url } = props;
  const [preview, setPreview] = useState<LinkPreview | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const [faviconFailed, setFaviconFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPreview(null);
    setImageFailed(false);
    setFaviconFailed(false);
    fetchLinkPreview(url).then((p) => !cancelled && setPreview(p));
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (!preview) return null;

  return (
    <a class="link-card" href={preview.url} target="_blank" rel="noopener noreferrer">
      {preview.imageUrl && !imageFailed && (
        <img
          class="link-card-image"
          src={preview.imageUrl}
          alt=""
          onError={() => setImageFailed(true)}
        />
      )}
      <div class="link-card-body">
        <p class="link-card-title">{preview.title ?? preview.url}</p>
        {preview.description && <p class="link-card-desc">{preview.description}</p>}
        <div class="link-card-footer">
          {!faviconFailed && (
            <img
              class="link-card-favicon"
              src={preview.faviconUrl}
              alt=""
              onError={() => setFaviconFailed(true)}
            />
          )}
          <span class="link-card-domain">{preview.domain}</span>
        </div>
      </div>
    </a>
  );
}
