import { useEffect, useRef, useState } from "preact/hooks";
import { X, Search, Loader2 } from "lucide-preact";
import { loadGiphyApiKey, saveGiphyApiKey } from "../lib/chatStore";
import { searchGifs, featuredGifs, type GiphyGif } from "../lib/giphy";
import { useT } from "../lib/i18n";

const SEARCH_DEBOUNCE_MS = 400;

type LoadState = "idle" | "loading" | "error";

/**
 * Popover above the input, mirroring StoragePicker. The picked GIF's bytes are
 * fetched client-side and handed to the parent as a File — from there it's a
 * normal image/gif post through the existing P2P media pipeline, so only the
 * sender ever needs a GIPHY key (see props.onSelect callers).
 */
export function GifPicker(props: { onSelect: (file: File) => void; onCancel: () => void }) {
  const { onSelect, onCancel } = props;
  const t = useT();
  const [apiKey, setApiKey] = useState(() => loadGiphyApiKey());
  const [keyInput, setKeyInput] = useState("");
  const [query, setQuery] = useState("");
  const [gifs, setGifs] = useState<GiphyGif[]>([]);
  const [state, setState] = useState<LoadState>("idle");
  const [pickingId, setPickingId] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!apiKey) return;
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(
      () => {
        void runSearch(query);
      },
      query ? SEARCH_DEBOUNCE_MS : 0,
    );
    return () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, query]);

  // Escape/outside-click closes, same as StoragePicker's convention.
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    function handlePointer(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onCancel();
    }
    document.addEventListener("keydown", handleKey);
    document.addEventListener("mousedown", handlePointer);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("mousedown", handlePointer);
    };
  }, [onCancel]);

  async function runSearch(q: string) {
    setState("loading");
    try {
      const results = q.trim() ? await searchGifs(apiKey, q.trim()) : await featuredGifs(apiKey);
      setGifs(results);
      setState("idle");
    } catch {
      setState("error");
    }
  }

  function handleSaveKey() {
    const trimmed = keyInput.trim();
    if (!trimmed) return;
    saveGiphyApiKey(trimmed);
    setApiKey(trimmed);
    setKeyInput("");
  }

  async function handlePick(gif: GiphyGif) {
    setPickingId(gif.id);
    try {
      const res = await fetch(gif.url);
      if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
      const bytes = await res.arrayBuffer();
      const file = new File([bytes], `giphy-${gif.id}.gif`, { type: "image/gif" });
      onSelect(file);
    } catch {
      setState("error");
    } finally {
      setPickingId(null);
    }
  }

  return (
    <div class="gif-picker" ref={rootRef}>
      <div class="gif-picker-header">
        <span>{t("chat.gifPickerTitle")}</span>
        <button
          type="button"
          class="gif-picker-cancel"
          onClick={onCancel}
          aria-label={t("common.close")}
        >
          <X size={16} />
        </button>
      </div>

      {!apiKey ? (
        <div class="gif-picker-setup">
          <p class="gif-picker-setup-title">{t("chat.gifSetupTitle")}</p>
          <p class="gif-picker-setup-body">{t("chat.gifSetupBody")}</p>
          <a
            class="gif-picker-setup-link"
            href="https://developers.giphy.com/docs/api#quick-start-guide"
            target="_blank"
            rel="noreferrer"
          >
            {t("chat.gifSetupLink")}
          </a>
          <div class="gif-picker-setup-row">
            <input
              class="gif-picker-key-input"
              type="text"
              placeholder={t("chat.gifApiKeyPlaceholder")}
              value={keyInput}
              onInput={(e) => setKeyInput((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveKey();
              }}
            />
            <button
              type="button"
              class="gif-picker-key-save"
              disabled={!keyInput.trim()}
              onClick={handleSaveKey}
            >
              {t("chat.gifSaveKey")}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div class="gif-picker-search">
            <Search size={14} class="gif-picker-search-icon" />
            <input
              class="gif-picker-search-input"
              type="text"
              placeholder={t("chat.gifSearchPlaceholder")}
              value={query}
              onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
              autoFocus
            />
          </div>

          {!query && state !== "loading" && gifs.length > 0 && (
            <p class="gif-picker-section-label">{t("chat.gifTrending")}</p>
          )}

          {state === "loading" && (
            <div class="gif-picker-status">
              <Loader2 size={18} class="gif-picker-spinner" />
              <span>{t("chat.gifLoading")}</span>
            </div>
          )}

          {state === "error" && <p class="gif-picker-status gif-picker-status--error">{t("chat.gifLoadFailed")}</p>}

          {state === "idle" && gifs.length === 0 && (
            <p class="gif-picker-status">{t("chat.gifNoResults")}</p>
          )}

          {state !== "loading" && gifs.length > 0 && (
            <div class="gif-picker-grid">
              {gifs.map((gif) => (
                <button
                  type="button"
                  key={gif.id}
                  class="gif-picker-item"
                  disabled={pickingId !== null}
                  onClick={() => void handlePick(gif)}
                >
                  <img src={gif.previewUrl} alt={gif.description || "GIF"} loading="lazy" />
                  {pickingId === gif.id && (
                    <span class="gif-picker-item-loading">
                      <Loader2 size={20} class="gif-picker-spinner" />
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          <p class="gif-picker-attribution">{t("chat.gifAttribution")}</p>
        </>
      )}
    </div>
  );
}
