/**
 * Turn the INJA coastal erosion and accretion package (2026-11-10, Landsat waterline method, Jiwani to Sir Creek) into what
 * the portal draws:
 *
 *   node server/load-inja.mjs ["Other Data/INJA/erosion&accretion"] [--only=ssp245]      (npm run load:inja)
 *
 * Reads the package's STRETCHED rasters (30 m grid, World Cylindrical Equal Area; each cell = the % of the surrounding 1 km
 * that eroded or accreted in the interval, which is what the package made them for: to be drawn) and area_by_interval_km2.csv.
 * Writes into data/inja/ (kept out of git, nothing goes into PostgreSQL):
 *   <id>.png       the map, coloured, rows laid out for Web Mercator like the other package maps (server/amib-render.mjs)
 *   catalog.json   the layers (same shape as the AMIB catalog; server/api.mjs adds them to it), their image files and the chart series
 * Nothing is filled or interpolated: a cell with no change is transparent, NoData is never turned into a value.
 * Intervals are named by the last year of the later 5-year block (1986-1990 -> 1991-1995 is "1995"; projected steps 2030 ... 2050).
 * SSP3-7.0 exists in the package but the portal's scenario keys are SSP1-2.6 / 2.5 / 5-8.5, so it is left out of the maps.
 * Numbers and texts of the package are not changed.
 */
import fs from "node:fs"; import path from "node:path";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { fromFile } from "geotiff";
import sharp from "sharp";

const R = 6378137, CELL = 5; // 30 m cells averaged 5 × 5 → 150 m
const SSPS = ["ssp126", "ssp245", "ssp585"];

/* ---------- colours ---------- */
const hex = (c) => [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16));
const EROSION = [[0.5, "#ffe066", 0.45], [5, "#ffb000", 0.65], [15, "#ff6a00", 0.8], [30, "#e3170a", 0.92], [50, "#7a0000", 0.98]];
const ACCRETION = [[0.5, "#d9f99d", 0.45], [5, "#8bd450", 0.65], [15, "#34b34a", 0.8], [30, "#0c8a3a", 0.92], [50, "#035a28", 0.98]];
function ramp(stops, v) { // [r, g, b, a 0-255] for a value, clamped at both ends; 0 alpha under the first stop
  if (!(v >= stops[0][0])) return null;
  for (let k = 1; k < stops.length; k++) {
    const [a, ca, aa] = stops[k - 1], [b, cb, ab] = stops[k];
    if (v <= b) { const f = (v - a) / (b - a), A = hex(ca), B = hex(cb); return [...A.map((q, j) => Math.round(q + (B[j] - q) * f)), Math.round(255 * (aa + (ab - aa) * f))]; }
  }
  const [, c, al] = stops.at(-1); return [...hex(c), Math.round(255 * al)];
}
const colourOf = { erosion: (v) => ramp(EROSION, v), accretion: (v) => ramp(ACCRETION, v), net: (v) => (v < 0 ? ramp(EROSION, -v) : ramp(ACCRETION, v)) };

/* ---------- worker: one pair of rasters → three pictures ---------- */
async function readGrid(file, W, nyAgg, H0) {
  const tiff = await fromFile(file), img = await tiff.getImage(), w = img.getWidth(), h = img.getHeight();
  const agg = new Float32Array(Math.ceil(w / CELL) * Math.ceil(h / CELL)), aw = Math.ceil(w / CELL), BAND = 1024;
  for (let y0 = 0; y0 < h; y0 += BAND) {
    const y1 = Math.min(h, y0 + BAND), d = (await img.readRasters({ window: [0, y0, w, y1], samples: [0] }))[0];
    for (let r = y0; r < y1; r++) {
      const base = Math.floor(r / CELL) * aw, row = (r - y0) * w;
      for (let c = 0; c < w; c++) { const v = d[row + c]; if (v > 0) agg[base + Math.floor(c / CELL)] += v; } // NoData (-9999) and 0 both mean no change
    }
  }
  for (let i = 0; i < agg.length; i++) agg[i] /= CELL * CELL;
  return { agg, aw, ah: Math.ceil(h / CELL), bbox: img.getBoundingBox() };
}

