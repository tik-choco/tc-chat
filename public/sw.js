// tc-chat service worker.
//
// This is plain JS served verbatim from public/, not built by Vite: no
// import, no TypeScript, no type checker catching mistakes here, so read it
// carefully before changing it. Registration lives in src/lib/swRegister.ts.
//
// tc-chat is a serverless static site — identity, storage and rendering are
// all client-side (localStorage + mistlib's OPFS-backed storage; see
// CLAUDE.md's "Local persistence" section). That means once the HTML shell
// and the built JS/CSS/wasm assets are cached, the app is fully functional
// offline: there is no API response to go stale, because there was never an
// API. This file's only job is caching those static bytes.

const CACHE = "tc-chat-v1";

// The app is deployed at "/" in dev and "/tc-chat/" on GitHub Pages
// (VITE_BASE_PATH in .github/workflows/deploy.yml) and this file must work
// unmodified under either. `self.registration.scope` is the absolute URL this
// worker was registered against (the `scope` swRegister.ts passed to
// `.register()`), so every base-path-relative URL below is derived from it
// rather than a hardcoded "/tc-chat/".
const SCOPE_URL = new URL(self.registration.scope);
const SHELL_URL = new URL("index.html", SCOPE_URL).toString();

self.addEventListener("install", (event) => {
  // Deliberately no precache list here. Vite content-hashes built asset
  // filenames (e.g. index-Xy12.js), so the exact set of files to precache
  // can't be known when this static file is authored/committed — there is no
  // build step for sw.js that could inject a manifest. Assets are cached
  // lazily instead, on first fetch, by the stale-while-revalidate branch
  // below. Don't "fix" this by hand-listing paths; they'll drift immediately.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Take control of already-open tabs immediately rather than waiting for
      // the next full reload — installing the PWA should start protecting the
      // current session, not just future ones.
      await self.clients.claim();
      // CACHE's version suffix is the upgrade mechanism: bumping it makes the
      // old name orphaned, so sweep every cache that isn't the current one or
      // storage quota fills up with every past version this browser ever saw.
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)));
    })(),
  );
});

/** Only real, successful, readable same-origin bodies are worth keeping. */
function isCacheable(response) {
  // response.type === "opaque" is what a cross-origin no-cors fetch returns:
  // status is always 0 and the body can't be read back out, so caching it
  // would "succeed" while being useless. This fetch handler only ever runs
  // for same-origin requests anyway (see the origin check below), so opaque
  // here would mean something unexpected happened upstream — skip it either way.
  return Boolean(response) && response.ok && response.type !== "opaque";
}

/**
 * cache.put, but a full/blocked storage quota (QuotaExceededError and
 * friends) can never reject and take the surrounding fetch handler down with
 * it — a missed cache write just means the next request re-fetches.
 */
async function safePut(request, response) {
  try {
    const cache = await caches.open(CACHE);
    await cache.put(request, response);
  } catch (error) {
    console.warn("tc-chat sw: cache put failed", error);
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only ever intercept plain reads. POSTs (none of this app's own traffic,
  // but be defensive) must never be served from or written to the cache.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Cross-origin GETs — api.giphy.com (giphy.ts), link-preview targets
  // (linkPreview.ts) — and, implicitly, anything that isn't a normal fetch at
  // all (mistlib's WebRTC/signaling traffic never goes through the Fetch
  // API's fetch event to begin with) fall through completely untouched: no
  // event.respondWith call, so the network handles it exactly as if this
  // worker didn't exist.

  if (request.mode === "navigate") {
    // Network-first: prefer a live response whenever one is reachable so
    // online users always get the latest shell, and only fall back to the
    // cached copy when the network request itself fails (offline, DNS, etc).
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          // Cache under the shell's own URL, not the requested one: tc-chat
          // is a single-page app whose routing lives entirely in the URL
          // hash (see util.ts's AppLocation), so every navigation renders the
          // same index.html regardless of what path was actually requested.
          // Keying by request URL would fragment the cache and could leave
          // the fallback below unable to find anything.
          if (isCacheable(fresh)) safePut(SHELL_URL, fresh.clone());
          return fresh;
        } catch (error) {
          const cached = await caches.match(SHELL_URL);
          if (cached) return cached;
          throw error; // genuinely offline with nothing cached yet: let it fail
        }
      })(),
    );
    return;
  }

  // Stale-while-revalidate for every other same-origin GET: hashed JS/CSS,
  // the mistlib wasm bundle, icons, the manifest. These are either immutable
  // (content-hashed, so a cached copy is never actually stale) or cheap to
  // refresh quietly, so respond from cache first — caching the wasm bundle in
  // particular is most of the offline-load-time win here.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request);

      const networkFetch = fetch(request).then((response) => {
        if (isCacheable(response)) safePut(request, response.clone());
        return response;
      });

      if (cached) {
        // Refresh in the background without making this response wait on it.
        // The catch is required even though nothing here reads the rejection:
        // an unawaited, unhandled promise rejection would otherwise surface
        // as a console error (or worse, on some platforms, tear the worker
        // down) purely because a background revalidation failed offline.
        networkFetch.catch(() => {});
        return cached;
      }

      // Nothing cached yet: this request has no choice but to wait on the
      // network, so let a genuine failure here propagate as the real error.
      return networkFetch;
    })(),
  );
});
