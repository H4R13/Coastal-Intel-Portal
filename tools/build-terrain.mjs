/**
 * Build the portal's terrain tiles from the 12.5 m Sindh + Balochistan DEMs.
 *
 *  1. Merge: Sindh first, Balochistan fills the rest (both are UTM 42N, int16, nodata -32768).
 *  2. Datum: source heights are ellipsoidal (WGS84). Orthometric height  H = h − N  using EGM2008,
 *     so 0 m is mean sea level and sea-level-rise maths is meaningful.
 *  3. Sea: nodata (sea) is written as exactly 0 m so water is flat.
 *  4. Output: Terrarium-encoded PNG tiles (Web Mercator XYZ)  data/terrain/{z}/{x}/{y}.png
 *       z10–z11  every tile that touches land
 *       z12–z13  only coastal lowland (any land ≤ LOW_M metres), where the 12.5 m detail matters
 *     Elsewhere the portal falls back to the global terrain.
 *
 * Usage: node build-terrain.mjs [--zmin 10] [--zmax 13] [--out ../data/terrain]
 * Resumable: tiles that already exist are skipped.
 */
import fs from "node:fs";
import path from "node:path";
import { fromFile } from "geotiff";
import proj4 from "proj4";
import { PNG } from "pngjs";
import { loadGeoid } from "./lib/geoid.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const ZMIN = +arg("zmin", 10), ZMAX = +arg("zmax", 13);
const OUT = path.resolve(arg("out", "../data/terrain"));
const LOW_M = 40; // z12+ tiles are kept only if they contain land at or below this height (MSL)
const BBOX = { w: 61.3, e: 68.7, s: 23.6, n: 26.3 }; // study coast
const SUPERSAMPLE = { 10: 3, 11: 3, 12: 2, 13: 1 };
const NODATA = -32768;
const UTM42 = "+proj=utm +zone=42 +datum=WGS84 +units=m +no_defs";
const toUTM = proj4("EPSG:4326", UTM42);
const SOURCES = ["D:/NDMA/Sindh12.5.tif", "D:/NDMA/Balochistan12.5.tif"];

const geoid = await loadGeoid("data/us_nga_egm08_25.tif");
const srcs = [];
for (const f of SOURCES) {
  const img = await (await fromFile(f)).getImage();
  const [x0, , , y1] = img.getBoundingBox();
  const [rx, ry] = img.getResolution();
  srcs.push({ f, img, x0, y1, res: rx, W: img.getWidth(), H: img.getHeight() });
}

/* ---------- tile maths ---------- */
const lonOf = (x, z) => (x / 2 ** z) * 360 - 180;
const latOf = (y, z) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;
const lon2x = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2y = (lat, z) => { const r = (lat * Math.PI) / 180; return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z); };

const TS = 256, G = 16, NG = TS / G + 1; // control grid: 17 x 17 nodes, bilinear in between

function controlGrid(z, x, y) {
  const E = new Float64Array(NG * NG), Nn = new Float64Array(NG * NG), Gd = new Float64Array(NG * NG);
  for (let j = 0; j < NG; j++) for (let i = 0; i < NG; i++) {
    const lon = lonOf(x + (i * G) / TS, z), lat = latOf(y + (j * G) / TS, z);
    const [e, n] = toUTM.forward([lon, lat]);
    E[j * NG + i] = e; Nn[j * NG + i] = n; Gd[j * NG + i] = geoid.at(lon, lat);
  }
  return { E, Nn, Gd };
}

const interp = (A, u, v) => {
  const gx = Math.min(u / G, NG - 1.0001), gy = Math.min(v / G, NG - 1.0001);
  const i = Math.floor(gx), j = Math.floor(gy), fx = gx - i, fy = gy - j, k = j * NG + i;
  return (A[k] * (1 - fx) + A[k + 1] * fx) * (1 - fy) + (A[k + NG] * (1 - fx) + A[k + NG + 1] * fx) * fy;
};

/** Read the part of one source raster that a tile needs. Returns null if it doesn't overlap. */
async function readWindow(src, grid) {
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
  for (let k = 0; k < grid.E.length; k++) {
    const fx = (grid.E[k] - src.x0) / src.res, fy = (src.y1 - grid.Nn[k]) / src.res;
    if (fx < minx) minx = fx; if (fx > maxx) maxx = fx; if (fy < miny) miny = fy; if (fy > maxy) maxy = fy;
  }
  const wx0 = Math.max(0, Math.floor(minx) - 2), wy0 = Math.max(0, Math.floor(miny) - 2);
  const wx1 = Math.min(src.W, Math.ceil(maxx) + 3), wy1 = Math.min(src.H, Math.ceil(maxy) + 3);
  if (wx1 - wx0 < 4 || wy1 - wy0 < 4) return null;
  const data = await src.img.readRasters({ window: [wx0, wy0, wx1, wy1], interleave: true, samples: [0] });
  return { data, wx0, wy0, w: wx1 - wx0, h: wy1 - wy0 };
}

/** Bilinear sample (valid neighbours only). Returns NaN when none of the 4 neighbours has data. */
function sample(win, fx, fy) {
  const px = fx - 0.5 - win.wx0, py = fy - 0.5 - win.wy0;
  const x0 = Math.floor(px), y0 = Math.floor(py);
  if (x0 < -1 || y0 < -1 || x0 >= win.w || y0 >= win.h) return NaN;
  const tx = px - x0, ty = py - y0;
  let sum = 0, wsum = 0;
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    const xx = x0 + dx, yy = y0 + dy;
    if (xx < 0 || yy < 0 || xx >= win.w || yy >= win.h) continue;
    const v = win.data[yy * win.w + xx];
    if (v === NODATA) continue;
    const w = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty);
    sum += v * w; wsum += w;
  }
  return wsum > 1e-6 ? sum / wsum : NaN;
}

