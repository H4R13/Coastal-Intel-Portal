/**
 * Turn the NDMA coastal eutrophication package (DMJM, delivered 2026-11-06) into what the portal serves:
 *
 *   node server/load-ndma.mjs ["C:/path/to/NDMA_Coastal_Eutrophication"]      (npm run load:ndma)
 *
 * Reads, from the package's Data/01_Past_Present/History_Monthly and History_Annual, the GeoTIFFs of satellite
 * chlorophyll-a (OC-CCI, mg m-3) and sea-surface temperature (NOAA OISST, degrees C): 336 months 1998-01 to 2025-12 and
 * 28 annual means (annual chlorophyll is the geometric mean of the months, SST the arithmetic mean; the package needs at
 * least 9 valid months). Common grid EPSG:4326, origin 60E/27N, 0.036 degrees, 278 x 195 cells, NoData -9999.
 *
 * Writes into data/ndma/ (kept out of git like the other data; nothing goes into PostgreSQL):
 *   <set>/<key>.png     a picture of each month or year, coloured with the ramp below, NoData transparent
 *   <set>.f32           every value (NaN = no value), [frame][row][col], for the pixel look-up of the API
 *   manifest.json       frames, grid, ramps, the regional monthly means (the package's own CSV) and the package's limits
 * Sets: chl (monthly), sst (monthly), chl_year, sst_year. Values are never interpolated or filled: a pixel with no value
 * stays transparent, and NoData is never turned into zero. The package's licence terms apply to the figures.
 */
import fs from "node:fs"; import path from "node:path";
import { fromFile } from "geotiff";
import sharp from "sharp";

const root = path.resolve(process.argv[2] ?? "Other Data/NDMA/NDMA_Coastal_Eutrophication");
const H = path.join(root, "Data", "01_Past_Present");
if (!fs.existsSync(path.join(H, "History_Monthly"))) { console.error(`Data/01_Past_Present/History_Monthly not found in ${root}`); process.exit(1); }
const out = path.resolve("data", "ndma");
const W = 278, HT = 195, N = W * HT, NODATA = -9999;

/** Colour ramps. Chlorophyll on a log scale (as the Nutrients layers draw it), SST linear. Sent to the browser for its legend. */
const RAMPS = {
  chl: { log: true, unit: "mg/m³", stops: [[0.1, "#2c1f6b"], [0.3, "#1f4fa3"], [1, "#1aa3b8"], [3, "#4fbf5a"], [10, "#e6d43a"], [30, "#e2582c"]] },
  sst: { log: false, unit: "°C", stops: [[18, "#2c1f6b"], [22, "#1f6fb0"], [26, "#2fb6a3"], [29, "#e6d43a"], [32, "#d0442a"]] },
  /* 2026-11-11: trends, scenarios and the relative-concern snapshot */
  trend_chl: { log: false, unit: "% per decade", stops: [[-40, "#2f5fbf"], [-15, "#86a9e0"], [0, "#dfe7e6"], [15, "#e7b65c"], [40, "#d0542c"]] },
  trend_sst: { log: false, unit: "°C per decade", stops: [[-0.4, "#2f5fbf"], [-0.15, "#86a9e0"], [0, "#dfe7e6"], [0.15, "#e7b65c"], [0.4, "#d0542c"]] },
  change_chl: { log: false, unit: "%", stops: [[-30, "#2f5fbf"], [-10, "#86a9e0"], [0, "#dfe7e6"], [10, "#e7b65c"], [30, "#d0542c"]] },
  change_sst: { log: false, unit: "°C", stops: [[0, "#dfe7e6"], [0.5, "#e7d38a"], [1, "#e7b65c"], [1.5, "#e07b3c"], [2.5, "#c0392b"]] },
  concern: { log: false, unit: "class", classes: true, stops: [[1, "#2c7bb6"], [2, "#abd9e9"], [3, "#ffffbf"], [4, "#fdae61"], [5, "#d7191c"]] },
};
const hex = (c) => [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16));
function colour(ramp, v) {
  const { stops, log } = RAMPS[ramp], t = (x) => (log ? Math.log(x) : x), x = t(Math.max(stops[0][0], Math.min(stops.at(-1)[0], v)));
  for (let k = 1; k < stops.length; k++) {
    const [a, ca] = stops[k - 1], [b, cb] = stops[k];
    if (x <= t(b)) { const f = (x - t(a)) / (t(b) - t(a) || 1), A = hex(ca), B = hex(cb); return A.map((q, j) => Math.round(q + (B[j] - q) * f)); }
  }
  return hex(stops.at(-1)[1]);
}

