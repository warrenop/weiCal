/* 微记账本 service worker.
 *
 * Strategies:
 *   - App shell (HTML/CSS/JS/SVG, plus the Tailwind + ECharts CDN bundles)
 *     → cache-first; falls back to network on miss.
 *   - GET /api/* → network-first; cached response served when offline.
 *   - Non-GET requests are never cached and fail naturally when offline.
 *
 * Versioned cache name → bumping VERSION on each release invalidates the old
 * cache during the `activate` step.
 */

const VERSION = 'mycal-v0.5.2';
// Same-origin shell — precache eagerly on install.
// CDN bundles (Tailwind, ECharts) are large + may serve opaque cross-origin
// responses; they are cached lazily by the fetch handler on first request.
const APP_SHELL = [
  '/',
  '/app.js',
  '/tour.js',
  '/styles.css',
  '/logo.svg',
  '/favicon.svg',
  '/manifest.json',
];

self.addEventListener('install', (event) => {
  // Add each shell URL individually so one CDN failure doesn't void the
  // whole batch (cache.addAll is atomic).
  event.waitUntil(
    caches.open(VERSION)
      .then(async (cache) => {
        await Promise.all(APP_SHELL.map(u =>
          cache.add(new Request(u, { cache: 'reload' }))
            .catch(err => console.warn('[sw] precache miss:', u, err.message))
        ));
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== VERSION).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;          // never cache writes

  const url = new URL(req.url);

  // Skip the service worker file itself + auth endpoints (we have none now,
  // but principle: never cache anything sensitive)
  if (url.pathname === '/sw.js') return;

  const isAPI = url.pathname.startsWith('/api/');

  if (isAPI) {
    // Network-first with cache fallback
    event.respondWith((async () => {
      try {
        const resp = await fetch(req);
        if (resp.ok) {
          const cache = await caches.open(VERSION);
          cache.put(req, resp.clone()).catch(() => {});
        }
        return resp;
      } catch (e) {
        const cached = await caches.match(req);
        if (cached) {
          // Tag the response so the frontend can show an "offline" badge
          const headers = new Headers(cached.headers);
          headers.set('X-Mycal-From-Cache', '1');
          return new Response(await cached.blob(), {
            status: cached.status, statusText: cached.statusText, headers,
          });
        }
        throw e;
      }
    })());
    return;
  }

  // App shell: cache-first
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
      const resp = await fetch(req);
      if (resp.ok && (url.origin === self.location.origin
                      || url.host.includes('cdn.tailwindcss')
                      || url.host.includes('cdn.jsdelivr'))) {
        const cache = await caches.open(VERSION);
        cache.put(req, resp.clone()).catch(() => {});
      }
      return resp;
    } catch (e) {
      // Last resort: serve cached index for navigation requests
      if (req.mode === 'navigate') {
        const idx = await caches.match('/');
        if (idx) return idx;
      }
      throw e;
    }
  })());
});