async function drawPair(job) {
  const { eroFile, accFile, outs } = job;
  const E = await readGrid(eroFile), A = await readGrid(accFile);
  const [x0, y0, x1, y1] = E.bbox, { aw, ah } = E;
  const lon0 = (x0 / R) * 180 / Math.PI, lon1 = (x1 / R) * 180 / Math.PI;
  const lat = (y) => (Math.asin(y / R) * 180) / Math.PI, merc = (deg) => Math.asinh(Math.tan((deg * Math.PI) / 180));
  const latN = lat(y1), latS = lat(y0), yN = merc(latN), yS = merc(latS);
  const H = Math.round((aw * (yN - yS)) / (((lon1 - lon0) * Math.PI) / 180));
  const res = {};
  for (const [measure, file] of Object.entries(outs)) {
    const buf = Buffer.alloc(aw * H * 4);
    for (let j = 0; j < H; j++) {
      const la = (Math.atan(Math.sinh(yN - ((j + 0.5) / H) * (yN - yS))) * 180) / Math.PI;
      const f = ((y1 - R * Math.sin((la * Math.PI) / 180)) / (y1 - y0)) * ah - 0.5; // row position in the equal-area grid
      const r0 = Math.max(0, Math.min(ah - 1, Math.floor(f))), r1 = Math.min(ah - 1, r0 + 1), t = Math.min(1, Math.max(0, f - r0));
      for (let i = 0; i < aw; i++) {
        const e = E.agg[r0 * aw + i] * (1 - t) + E.agg[r1 * aw + i] * t, a = A.agg[r0 * aw + i] * (1 - t) + A.agg[r1 * aw + i] * t;
        const v = measure === "erosion" ? e : measure === "accretion" ? a : a - e, px = colourOf[measure](v);
        if (px) { const o = (j * aw + i) * 4; buf[o] = px[0]; buf[o + 1] = px[1]; buf[o + 2] = px[2]; buf[o + 3] = px[3]; }
      }
    }
    await sharp(buf, { raw: { width: aw, height: H, channels: 4 } }).png({ compressionLevel: 9 }).toFile(file);
    res[measure] = file;
  }
  return { bounds: [lon0, latS, lon1, latN], res };
}

if (!isMainThread) {
  parentPort.on("message", async (job) => {
    try { parentPort.postMessage({ ok: true, ...(await drawPair(job)), job }); } catch (e) { parentPort.postMessage({ ok: false, error: e.stack, job }); }
  });
} else {
  await main();
}

