/// <reference lib="webworker" />
/**
 * Custom Service Worker (injectManifest).
 *
 * Responsibilities:
 * - precache the app shell (via __WB_MANIFEST)
 * - network-first navigation with offline fallback (offline.html)
 * - cache-first SHA-versioned corpus packages under /content/
 * - network-first catalog.json (fall back to cached copy offline)
 * - manual update flow: skipWaiting only on SKIP_WAITING message
 *
 * No push notifications: the app is fully offline by design.
 */
import { clientsClaim } from 'workbox-core';
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

clientsClaim();

// Silent auto-update: a fresh SW activates immediately on install; the app
// reloads via the prompt-flow controllerchange in update.ts (no banner).
self.addEventListener('install', () => {
  void self.skipWaiting();
});

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// ---- App shell navigation: network first, robust offline/4xx fallback ----
// Important: this app may sit behind HTTP Basic Auth on the origin (see
// deploy/nginx). A standalone PWA launched from the home screen does NOT
// share the browser's Basic Auth credentials, so the network fetch for the
// navigation request frequently comes back 401. We must NEVER surface that
// 401 to the page — any non-200 (and any network error) falls through to
// the cached app shell instead. Once the shell is precached the user can
// always enter the app offline/standalone; the SW serves the cached
// index.html and the React app boots from there.
registerRoute(
  new NavigationRoute(async ({ request }) => {
    try {
      const response = await fetch(request);
      if (response && response.status === 200) {
        const cache = await caches.open('bess-app-shell');
        cache.put(request, response.clone());
        return response;
      }
      // 401/403/4xx/5xx: do NOT return the error response — fall through to
      // the cached shell. Returning the 401 here is what previously surfaced
      // "Authorization required" to users opening the installed PWA.
    } catch {
      /* network failure — fall through to cache */
    }
    // Fallback chain: the requested URL (for deep links) → app shell →
    // offline page. precacheAndRoute stores index.html under '/index.html'.
    const cached =
      (await caches.match(request)) ??
      (await caches.match('/index.html')) ??
      (await caches.match('/offline.html'));
    return cached ?? Response.error();
  }),
);

// ---- Corpus packages: SHA-versioned names → cache first, never stale ----
registerRoute(
  ({ url }) => url.pathname.startsWith('/content/') && !url.pathname.endsWith('/catalog.json'),
  new CacheFirst({
    cacheName: 'bess-content-packages',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 12,
        maxAgeSeconds: 365 * 24 * 60 * 60,
      }),
    ],
  }),
);

// ---- Catalog: network first (fall back to cached copy while offline) ----
registerRoute(
  ({ url }) => url.pathname.endsWith('/content/catalog.json'),
  new NetworkFirst({
    cacheName: 'bess-catalog',
    networkTimeoutSeconds: 10,
  }),
);

// ---- Static assets (hashed): stale-while-revalidate would be ideal, but
//      hashed filenames make CacheFirst safe and fast. ----
registerRoute(
  ({ url }) => /\.(js|css|woff2?|png|svg)$/.test(url.pathname) && !url.pathname.startsWith('/content/'),
  new CacheFirst({
    cacheName: 'bess-assets',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 60,
        maxAgeSeconds: 365 * 24 * 60 * 60,
      }),
    ],
  }),
);

// ---- Manual update: skipWaiting only when the app asks (prompt flow) ----
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  }
});