/** Orthometric heights (m above MSL) for one tile: Float32Array(256*256), sea = 0. Also reports land stats. */
async function renderTile(z, x, y) {
  const grid = controlGrid(z, x, y);
  const wins = [];
  for (const s of srcs) wins.push({ s, win: await readWindow(s, grid) });
  if (wins.every((w) => !w.win)) return null;
  const ss = SUPERSAMPLE[z] ?? 1;
  const out = new Float32Array(TS * TS);
  let land = 0, lowLand = 0;
  for (let py = 0; py < TS; py++) for (let px = 0; px < TS; px++) {
    let sum = 0, cnt = 0;
    for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
      const u = px + (sx + 0.5) / ss, v = py + (sy + 0.5) / ss;
      const e = interp(grid.E, u, v), n = interp(grid.Nn, u, v), N = interp(grid.Gd, u, v);
      for (const { s, win } of wins) {
        if (!win) continue;
        const h = sample(win, (e - s.x0) / s.res, (s.y1 - n) / s.res);
        if (!Number.isNaN(h)) { sum += h - N; cnt++; break; } // first source with data wins (Sindh, then Balochistan)
      }
    }
    // a pixel counts as land if at least half of its sub-samples have data
    if (cnt * 2 >= ss * ss) {
      const H = sum / cnt;
      out[py * TS + px] = H;
      land++; if (H <= LOW_M) lowLand++;
    }
  }
  return { out, land, lowLand };
}

function encodeTerrarium(h) {
  const png = new PNG({ width: TS, height: TS });
  for (let i = 0; i < h.length; i++) {
    const v = h[i] + 32768, r = Math.floor(v / 256), g = Math.floor(v - r * 256), b = Math.floor((v - Math.floor(v)) * 256);
    png.data[i * 4] = r; png.data[i * 4 + 1] = g; png.data[i * 4 + 2] = b; png.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(png, { colorType: 2, inputColorType: 6, inputHasAlpha: true, deflateLevel: 9 });
}

/* ---------- run ---------- */
const stats = { written: 0, skippedSea: 0, skippedHigh: 0, existing: 0, coastH: [] };
const keep = new Map(); // z -> Set("x/y") of tiles that touched land (for choosing children)
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

for (let z = ZMIN; z <= ZMAX; z++) {
  let cand;
  if (z === ZMIN) {
    cand = [];
    const x0 = lon2x(BBOX.w, z), x1 = lon2x(BBOX.e, z), y0 = lat2y(BBOX.n, z), y1 = lat2y(BBOX.s, z);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) cand.push([x, y]);
  } else {
    cand = [];
    for (const k of keep.get(z - 1) ?? []) { const [px, py] = k.split("/").map(Number); for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) cand.push([px * 2 + dx, py * 2 + dy]); }
  }
  const lowOnly = z >= 12;
  keep.set(z, new Set());
  log(`z${z}: ${cand.length} candidate tiles${lowOnly ? ` (coastal lowland ≤ ${LOW_M} m only)` : ""}`);
  let done = 0;
  for (const [x, y] of cand) {
    if (++done % 100 === 0) log(`  z${z} ${done}/${cand.length}  written ${stats.written}`);
    const file = path.join(OUT, String(z), String(x), `${y}.png`);
    const r = await renderTile(z, x, y);
    if (!r || r.land === 0) { stats.skippedSea++; continue; }
    keep.get(z).add(`${x}/${y}`); // children are only explored below tiles that have land
    if (lowOnly && r.lowLand === 0) { stats.skippedHigh++; continue; }
    if (fs.existsSync(file)) { stats.existing++; continue; }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, encodeTerrarium(r.out));
    stats.written++;
  }
}

/* manifest: which tiles exist, so the client never requests (and 404s on) absent ones */
const tiles = {};
for (const zs of fs.existsSync(OUT) ? fs.readdirSync(OUT) : []) {
  if (!/^\d+$/.test(zs)) continue;
  tiles[zs] = [];
  for (const xs of fs.readdirSync(path.join(OUT, zs))) for (const f of fs.readdirSync(path.join(OUT, zs, xs))) tiles[zs].push(`${xs}/${f.replace(".png", "")}`);
}
fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify({
  encoding: "terrarium",
  tileSize: TS,
  minzoom: ZMIN,
  maxzoom: ZMAX,
  bbox: [BBOX.w, BBOX.s, BBOX.e, BBOX.n],
  vertical: "Orthometric height above mean sea level (EGM2008). Sea = 0 m.",
  sources: ["Sindh12.5.tif", "Balochistan12.5.tif (12.5 m, ellipsoidal heights, converted with EGM2008)"],
  geoid: "EGM2008 via PROJ us_nga_egm08_25.tif",
  detailRule: `z12+ only where land ≤ ${LOW_M} m`,
  built: new Date().toISOString(),
  tiles,
}));
log(`done. written ${stats.written}, existing ${stats.existing}, sea ${stats.skippedSea}, high-ground skipped ${stats.skippedHigh}`);
