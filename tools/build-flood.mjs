/**
 * Sea-level inundation tiles from the MSL-corrected DEM tiles (data/terrain, z13).
 *
 * For each water level L (metres above mean sea level — tide / surge / projected rise, decided by the team):
 *   flooded = land with  H ≤ L  that is CONNECTED to the sea (4-neighbour flood fill from sea pixels).
 * Low inland basins that the sea can't reach stay dry. depth = L − H.
 * Output: coloured depth tiles  data/sealevel/<id>/{z}/{x}/{y}.png  (z0–z13) + manifest.json
 *
 * Usage:  node build-flood.mjs --levels 0.5,1,2 [--id-prefix slr] [--out ../data/sealevel]
 *         node build-flood.mjs --level 1.2 --id slr_2050_mid
 *
 * Limits: vertical accuracy of a SAR DEM in flat deltas is ~1–3 m, so treat results as exposure of the
 * terrain model, not a prediction. No hydrodynamics, no defences, no subsidence.
 */
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const TERRAIN = path.resolve(arg("terrain", "../data/terrain"));
const OUT = path.resolve(arg("out", "../data/sealevel"));
const ZMAX = 13, ZMIN = 0, TS = 256, N = TS * TS; // down to z0 so the exposure stays visible even from the globe view
const levels = (arg("levels", arg("level", "")) || "").split(",").filter(Boolean).map(Number);
if (!levels.length || levels.some(Number.isNaN)) { console.error("give --levels 0.5,1,2 (metres above MSL) or --level 1.2 [--id name]"); process.exit(1); }
const idPrefix = arg("id-prefix", "slr");
const singleId = arg("id", null);

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

/* ---------- load z13 elevation ---------- */
const manifest = JSON.parse(fs.readFileSync(path.join(TERRAIN, "manifest.json"), "utf8"));
const keys = manifest.tiles[ZMAX];
if (!keys?.length) { console.error(`no z${ZMAX} terrain tiles — run build-terrain.mjs first`); process.exit(1); }
const index = new Map(); // "x/y" -> slot
const tiles = [];        // slot -> { x, y, h: Float32Array }
for (const k of keys) {
  const [x, y] = k.split("/").map(Number);
  const png = PNG.sync.read(fs.readFileSync(path.join(TERRAIN, String(ZMAX), String(x), `${y}.png`)));
  const h = new Float32Array(N);
  for (let i = 0; i < N; i++) h[i] = png.data[i * 4] * 256 + png.data[i * 4 + 1] + png.data[i * 4 + 2] / 256 - 32768;
  index.set(`${x}/${y}`, tiles.length);
  tiles.push({ x, y, h });
}
log(`loaded ${tiles.length} z${ZMAX} tiles`);

/* ---------- flood fill from the sea ---------- */
function flood(L) {
  const wet = tiles.map(() => new Uint8Array(N));
  const QCAP = 1 << 24;
  const q = new Int32Array(QCAP * 2); // [slot, pixel] pairs, circular
  let head = 0, tail = 0, size = 0;
  const push = (s, p) => { if (size >= QCAP) throw new Error("flood queue overflow"); q[tail * 2] = s; q[tail * 2 + 1] = p; tail = (tail + 1) % QCAP; size++; };
  for (let s = 0; s < tiles.length; s++) { const h = tiles[s].h; for (let p = 0; p < N; p++) if (h[p] === 0) { wet[s][p] = 1; push(s, p); } } // sea pixels are exactly 0 m
  const tryPush = (s, p) => { if (!wet[s][p] && tiles[s].h[p] <= L) { wet[s][p] = 1; push(s, p); } };
  while (size) {
    const s = q[head * 2], p = q[head * 2 + 1]; head = (head + 1) % QCAP; size--;
    const px = p & 255, py = p >> 8, t = tiles[s];
    // 4-neighbours, hopping into the adjacent tile at borders
    if (px > 0) tryPush(s, p - 1); else { const n = index.get(`${t.x - 1}/${t.y}`); if (n !== undefined) tryPush(n, p + 255); }
    if (px < 255) tryPush(s, p + 1); else { const n = index.get(`${t.x + 1}/${t.y}`); if (n !== undefined) tryPush(n, p - 255); }
    if (py > 0) tryPush(s, p - 256); else { const n = index.get(`${t.x}/${t.y - 1}`); if (n !== undefined) tryPush(n, p + 255 * 256); }
    if (py < 255) tryPush(s, p + 256); else { const n = index.get(`${t.x}/${t.y + 1}`); if (n !== undefined) tryPush(n, p - 255 * 256); }
  }
  return wet;
}