const SETS = [
  { id: "chl", ramp: "chl", dir: "History_Monthly", file: (k) => `NDMA_chl_${k}_EPSG4326_0036deg.tif`, keys: months() },
  { id: "sst", ramp: "sst", dir: "History_Monthly", file: (k) => `NDMA_sst_${k}_EPSG4326_0036deg.tif`, keys: months() },
  { id: "chl_year", ramp: "chl", dir: "History_Annual", file: (k) => `NDMA_chl_${k}_EPSG4326_0036deg.tif`, keys: years() },
  { id: "sst_year", ramp: "sst", dir: "History_Annual", file: (k) => `NDMA_sst_${k}_EPSG4326_0036deg.tif`, keys: years() },
];
/* 2026-11-11: the package's static products (Data/02_Trends, 03_Projections_2050/Assisted_Quarterdeg = its preferred scenario
   display, 04_Risk_Index hydro-routing version = its preferred concern map). `base` is relative to Data/; `as` turns the stored value
   into the one shown (chlorophyll Sen slope log10/year -> % per decade = 100 (10^(10 s) - 1), SST slope per year -> per decade), and
   the pixel look-up returns the shown value. `q` names the BH q-value raster of a trend, to count where a trend is significant. */
const D = (p) => path.join(root, "Data", p);
const SCEN = ["ssp245_2030", "ssp245_2040", "ssp245_2050", "ssp585_2030", "ssp585_2040", "ssp585_2050"];
SETS.push(
  { id: "trend_chl", ramp: "trend_chl", base: "02_Trends", file: (k) => `NDMA_chl_${k}_sen_slope_1998_2025.tif`, q: (k) => `NDMA_chl_${k}_q_bh_1998_2025.tif`, keys: ["winter", "summer"], as: (v) => 100 * (10 ** (10 * v) - 1) },
  { id: "trend_sst", ramp: "trend_sst", base: "02_Trends", file: (k) => `NDMA_sst_${k}_sen_slope_1998_2025.tif`, q: (k) => `NDMA_sst_${k}_q_bh_1998_2025.tif`, keys: ["winter", "summer"], as: (v) => 10 * v },
  { id: "proj_chl", ramp: "chl", base: "03_Projections_2050/Assisted_Quarterdeg", file: (k) => `NDMA_chlos_${k}_median.tif`, keys: SCEN },
  { id: "proj_sst", ramp: "sst", base: "03_Projections_2050/Assisted_Quarterdeg", file: (k) => `NDMA_tos_${k}_median.tif`, keys: SCEN },
  { id: "change_chl", ramp: "change_chl", base: "03_Projections_2050/Assisted_Quarterdeg", file: () => "NDMA_chlos_2050_ssp585_change.tif", keys: ["ssp585_2050"] },
  { id: "change_sst", ramp: "change_sst", base: "03_Projections_2050/Assisted_Quarterdeg", file: () => "NDMA_tos_2050_ssp585_change.tif", keys: ["ssp585_2050"] },
  { id: "concern", ramp: "concern", base: "04_Risk_Index", file: () => "NDMA_risk_class_2025-01_hydrorivers_provisional.tif", keys: ["2025-01"], nodata: 65535, ok: (v) => v >= 1 && v <= 5 },
);
function months() { const m = []; for (let y = 1998; y <= 2025; y++) for (let k = 1; k <= 12; k++) m.push(`${y}-${String(k).padStart(2, "0")}`); return m; }
function years() { return Array.from({ length: 28 }, (_, k) => String(1998 + k)); }

const manifest = { grid: { crs: "EPSG:4326", west: 60, north: 27, cell_deg: 0.036, width: W, height: HT, east: 60 + W * 0.036, south: 27 - HT * 0.036 }, ramps: RAMPS, sets: {}, regional: [], notes: null };
fs.mkdirSync(out, { recursive: true });

