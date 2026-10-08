/**
 * Tile cache. Map tiles are cached persistently in the browser so repeat visits, zooming back and
 * forth, and switching basemaps are served locally instead of from remote servers.
 *  - static tiles (imagery, elevation, vector, dated NASA layers): cache-first
 *  - tiles that change over time (latest sea-surface temperature) and style/tilejson files:
 *    stale-while-revalidate (show the cached copy now, refresh it in the background)
 * App files (html/js/css) are never touched, so deploys stay instant.
 */
const CACHE = "pakcoast-tiles-v1";
const MAX_ENTRIES = 6000;
const TILE_HOSTS = [
  "cartocdn.com",
  "arcgisonline.com",
  "tiles.maps.eox.at",
  "gibs.earthdata.nasa.gov",
  "opentopomap.org",
  "elevation-tiles-prod",
];

const isTileRequest = (url) => TILE_HOSTS.some((h) => url.hostname.includes(h) || url.pathname.includes(h));
const isVolatile = (url) => /\/default\/default\//.test(url.pathname) || /(style|tiles)\.json$/.test(url.pathname);

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith("pakcoast-tiles-") && k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

async function trim(cache) {
  const keys = await cache.keys();
  if (keys.length > MAX_ENTRIES) await Promise.all(keys.slice(0, keys.length - MAX_ENTRIES).map((k) => cache.delete(k)));
}

// Misses go through the dev server's disk cache (serve.mjs, /tile-cache) so each tile is downloaded from its
// provider once and survives a cleared browser cache. Hosts without that route are detected and fetched directly.
let diskCache = true;
async function fetchTile(req) {
  if (diskCache) {
    const res = await fetch(new URL(`tile-cache?u=${encodeURIComponent(req.url)}`, self.location), { signal: req.signal }).catch(() => null);
    if (res?.headers.has("X-Tile-Cache")) return res;
    if (res) diskCache = false; // answered, but not by serve.mjs: static hosting
  }
  return fetch(req);
}

async function fromNetwork(req, cache) {
  const res = await fetchTile(req);
  if (res.ok) { cache.put(req, res.clone()).then(() => (Math.random() < 0.02 ? trim(cache) : null)); }
  return res;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (!isTileRequest(url)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    if (hit) {
      if (isVolatile(url)) event.waitUntil(fromNetwork(req, cache).catch(() => {}));
      return hit;
    }
    return fromNetwork(req, cache);
  })());
});
