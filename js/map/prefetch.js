/**
 * Warm the tile cache for the study area so zooming around it is instant.
 * Fetches a modest pyramid (zoom 0–9) of tiles over the Pakistan coast in the background, at low
 * priority and low concurrency; the service worker (sw.js) stores them.
 */
const BOUNDS = { w: 60.0, e: 70.0, s: 22.0, n: 27.5 };
const MIN_Z = 0, MAX_Z = 9, CONCURRENCY = 4;
const done = new Set();

const lon2x = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2y = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

function* tiles(template, minZ, maxZ) {
  for (let z = minZ; z <= maxZ; z++) {
    const x0 = lon2x(BOUNDS.w, z), x1 = lon2x(BOUNDS.e, z), y0 = lat2y(BOUNDS.n, z), y1 = lat2y(BOUNDS.s, z);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      yield template.replace("{z}", z).replace("{x}", x).replace("{y}", y);
    }
  }
}

let isBusy = () => false;
/** Let the map tell the prefetcher when the user is interacting, so downloads never compete with zooming. */
export const setBusyCheck = (fn) => { isBusy = fn; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(urls) {
  const queue = [...urls];
  const worker = async () => {
    for (let u; (u = queue.shift()); ) {
      while (isBusy()) await sleep(400);
      try { await fetch(u, { priority: "low" }); } catch { /* offline or blocked: skip */ }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

/** @param {string} id unique key so a source is only warmed once; @param {string} template tile URL with {z}/{x}/{y} */
export function prefetch(id, template, { maxZ = MAX_Z } = {}) {
  if (!template || done.has(id)) return;
  if (navigator.connection?.saveData) return;
  if (!navigator.serviceWorker?.controller) return; // nothing would be cached
  done.add(id);
  const go = () => run(tiles(template, MIN_Z, maxZ));
  "requestIdleCallback" in window ? requestIdleCallback(go, { timeout: 4000 }) : setTimeout(go, 2000);
}