for (const s of SETS) {
  fs.mkdirSync(path.join(out, s.id), { recursive: true });
  const all = new Float32Array(s.keys.length * N).fill(NaN), frames = [];
  let lo = Infinity, hi = -Infinity;
  for (let f = 0; f < s.keys.length; f++) {
    const key = s.keys[f], file = s.base ? path.join(D(s.base), s.file(key)) : path.join(H, s.dir, s.file(key));
    if (!fs.existsSync(file)) throw new Error(`${path.relative(root, file)} is missing: nothing is substituted`);
    const img = await (await fromFile(file)).getImage();
    if (img.getWidth() !== W || img.getHeight() !== HT) throw new Error(`${key}: expected ${W}x${HT}, found ${img.getWidth()}x${img.getHeight()}`);
    const [band] = await img.readRasters({ interleave: false });
    const rgba = Buffer.alloc(N * 4);
    let valid = 0;
    const counts = s.ramp === "concern" ? {} : null;
    for (let i = 0; i < N; i++) {
      const raw = band[i];
      if (!Number.isFinite(raw) || raw === (s.nodata ?? NODATA) || (s.ramp === "chl" && raw <= 0) || (s.ok && !s.ok(raw))) continue; // no value: stays transparent and NaN
      const v = s.as ? s.as(raw) : raw;
      if (counts) counts[raw] = (counts[raw] ?? 0) + 1;
      all[f * N + i] = v; valid++; lo = Math.min(lo, v); hi = Math.max(hi, v);
      const [r, g, b] = colour(s.ramp, v);
      rgba.set([r, g, b, 255], i * 4);
    }
    await sharp(rgba, { raw: { width: W, height: HT, channels: 4 } }).png({ compressionLevel: 9 }).toFile(path.join(out, s.id, `${key}.png`));
    const fr = { key, valid };
    if (counts) fr.classes = counts;
    if (s.q) { // a trend: where the package could test it (q exists) and where q < 0.05; all-NoData q means no inference, not "no trend"
      const qf = path.join(D(s.base), s.q(key));
      const [qb] = await (await (await fromFile(qf)).getImage()).readRasters({ interleave: false });
      let tested = 0, sig = 0, up = 0, down = 0;
      for (let i = 0; i < N; i++) { const q = qb[i]; if (!Number.isFinite(q) || q === NODATA || Number.isNaN(all[f * N + i])) continue; tested++; if (q < 0.05) { sig++; all[f * N + i] > 0 ? up++ : down++; } }
      Object.assign(fr, { tested, significant: sig, up, down });
    }
    frames.push(fr);
  }
  fs.writeFileSync(path.join(out, `${s.id}.f32`), Buffer.from(all.buffer));
  manifest.sets[s.id] = { frames, min: lo, max: hi };
  console.log(`${s.id}: ${frames.length} frames, ${lo.toFixed(3)} to ${hi.toFixed(3)}, valid pixels ${Math.min(...frames.map((x) => x.valid))}-${Math.max(...frames.map((x) => x.valid))} of ${N}`);
}

/* the package's own regional monthly means (acquisition rectangle, not an EEZ) */
const csv = fs.readFileSync(path.join(root, "Reports", "Historical_Regional_Monthly_1998_2025.csv"), "utf8").trim().split(/\r?\n/).slice(1);
const rows = new Map();
for (const line of csv) {
  const [month, variable, mean, valid, frac] = line.split(",");
  if (!rows.has(month)) rows.set(month, { month });
  rows.get(month)[variable] = { mean: +mean, valid: +valid, fraction: +frac };
}
manifest.regional = [...rows.values()].sort((a, b) => a.month.localeCompare(b.month));
manifest.notes = {
  package: "NDMA coastal eutrophication and plankton screening, version I-1.0 (DMJM), handover 2026-11-06",
  label: "Satellite-derived, not field-calibrated",
  chl: "OC-CCI v6 monthly chlorophyll-a, about 4 km, mg m-3; a monthly value needs positive retrievals and at least 5 sensor observations (not 5 distinct days). Biomass proxy: no species, toxin, nutrient or oxygen information.",
  sst: "NOAA/NCEI OISST V2.1 monthly, 0.25 degree analysis mapped to the 0.036 degree grid: the finer cells do not add detail. A blend of satellite and in-situ data.",
  annual: "Annual chlorophyll = geometric mean of the monthly values, annual SST = arithmetic mean; at least 9 valid months per pixel. Missing summer months can bias them.",
  area: "Acquisition rectangle 60-70 E, 20-27 N, not an approved Pakistan EEZ. The record ends in December 2025: not today's conditions.",
  gaps: "No value means no valid retrieval (cloud, haze, sediment) or land, never zero. Nothing is interpolated.",
  trend: "Sen slope of the seasonal means 1998-2025 (summer = June-September, winter = December-March), only where at least 22 of the 28 seasons are complete. Chlorophyll is shown as % change per decade (the package stores log10 per year), SST as °C per decade. Significance: Hamed-Rao adjusted test, Benjamini-Hochberg q < 0.05 per variable and season; exploratory, not a prediction or a cause. Where the package could not test a pixel there is no inference, which is not evidence of no trend.",
  scenario: "Median of three climate models (GFDL-ESM4, CESM2-WACCM, MIROC-ES2L) for SSP2-4.5 and SSP5-8.5, anchored on the 1998-2014 satellite climatology (SST: OISST 0.25 degree; chlorophyll: satellite where available, model-assisted elsewhere). The labels 2030, 2040 and 2050 are the windows 2021-2040, 2031-2050 and 2041-2060, which overlap. Not a forecast; three models are a small ensemble and coarse model changes do not resolve the coast.",
  change: "2050 window (2041-2060) under SSP5-8.5 against the 1998-2014 baseline: chlorophyll as % change of the median, SST as °C difference. Model-derived.",
  concern: "Relative concern, January 2025 only (hydro-routing version, provisional): a weighted screening score of chlorophyll anomaly (0.35), daily chlorophyll exceedance (0.25), SST anomaly (0.10), river proximity (0.15) and land use (0.15), in five classes from very low to very high RELATIVE concern. Not a safety rating, not TRIX (no verified nutrient or oxygen data went into it), uncalibrated weights; not to be carried to other months.",
};
fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest));
console.log(`Wrote data/ndma (${(fs.readdirSync(out).length)} entries). Restart nothing: the server reads it on demand.`);