/* ---------- main ---------- */
async function main() {
  const args = process.argv.slice(2), only = args.find((a) => a.startsWith("--only="))?.slice(7);
  const root = path.resolve(args.find((a) => !a.startsWith("--")) ?? "Other Data/INJA/erosion&accretion");
  const S = path.join(root, "STRETCHED", "STRETCHED"), PI = path.join(S, "per_interval"), WL = path.join(root, "waterline");
  if (!fs.existsSync(PI)) { console.error(`STRETCHED/STRETCHED/per_interval not found in ${root}`); process.exit(1); }
  const out = path.resolve("data", "inja"); fs.mkdirSync(out, { recursive: true });

  const OBS = ["1986-1990_to_1991-1995", "1991-1995_to_1996-2000", "1996-2000_to_2001-2005", "2001-2005_to_2006-2010", "2006-2010_to_2011-2015", "2011-2015_to_2016-2020", "2016-2020_to_2021-2025"];
  const PROJ = ["2021-2025_to_2026-2030", "2026-2030_to_2031-2035", "2031-2035_to_2036-2040", "2036-2040_to_2041-2045", "2041-2045_to_2046-2050"];
  const endYear = (iv) => +iv.slice(-4);
  const jobs = []; // each job: a pair of rasters and the three pictures made from it
  const outs = (name) => Object.fromEntries(["erosion", "accretion", "net"].map((m) => [m, path.join(out, `${name}_${m}.png`)]));
  for (const iv of OBS) jobs.push({ name: `iv_obs_${endYear(iv)}`, eroFile: path.join(PI, "erosion", `STRETCH_EROSION_${iv}.tif`), accFile: path.join(PI, "accretion", `STRETCH_ACCRETION_${iv}.tif`) });
  for (const s of SSPS) for (const iv of PROJ) jobs.push({ name: `iv_${s}_${endYear(iv)}`, eroFile: path.join(PI, "erosion", `STRETCH_EROSION_${iv}_${s}.tif`), accFile: path.join(PI, "accretion", `STRETCH_ACCRETION_${iv}_${s}.tif`) });
  jobs.push({ name: "total_obs", eroFile: path.join(S, "STRETCH_EROSION_1986-2025_observed.tif"), accFile: path.join(S, "STRETCH_ACCRETION_1986-2025_observed.tif") });
  for (const s of SSPS) jobs.push({ name: `total_${s}`, eroFile: path.join(S, `STRETCH_EROSION_1986-2050_${s}.tif`), accFile: path.join(S, `STRETCH_ACCRETION_1986-2050_${s}.tif`) });
  const todo = jobs.filter((j) => (!only || j.name.includes(only) || j.name.endsWith("obs")) && (j.outs = outs(j.name)));
  for (const j of todo) for (const f of [j.eroFile, j.accFile]) if (!fs.existsSync(f)) { console.error(`Missing ${f}`); process.exit(1); }

  /* draw, three at a time */
  let bounds = null, done = 0;
  const queue = [...todo];
  const t0 = Date.now();
  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, () => new Promise((resolve, reject) => {
    const w = new Worker(new URL(import.meta.url));
    const next = () => { const j = queue.shift(); if (!j) { w.terminate(); resolve(); } else w.postMessage(j); };
    w.on("message", (m) => {
      if (!m.ok) { reject(new Error(`${m.job.name}: ${m.error}`)); return; }
      bounds = m.bounds; done++;
      console.log(`  ${String(done).padStart(2)}/${todo.length} ${m.job.name}  (${Math.round((Date.now() - t0) / 1000)} s)`);
      next();
    });
    w.on("error", reject);
    next();
  })));

  /* the catalog */
  const g = "J  Coastal erosion and accretion";
  const legendOf = (m) => (m === "erosion" ? EROSION : m === "accretion" ? ACCRETION : null);
  const legend = (m) => m === "net"
    ? [[-50, EROSION.at(-1)[1]], [-30, EROSION[3][1]], [-15, EROSION[2][1]], [-5, EROSION[1][1]], [0, "#f2f2f2"], [5, ACCRETION[1][1]], [15, ACCRETION[2][1]], [30, ACCRETION[3][1]], [50, ACCRETION.at(-1)[1]]].map(([value, color]) => ({ value, color }))
    : legendOf(m).map(([value, color]) => ({ value, color }));
  const NAMES = { erosion: "Land lost to the sea (erosion)", accretion: "Land gained from the sea (accretion)", net: "Net change (gain minus loss)" };
  const rel = (name, m) => `${name}_${m}.png`;
  const layers = [], files = {};
  const pushLayer = (l) => layers.push({ kind: "continuous", note: "share of the surrounding 1 km that changed, drawn at 150 m", what: "Waterline change from Landsat, package of the INJA team", group: g, product: "J", bounds, classes: null, ...l });
  for (const m of ["erosion", "accretion", "net"]) {
    for (const s of SSPS) {
      const id = `J:interval:${m}_${s}`;
      const names = [...OBS.map((iv) => `iv_obs_${endYear(iv)}`), ...PROJ.map((iv) => `iv_${s}_${endYear(iv)}`)];
      const steps = [...OBS.map((iv) => ({ t: endYear(iv), kind: "observed" })), ...PROJ.map((iv) => ({ t: endYear(iv), kind: "projected" }))];
      const keep = names.map((n, i) => ({ n, i })).filter(({ n }) => fs.existsSync(path.join(out, rel(n, m))));
      if (!keep.length) continue;
      files[id] = keep.map(({ n }) => rel(n, m));
      pushLayer({ id, name: `${NAMES[m]} | ${s} | each 5-year step`, type: "raster-timeseries", label: "OBSERVED", steps: keep.map(({ i }) => steps[i]), units: "% of the surrounding 1 km", legend: legend(m), scenario: s, subgroup: "Year by year", time_step: "year" });
    }
    for (const [key, year, scenario] of [["obs", 2025, "observed"], ...SSPS.map((s) => [s, 2050, s])]) {
      const n = `total_${key}`, id = `J:total:${m}_${key}`;
      if (!fs.existsSync(path.join(out, rel(n, m)))) continue;
      files[id] = [rel(n, m)];
      pushLayer({ id, name: `${NAMES[m]} | 1986 to ${year} | ${scenario}`, type: "raster", label: key === "obs" ? "OBSERVED" : "MODELLED", year, units: "% of the surrounding 1 km", legend: legend(m), scenario, subgroup: "Whole period" });
    }
  }

  /* the chart series, from the package's own table (km² per year = the interval's area / 5) */
  const rows = fs.readFileSync(path.join(WL, "area_by_interval_km2.csv"), "utf8").trim().split(/\r?\n/).slice(1).map((l) => l.split(","));
  const ZONES = ["Pakistan coast (whole extent)", "Sindh coast (Karachi + Indus Delta)", "Indus Delta (whole)", "S1 Karachi", "S2 Indus Delta West", "S3 Indus Delta East", "Makran coast (whole)", "B1 Hub-Sonmiani-Miani Hor", "B2 Ormara-Kalmat-Hingol", "B3 Pasni", "B4 Gwadar", "B5 Jiwani-Gwatar"];
  const SC = { "observed (Landsat)": "observed", "SSP1-2.6": "ssp126", "SSP2-4.5": "ssp245", "SSP5-8.5": "ssp585" };
  const MEAS = { erosion: [6, "Land lost to the sea (erosion), km² per year"], accretion: [7, "Land gained from the sea (accretion), km² per year"], net: [8, "Net change (gain minus loss), km² per year"] };
  const series = {};
  for (const [m, [col, title]] of Object.entries(MEAS)) {
    const list = [];
    for (const zone of ZONES) for (const [csvSc, sc] of Object.entries(SC)) {
      const pick = rows.filter((r) => r[3] === zone && r[1] === csvSc).sort((a, b) => a[2].localeCompare(b[2]));
      if (!pick.length) continue;
      list.push({ zone, scenario: sc, label: sc === "observed" ? "OBSERVED" : "MODELLED", year: pick.map((r) => endYear(r[2].replace(/ to /, "_to_"))), p50: pick.map((r) => Math.round((+r[col] / CELL) * 100) / 100) });
    }
    series[title] = { unit: "km² per year", series: list };
  }

  const info = {
    source: "Coastal erosion and accretion package from the INJA team (Landsat waterline, 30 m, Jiwani to Sir Creek), received 2026-11-10",
    accuracy: "Water against land 93.2 % overall against independent maps (kappa 0.83); 93.1 ± 4.2 % (Sindh) and 95.7 ± 2.8 % (Makran) on 120 labelled points each. Land-only erosion is the least certain number (part of the mudflat is mapped as land). Package's own validation: validation/VALIDATION_SUMMARY.md.",
    projection: "Cell model to 2050 under SSP1-2.6, 2-4.5, 3-7.0 and 5-8.5; calibrated best estimate 2026-2050 for the whole coast -802 km² (range -894 to -661) by the 2-class waterline table.",
  };
  fs.writeFileSync(path.join(out, "catalog.json"), JSON.stringify({ layers, files, series, info, labels: {} }));
  console.log(`Wrote ${layers.length} layers, ${Object.keys(series).length} charts, ${done} picture sets to ${out}`);
}
