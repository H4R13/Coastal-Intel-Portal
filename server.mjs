import http from "node:http"; import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto";
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png", ".woff2": "font/woff2", ".map": "application/json", ".ico": "image/x-icon", ".jpg": "image/jpeg" };
import { APP_DIR, DATA_ROOT } from "./root.mjs"; // also moves the process to the data folder and reads .env
const root = DATA_ROOT, dist = path.join(APP_DIR, "dist");
const port = Number(process.env.PORT) || 5173;

// Data API backed by PostgreSQL and Redis (server/api.mjs).
const api = await import("./server/api.mjs").then((m) => m.handleApi, (e) => (console.log(`Data API off (${e.code ?? e.message}); run "npm install" to enable it`), null));

/**
 * Disk cache for remote map tiles (basemaps, global terrain, vector tiles, styles, glyphs).
 * GET /tile-cache?u=<encoded tile URL> downloads the tile once into .tilecache/ and serves it from disk
 * ever after, so the tile providers are not asked for the same tile again. sw.js routes tile requests here.
 * Only the hosts below are fetched, so this cannot be used as a general proxy.
 */
const CACHE_DIR = path.join(root, ".tilecache");
const TILE_HOSTS = [
  { host: "cartocdn.com" }, { host: "arcgisonline.com" }, { host: "tiles.maps.eox.at" }, { host: "gibs.earthdata.nasa.gov" },
  { host: "opentopomap.org" }, { host: "s3.amazonaws.com", prefix: "/elevation-tiles-prod/" },
];
const allowed = (u) => u.protocol === "https:" && TILE_HOSTS.some(({ host, prefix = "/" }) => (u.hostname === host || u.hostname.endsWith(`.${host}`)) && u.pathname.startsWith(prefix));
// latest sea-surface temperature and style/tilejson files change over time: refresh them once a day
const isVolatile = (u) => /\/default\/default\//.test(u.pathname) || /(style|tiles)\.json$/.test(u.pathname);
const DAY = 864e5;
const sniff = (b) => (b[0] === 0x89 ? "image/png" : b[0] === 0xff ? "image/jpeg" : b[0] === 0x7b ? "application/json" : "application/x-protobuf");
const inflight = new Map(); // one download per tile even if it is requested several times at once

async function loadTile(target) {
  const key = crypto.createHash("sha1").update(target.href).digest("hex");
  const file = path.join(CACHE_DIR, target.hostname, key.slice(0, 2), key);
  const stat = fs.existsSync(file) ? fs.statSync(file) : null;
  if (stat && (!isVolatile(target) || Date.now() - stat.mtimeMs < DAY)) return { status: 200, body: fs.readFileSync(file), state: "hit" };
  const stale = () => ({ status: 200, body: fs.readFileSync(file), state: "stale" });
  try {
    const r = await fetch(target, { headers: { "User-Agent": "CoastalIntelPortal-tile-cache/1.0" } });
    if (!r.ok) return stat ? stale() : { status: r.status, body: Buffer.alloc(0), state: "miss" };
    const body = Buffer.from(await r.arrayBuffer());
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, body); fs.renameSync(tmp, file); // never leave a half-written tile behind
    return { status: 200, body, state: "miss" };
  } catch {
    return stat ? stale() : { status: 502, body: Buffer.alloc(0), state: "miss" }; // offline: serve what we have
  }
}

async function serveTile(req, res) {
  let target;
  try { target = new URL(new URL(req.url, "http://localhost").searchParams.get("u")); } catch { target = null; }
  if (!target || !allowed(target)) { res.writeHead(403); return res.end("Not an allowed tile host"); }
  if (!inflight.has(target.href)) inflight.set(target.href, loadTile(target).finally(() => inflight.delete(target.href)));
  const { status, body, state } = await inflight.get(target.href);
  const headers = { "X-Tile-Cache": state };
  if (status === 200) { headers["Content-Type"] = sniff(body); headers["Cache-Control"] = isVolatile(target) ? "no-cache" : "public, max-age=31536000, immutable"; }
  res.writeHead(status, headers);
  res.end(body);
}

http.createServer((req, res) => {
  if (req.url.startsWith("/tile-cache?")) return serveTile(req, res);
  if (req.url.startsWith("/api/")) { if (api) return api(req, res); res.writeHead(503); return res.end("Data API not running"); }
  const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/$/, "/index.html");
  // /data/ (terrain and sea-level tiles) comes from the data folder; everything else is the built React app in dist/.
  // .env, raw team data, server code and caches are in neither place, so they stay private.
  const base = rel.startsWith("/data/") ? root : dist;
  const p = path.join(base, rel);
  if (!p.startsWith(base) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(fs.existsSync(dist) ? "Not found" : "The app has not been built yet: run npm run build"); }
  const headers = { "Content-Type": types[path.extname(p)] ?? "application/octet-stream" };
  if (rel.startsWith("/data/") && rel.endsWith(".png")) headers["Cache-Control"] = "public, max-age=86400"; // terrain tiles are static
  else if (rel.startsWith("/assets/")) headers["Cache-Control"] = "public, max-age=31536000, immutable"; // built files carry a hash of their content in the name
  else headers["Cache-Control"] = "no-cache"; // the page itself: the browser must never show an out-of-date copy
  res.writeHead(200, headers);
  fs.createReadStream(p).pipe(res);
}).on("error", (e) => {
  if (e.code !== "EADDRINUSE") throw e;
  console.error(`Port ${port} is already in use (another copy of the server is probably running). Stop it, or start this one with PORT=<other port>.`);
  process.exit(1);
}).listen(port, () => console.log(`http://localhost:${port}`));
