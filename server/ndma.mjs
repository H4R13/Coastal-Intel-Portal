/**
 * Serves the NDMA coastal eutrophication package as prepared by server/load-ndma.mjs (data/ndma/).
 *   /api/ndma/manifest                    frames, grid, colour ramps, regional monthly means, the package's limits
 *   /api/ndma/<set>/<key>.png             one picture (sets: chl, sst, chl_year, sst_year; trend_chl, trend_sst, proj_chl,
 *                                         proj_sst, change_chl, change_sst, concern: whatever manifest.json lists)
 *   /api/ndma/pixel/<set>?lat=&lon=       every frame's value at the pixel holding that point (null = no value)
 * No database: the files are read from disk (the grids once, on first use).
 */
import fs from "node:fs"; import fsp from "node:fs/promises"; import { fileURLToPath } from "node:url";

const DIR = fileURLToPath(new URL("../data/ndma/", import.meta.url));
const isSet = (man, set) => Object.hasOwn(man.sets, set); // every set the loader wrote (history, trends, scenarios, concern)
const grids = new Map();
let manifest = null;

const readManifest = () => (manifest ??= fs.existsSync(DIR + "manifest.json") ? JSON.parse(fs.readFileSync(DIR + "manifest.json", "utf8")) : null);
async function grid(set) {
  if (!grids.has(set)) grids.set(set, fsp.readFile(DIR + set + ".f32").then((b) => new Float32Array(b.buffer, b.byteOffset, b.length / 4)));
  return grids.get(set);
}

/** { status, type, body } for an /api/ndma/... request, or null when the path is not this module's. */
export async function ndmaRoute(path, params) {
  const m = path.match(/^\/api\/ndma\/(.+)$/);
  if (!m) return null;
  const rest = m[1], man = readManifest();
  const json = (status, obj) => ({ status, type: "application/json; charset=utf-8", body: JSON.stringify(obj), headers: { "Cache-Control": "no-cache" } });
  if (!man) return json(404, { error: "NDMA data not loaded (npm run load:ndma)" });
  if (rest === "manifest") return json(200, man);
  if (rest === "insitu") { // measured-in-the-water rows (server/load-insitu.mjs); optional
    if (!fs.existsSync(DIR + "insitu.json")) return json(404, { error: "No in-situ data loaded (npm run load:insitu)" });
    if (fs.existsSync(DIR + "insitu.json.gz") && fs.statSync(DIR + "insitu.json.gz").mtimeMs >= fs.statSync(DIR + "insitu.json").mtimeMs) // the loader's gzipped copy (~1/8 the size); every browser takes gzip
      return { status: 200, type: "application/json; charset=utf-8", body: await fsp.readFile(DIR + "insitu.json.gz"), headers: { "Cache-Control": "no-cache", "Content-Encoding": "gzip", Vary: "Accept-Encoding" } };
    return { status: 200, type: "application/json; charset=utf-8", body: await fsp.readFile(DIR + "insitu.json"), headers: { "Cache-Control": "no-cache" } };
  }
  const png = rest.match(/^([a-z_]+)\/([a-z0-9_-]+)\.png$/); // keys: 1998, 1998-01, winter, ssp245_2050, 2025-01
  if (png && isSet(man, png[1])) {
    if (!man.sets[png[1]].frames.some((f) => f.key === png[2])) return json(404, { error: "No such frame" });
    return { status: 200, type: "image/png", body: await fsp.readFile(`${DIR}${png[1]}/${png[2]}.png`), headers: { "Cache-Control": "public, max-age=86400" } };
  }
  const px = rest.match(/^pixel\/([a-z_]+)$/);
  if (px && isSet(man, px[1])) {
    const lat = +params.get("lat"), lon = +params.get("lon"), g = man.grid;
    const col = Math.floor((lon - g.west) / g.cell_deg), row = Math.floor((g.north - lat) / g.cell_deg);
    if (!(col >= 0 && col < g.width && row >= 0 && row < g.height)) return json(404, { error: "Outside the grid" });
    const all = await grid(px[1]), n = g.width * g.height, frames = man.sets[px[1]].frames;
    const values = frames.map((_, f) => { const v = all[f * n + row * g.width + col]; return Number.isNaN(v) ? null : +v.toFixed(px[1].startsWith("chl") ? 4 : 3); });
    return json(200, { set: px[1], col, row, lat: +(g.north - (row + 0.5) * g.cell_deg).toFixed(4), lon: +(g.west + (col + 0.5) * g.cell_deg).toFixed(4), keys: frames.map((f) => f.key), values });
  }
  return json(404, { error: "Unknown NDMA route" });
}