/* ---------- colour ramp: depth (m) -> RGBA ---------- */
const RAMP = [[0, [150, 228, 238, 150]], [0.5, [92, 200, 226, 170]], [1.5, [52, 156, 214, 190]], [3, [34, 108, 192, 208]], [6, [26, 64, 150, 224]], [12, [20, 36, 110, 235]]];
function colour(d) {
  if (d <= 0) return [0, 0, 0, 0];
  for (let i = 1; i < RAMP.length; i++) if (d <= RAMP[i][0]) {
    const [d0, c0] = RAMP[i - 1], [d1, c1] = RAMP[i], f = (d - d0) / (d1 - d0);
    return c0.map((v, k) => Math.round(v + (c1[k] - v) * f));
  }
  return RAMP[RAMP.length - 1][1];
}

/* ---------- build one level ---------- */
function buildLevel(L, id) {
  log(`level ${L} m → ${id}`);
  const wet = flood(L);
  // depth grids at z13 (land only: sea pixels are not drawn)
  // Each tile carries depth d (mean depth of the flooded part) and coverage c (0..1 flooded share of the pixel).
  // At z13 a pixel is either flooded (c = 1) or dry. Parent pixels average their four children, so a thin river
  // fades at low zoom instead of being drawn as a fat solid line, but never disappears.
  let grids = new Map(); // "x/y" -> { d, c }
  let floodedPx = 0;
  for (let s = 0; s < tiles.length; s++) {
    const { x, y, h } = tiles[s]; let any = false; const d = new Float32Array(N), c = new Float32Array(N);
    for (let p = 0; p < N; p++) if (wet[s][p] && h[p] > 0) { d[p] = L - h[p]; if (d[p] > 0) { c[p] = 1; any = true; floodedPx++; } }
    if (any) grids.set(`${x}/${y}`, { d, c });
  }
  const outDir = path.join(OUT, id);
  fs.rmSync(outDir, { recursive: true, force: true });
  const written = {};
  for (let z = ZMAX; z >= ZMIN; z--) {
    written[z] = [];
    for (const [k, { d, c }] of grids) {
      const [x, y] = k.split("/").map(Number);
      const png = new PNG({ width: TS, height: TS });
      for (let p = 0; p < N; p++) {
        const col = colour(d[p]), f = c[p] > 0 ? 0.3 + 0.7 * c[p] : 0; // partial coverage stays visible but lighter
        png.data[p * 4] = col[0]; png.data[p * 4 + 1] = col[1]; png.data[p * 4 + 2] = col[2]; png.data[p * 4 + 3] = Math.round(col[3] * f);
      }
      const f = path.join(outDir, String(z), String(x), `${y}.png`);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, PNG.sync.write(png, { deflateLevel: 6 }));
      written[z].push(`${x}/${y}`);
    }
    if (z === ZMIN) break;
    const parents = new Map();
    for (const [k, { d, c }] of grids) {
      const [x, y] = k.split("/").map(Number), pk = `${x >> 1}/${y >> 1}`;
      if (!parents.has(pk)) parents.set(pk, { d: new Float32Array(N), c: new Float32Array(N) });
      const { d: pd, c: pc } = parents.get(pk), ox = (x & 1) * 128, oy = (y & 1) * 128;
      for (let py = 0; py < 128; py++) for (let px = 0; px < 128; px++) {
        let cs = 0, ds = 0;
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) { const i = (py * 2 + dy) * TS + px * 2 + dx; cs += c[i]; ds += d[i] * c[i]; }
        if (cs > 0) { pc[(oy + py) * TS + ox + px] = cs / 4; pd[(oy + py) * TS + ox + px] = ds / cs; }
      }
    }
    grids = parents;
  }
  const areaKm2 = (floodedPx * (19.109 * Math.cos((25 * Math.PI) / 180)) ** 2) / 1e6; // z13 pixel ≈ 17.3 m at 25°N
  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify({
    id, level_m: L, datum: "mean sea level (EGM2008)", minzoom: ZMIN, maxzoom: ZMAX, tileSize: TS,
    method: "4-connected flood fill from sea; depth = level − DEM height",
    dem: manifest.sources, demBuilt: manifest.built, built: new Date().toISOString(), approxFloodedAreaKm2: Math.round(areaKm2), tiles: written,
  }));
  log(`  ${id}: ~${Math.round(areaKm2)} km² flooded, ${written[ZMAX].length} z${ZMAX} tiles`);

  // index.json lets the portal list what has been built
  const indexFile = path.join(OUT, "index.json");
  const idx = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, "utf8")) : { levels: [] };
  idx.levels = idx.levels.filter((l) => l.id !== id).concat({ id, level_m: L, approxFloodedAreaKm2: Math.round(areaKm2), minzoom: ZMIN, maxzoom: ZMAX }).sort((a, b) => a.level_m - b.level_m);
  idx.datum = "mean sea level (EGM2008)";
  fs.writeFileSync(indexFile, JSON.stringify(idx));
}

for (const L of levels) buildLevel(L, singleId && levels.length === 1 ? singleId : `${idPrefix}_${String(L).replace(".", "p")}m`);
