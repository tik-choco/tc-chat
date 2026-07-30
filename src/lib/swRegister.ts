// Service worker registration for the offline PWA shell. The worker itself
// lives at public/sw.js (plain JS, no bundler — see that file for why); this
// module is only the glue that decides *whether* and *where* to register it.

/**
 * Resolves the service worker URL + scope for the app's deployed base path.
 *
 * `baseUrl` is Vite's `import.meta.env.BASE_URL` — `"/"` in dev, `"/tc-chat/"`
 * on GitHub Pages (see `vite.config.ts`'s `VITE_BASE_PATH`). A service worker
 * registered with `{ scope }` can only ever control requests under that scope,
 * so the sub-path deployment must register at `/tc-chat/`, never `/` — a
 * root-scoped worker on Pages would 404 fetching itself and, if it somehow
 * loaded, would try to control every app on the origin, not just this one.
 *
 * Kept as a pure string function (no globals, no DOM) so it's trivially unit
 * tested without mocking `navigator.serviceWorker`.
 */
export function swPaths(baseUrl: string): { url: string; scope: string } {
  // Vite's BASE_URL is always supposed to end in "/", but normalize anyway:
  // an empty string (falsy) or a caller-supplied path missing the trailing
  // slash would otherwise concatenate into a wrong sibling path like
  // "/tc-chatsw.js" instead of "/tc-chat/sw.js".
  const base = baseUrl && baseUrl.length > 0 ? (baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`) : "/";
  return { url: `${base}sw.js`, scope: base };
}

/**
 * Registers the service worker. No-ops when unsupported or in dev; never throws.
 *
 * Registration failure (or the API being unavailable) must never affect the
 * app itself — tc-chat works perfectly well without a service worker, it just
 * loses the offline/installed-app win — so every failure path here swallows
 * its error rather than propagating it.
 */
export function registerServiceWorker(): void {
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    // A service worker caching `vite dev`'s served modules would go stale the
    // moment source changes — the dev server's whole point is that it never
    // does — producing baffling "why isn't my edit showing up" bugs. Only
    // ever register against a real build.
    if (import.meta.env.DEV) return;

    const register = () => {
      const { url, scope } = swPaths(import.meta.env.BASE_URL);
      navigator.serviceWorker.register(url, { scope }).catch((error) => {
        console.warn("tc-chat: service worker registration failed", error);
      });
    };

    // Deferring to `load` keeps the registration (and the worker's first
    // install/fetch handling) off the critical path for first paint. If the
    // document has already finished loading by the time this runs, `load`
    // has already fired and will never fire again, so register immediately
    // instead of waiting on an event that's already missed.
    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register);
    }
  } catch (error) {
    console.warn("tc-chat: service worker registration failed", error);
  }
}
