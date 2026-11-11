/**
 * Nutrients & Plankton: DMJM's Indus Delta Observatory data (server/load-nutrients.mjs), laid out the way the ocean
 * monitoring package is (src/oceanMonitoring/): a layer list on the left, a title card at the top, a month slider at the
 * bottom with the portal's layer dock above it, and the layer's findings and charts on the right. This module is the
 * controller: which layer, month and monitoring point are chosen, the figures worked out from the data, and what is
 * drawn on the portal's map. Nutrients.jsx draws the screens from its state (useNp).
 *
 * The data has no years on the portal's timeline and no emissions scenarios: one satellite value a month at five fixed
 * water pixels (January 2020 to April 2026), one chlorophyll map (April 2026) and long-term nutrient averages. So the
 * slider runs over those months, and the dots on the map, the findings and the charts all follow it.
 * Months without a valid satellite reading stay gaps; nothing is interpolated or filled in.
 */
import { useSyncExternalStore } from "react";
import maplibregl from "maplibre-gl";

/* ---------------- the left list: tabs → groups → layers, as the ocean package arranges its own */
export const TABS = [
  { id: "history", title: "Algae and sea heat, 1998-2025", icon: "wave", color: "#2B6CB0", tc: "#7fb6ee", steps: "Satellite · 28 years · NDMA package",
    groups: [{ title: "Month by month", layers: ["hist_chl", "hist_sst"] }, { title: "Year by year", layers: ["hist_chl_year", "hist_sst_year"] }], first: "hist_chl" },
  { id: "outlook", title: "Trends and 2050 scenarios", icon: "pulse", color: "#9A3B2E", tc: "#f09a86", steps: "Satellite trends · climate models · NDMA package",
    groups: [{ title: "Trend 1998-2025, by season", layers: ["trend_sst", "trend_chl"] }, { title: "Model scenarios (three models)", layers: ["proj_sst", "proj_chl", "change_sst", "change_chl"] }, { title: "Screening snapshot", layers: ["concern"] }], first: "trend_sst" },
  { id: "insitu", title: "Seen and measured in the water", icon: "dots", color: "#7A4FA0", tc: "#c3a1ea", steps: "In situ · open sources · NDMA package",
    groups: [{ title: "Records from open databases", layers: ["ins_plankton", "ins_measured"] }], first: "ins_plankton" },
  { id: "algae", title: "Algae (chlorophyll-a)", icon: "leaf", color: "#2F7A4D", tc: "#6fcf8f", steps: "Satellite · about 4 km",
    groups: [{ title: "Monitoring points, month by month", layers: ["chl_points"] }, { title: "Chlorophyll map", layers: ["chl_map"] }], first: "chl_points" },
  { id: "plankton", title: "Plankton dynamics", icon: "pulse", color: "#1F6F8B", tc: "#6cc3df", steps: "Change · 2020-2026",
    groups: [{ title: "Against the usual for the month", layers: ["chl_season", "chl_year"] }], first: "chl_season" },
  { id: "nutrients", title: "Nutrients", icon: "flask", color: "#8A5A1C", tc: "#e0b25c", steps: "Context · 1965-2022 average",
    groups: [{ title: "Surface nutrients (offshore)", layers: ["nitrate", "phosphate"] }], first: "nitrate" },
];

/** kind: points (value each month), season / year (change each month), grid (the April 2026 map), woa (a nutrient average). */
export const LAYERS = {
  chl_points: { kind: "points", title: "Chlorophyll-a at five monitoring points", unit: "mg/m³", sub: "2020-2026 · month slider", badges: ["satellite", "4 km pixel", "gaps kept"],
    shows: "Algae in the surface water, month by month, at five fixed satellite pixels from the Karachi creeks out to sea. A hollow dot had no valid reading that month (cloud, haze or muddy water)." },
  chl_map: { kind: "grid", title: "Chlorophyll-a map, April 2026", unit: "mg/m³", sub: "April 2026 · the latest month only", badges: ["satellite", "4 km pixel", "one month"],
    shows: "Every water pixel of the delta in the latest monthly picture. Blank water had no valid reading; land is left out." },
  chl_season: { kind: "season", title: "Chlorophyll against the usual for the month", unit: "%", sub: "2020-2026 · against the 2020-2024 median", badges: ["satellite", "change", "not a bloom alert"],
    shows: "How far each point's chlorophyll is above or below its 2020-2024 median for the same calendar month. Seasons are compared with themselves, so the monsoon is not mistaken for a change." },
  chl_year: { kind: "year", title: "Chlorophyll against the same month a year before", unit: "%", sub: "2021-2026 · year on year", badges: ["satellite", "change", "not a bloom alert"],
    shows: "Each point's chlorophyll against the same calendar month one year earlier. Both months need a valid reading." },
  nitrate: { kind: "woa", key: "nitrate", title: "Surface nitrate, 1965-2022 average", short: "Nitrate", unit: "µmol/kg", sub: "1965-2022 average · 1° cells", badges: ["climatology", "100 km cells", "context only"],
    shows: "The nutrient algae need most, as a long-term average of the sea surface. Each square is one cell of about 100 km; creeks and today's conditions are not resolved." },
  phosphate: { kind: "woa", key: "phosphate", title: "Surface phosphate, 1965-2022 average", short: "Phosphate", unit: "µmol/kg", sub: "1965-2022 average · 1° cells", badges: ["climatology", "100 km cells", "context only"],
    shows: "The second main nutrient, as a long-term average of the sea surface. Each square is one cell of about 100 km; creeks and today's conditions are not resolved." },
};
/** NDMA package (DMJM, 2026-11-06, server/load-ndma.mjs): kind "hmap" = a whole-coast satellite picture per month or year, 1998-2025. */
const HIST_BADGES = ["satellite", "4 km pixel", "gaps kept"];
Object.assign(LAYERS, {
  hist_chl: { kind: "hmap", set: "chl", ramp: "chl", title: "Chlorophyll-a, every month 1998-2025", short: "Chlorophyll-a", unit: "mg/m³", sub: "336 months · OC-CCI", badges: HIST_BADGES,
    shows: "Algae in the surface water of the whole coast, one satellite picture per month. Blank water had no valid reading (cloud, haze or muddy water; in 33 of the 336 months, all in June-August, under half of the water was seen). Click a pixel to see its own record." },
  hist_sst: { kind: "hmap", set: "sst", ramp: "sst", title: "Sea-surface temperature, every month 1998-2025", short: "Sea-surface temperature", unit: "°C", sub: "336 months · NOAA OISST", badges: ["satellite analysis", "25 km underneath", "no gaps"],
    shows: "How warm the sea surface is, one picture per month. It is a blended analysis at 25 km drawn on a finer grid, so the small squares show no extra detail. Click a pixel to see its own record." },
  hist_chl_year: { kind: "hmap", set: "chl_year", ramp: "chl", annual: true, title: "Chlorophyll-a, yearly average 1998-2025", short: "Chlorophyll-a", unit: "mg/m³", sub: "28 years · geometric mean of the months", badges: [...HIST_BADGES, "≥ 9 months"],
    shows: "The yearly average of the monthly pictures (geometric mean), only where at least nine months had a reading. Missing summer months can pull a yearly average up or down." },
  hist_sst_year: { kind: "hmap", set: "sst_year", ramp: "sst", annual: true, title: "Sea-surface temperature, yearly average 1998-2025", short: "Sea-surface temperature", unit: "°C", sub: "28 years · mean of the months", badges: ["satellite analysis", "25 km underneath"],
    shows: "The yearly average of the monthly temperature pictures. A warm or cool year here is a regional average, not a heat-wave record." },
});
/* 2026-11-11: the package's static products (server/load-ndma.mjs). kind "hmap" with `still`: one picture per choice (season,
   scenario and window), chosen with buttons instead of a slider; never animated (the package's own rule for trends). */
const SCEN_LABEL = (k) => { const [s, y] = k.split("_"); return `${s === "ssp245" ? "SSP2-4.5" : "SSP5-8.5"} · ${{ 2030: "2021-2040", 2040: "2031-2050", 2050: "2041-2060" }[y]}`; };
Object.assign(LAYERS, {
  trend_sst: { kind: "hmap", still: true, set: "trend_sst", ramp: "trend_sst", note: "trend", title: "Sea-surface temperature trend, 1998-2025", short: "SST trend", unit: "°C per decade", sub: "by season · Sen slope", badges: ["satellite analysis", "trend", "not a forecast"],
    label: (k) => ({ winter: "Winter (Dec-Mar)", summer: "Summer (Jun-Sep)" })[k],
    shows: "How fast the sea surface has warmed or cooled in each season since 1998, per decade. Pixels where the trend is statistically significant are counted in the panel." },
  trend_chl: { kind: "hmap", still: true, set: "trend_chl", ramp: "trend_chl", note: "trend", title: "Chlorophyll trend, 1998-2025", short: "Chlorophyll trend", unit: "% per decade", sub: "by season · Sen slope", badges: ["satellite", "trend", "exploratory"],
    label: (k) => ({ winter: "Winter (Dec-Mar)", summer: "Summer (Jun-Sep)" })[k],
    shows: "How much the algae in the surface water have changed per decade in each season since 1998. Summer is almost blank: monsoon cloud leaves too few complete summers to compute a trend." },
  proj_sst: { kind: "hmap", still: true, set: "proj_sst", ramp: "sst", note: "scenario", title: "Sea-surface temperature, model scenarios", short: "SST, scenario", unit: "°C", sub: "median of 3 models · 20-year windows", badges: ["climate models", "projection", "not a forecast"], label: SCEN_LABEL, start: "ssp245_2050",
    shows: "Average sea-surface temperature of a 20-year window as three climate models project it, for medium (SSP2-4.5) and high (SSP5-8.5) emissions." },
  proj_chl: { kind: "hmap", still: true, set: "proj_chl", ramp: "chl", note: "scenario", title: "Chlorophyll, model scenarios", short: "Chlorophyll, scenario", unit: "mg/m³", sub: "median of 3 models · 20-year windows", badges: ["climate models", "model-assisted", "not a forecast"], label: SCEN_LABEL, start: "ssp245_2050",
    shows: "Average chlorophyll of a 20-year window as three climate models project it, anchored on the satellite record. Where the satellite saw too little, the baseline itself is model-assisted." },
  change_sst: { kind: "hmap", still: true, set: "change_sst", ramp: "change_sst", note: "change", title: "Warming by 2041-2060, high emissions", short: "SST change", unit: "°C", sub: "SSP5-8.5 against 1998-2014", badges: ["climate models", "change", "not a forecast"], label: () => "SSP5-8.5 · 2041-2060",
    shows: "How much warmer the sea surface is in the 2041-2060 window under high emissions than in 1998-2014, as the median of three models." },
  change_chl: { kind: "hmap", still: true, set: "change_chl", ramp: "change_chl", note: "change", title: "Chlorophyll change by 2041-2060, high emissions", short: "Chlorophyll change", unit: "%", sub: "SSP5-8.5 against 1998-2014", badges: ["climate models", "change", "model-assisted"], label: () => "SSP5-8.5 · 2041-2060",
    shows: "How much the algae change in the 2041-2060 window under high emissions against 1998-2014, in percent, as the median of three models." },
  concern: { kind: "hmap", still: true, set: "concern", ramp: "concern", note: "concern", title: "Relative concern, January 2025", short: "Relative concern", unit: "class", sub: "screening snapshot · provisional", badges: ["screening index", "one month", "not a safety rating"], label: () => "January 2025",
    shows: "Where the coastal water showed more signs of eutrophication pressure than elsewhere in January 2025, in five classes of relative concern. It ranks places against each other; it does not say any water is safe or unsafe." },
});
Object.assign(LAYERS, {
  ins_plankton: { kind: "insitu", mode: "plankton", title: "Plankton species records (presence only)", short: "Plankton records", unit: "records", sub: "OBIS · counted in 25 km squares", badges: ["in situ", "presence only", "not amounts"],
    shows: "Where plankton species have been recorded in the water (OBIS database, 1950 on), counted in squares of a quarter degree. A record says a species was seen there, not how much of it. Many squares only reflect where ships sampled." },
  ins_measured: { kind: "insitu", mode: "measured", title: "Measured nutrients, oxygen and salinity", short: "Measured values", unit: "", sub: "bottle and float samples · one dot per sample", badges: ["in situ", "measured", "original units"],
    shows: "Real readings from the water (oxygen, salinity, nitrate, published plankton counts, and chlorophyll from float and ship sensors as well as from water samples), one dot per reading, in the units of the source. Pick the variable above the charts." },
});
Object.entries(LAYERS).forEach(([id, l]) => { l.id = id; });
export const tabOf = (id) => TABS.find((t) => t.groups.some((g) => g.layers.includes(id)));
export const hasMonths = (id) => ["points", "season", "year"].includes(LAYERS[id]?.kind);
export const isHist = (id) => LAYERS[id]?.kind === "hmap";
/** The tabs to show: the NDMA history only when its files are loaded (npm run load:ndma). */
export const isStill = (id) => !!LAYERS[id]?.still;
export const tabs = () => TABS.filter((t) => (t.id !== "history" || D?.hist) && (t.id !== "insitu" || D?.insitu) && (t.id !== "outlook" || D?.hist?.sets?.trend_sst))
  .map((t) => (t.id === "insitu" && !D.insitu.measured.length ? { ...t, groups: t.groups.map((g) => ({ ...g, layers: g.layers.filter((l) => l !== "ins_measured") })) } : t));
export const isInsitu = (id) => LAYERS[id]?.kind === "insitu";
/** Measured variables present, most rows first. */
export const insVars = () => Object.entries(D.insitu.variables).filter(([k]) => k !== "plankton_taxon_presence").sort((a, b) => b[1].rows - a[1].rows).map(([k, v]) => ({ key: k, ...v }));
/** Frames (months "1998-01" or years "1998") of a history layer. */
export const histFrames = (id) => D.hist.sets[LAYERS[id].set].frames;

/* ---------------- state shared with the React parts */
let S = { ready: false, error: null, tab: null, layer: null, open: [], groupsOpen: [], idx: 0, point: "keti", opacity: 0.85, playing: false,
  hi: 0, pick: null, insVar: null, insPick: null, insDepth: "surface" }; // hi: frame of the NDMA history layer (month or year); pick: { lat, lon, data: { set: pixel record } } of the clicked pixel
const listeners = new Set();
const emit = (patch) => { S = { ...S, ...patch }; listeners.forEach((f) => f()); draw(); };
const subscribe = (f) => (listeners.add(f), () => listeners.delete(f));
/** A part of the state, for a React component: const idx = useNp((s) => s.idx). */
export const useNp = (pick) => useSyncExternalStore(subscribe, () => pick(S));
export const npState = () => S;

/** { months, unit, baseline_years, places, chlorophyll, nitrate, phosphate, sources } once loaded. */
let D = null;
export const data = () => D;

let started = null;
export function start() {
  started ??= (async () => {
    const get = async (k) => {
      const r = await fetch(`api/nutrients/${k}`);
      if (!r.ok) throw new Error(r.status === 404 ? "it is not loaded (npm run load:nutrients)" : `the data API answered ${r.status}`);
      return r.json();
    };
    const [points, chlorophyll, nitrate, phosphate, sources] = await Promise.all(["points", "chlorophyll", "nitrate", "phosphate", "sources"].map(get));
    const opt = (u) => fetch(u).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const [hist, insitu] = await Promise.all([opt("api/ndma/manifest"), opt("api/ndma/insitu")]); // the NDMA package and its field data, when loaded
    D = { months: points.months, unit: points.unit, baseline_years: points.baseline_years, places: points.points, chlorophyll, nitrate, phosphate, sources, hist, insitu };
    S = { ...S, ready: true, error: null, idx: D.months.length - 1, hi: hist ? hist.sets.chl.frames.length - 1 : 0 };
    if (!S.layer) selectTab(tabs()[0].id); else emit({});
  })().catch((e) => { started = null; emit({ error: `The nutrients and plankton data could not be read: ${e.message}.` }); });
  return started;
}

/* ---------------- left list and choices */
export function toggleTab(id) {
  const open = !S.open.includes(id);
  emit({ open: open ? [id] : S.open.filter((x) => x !== id) });
  if (open && S.tab !== id) selectTab(id);
}
export function toggleGroup(key) { emit({ groupsOpen: S.groupsOpen.includes(key) ? S.groupsOpen.filter((x) => x !== key) : [...S.groupsOpen, key] }); }
export function selectTab(id) {
  const t = TABS.find((x) => x.id === id);
  if (!t) return;
  if (tabOf(S.layer)?.id === id) { emit({ tab: id, open: [id] }); return; }
  selectLayer(t.first, { tab: id });
}
export function selectLayer(id, extra = {}) {
  if (!LAYERS[id]) return;
  stop();
  if (isHist(id)) { // monthly and yearly layers share the picture's date: keep it when switching between them
    const was = LAYERS[S.layer], now = LAYERS[id], n = histFrames(id).length;
    if (now.still) { const same = was?.still && histFrames(S.layer).length === n; extra = { hi: same ? S.hi : Math.max(0, histFrames(id).findIndex((f) => f.key === now.start)), ...extra }; } // scenario maps keep the chosen scenario and window
    else if (was?.still) extra = { hi: n - 1, ...extra }; // back to the record: its latest picture
    else if (was?.kind === "hmap" && !was.annual && now.annual) extra = { hi: Math.min(n - 1, Math.floor(S.hi / 12)), ...extra };
    else if (was?.kind === "hmap" && was.annual && !now.annual) extra = { hi: Math.min(n - 1, S.hi * 12 + 6), ...extra };
    else if (was?.kind !== "hmap") extra = { hi: Math.min(S.hi, n - 1), ...extra };
    queueMicrotask(() => loadPick(now.set));
  }
  const t = tabOf(id), key = `${t.id}:${t.groups.find((g) => g.layers.includes(id)).title}`;
  emit({ layer: id, tab: t.id, open: S.open.includes(t.id) ? S.open : [t.id], groupsOpen: S.groupsOpen.includes(key) ? S.groupsOpen : [...S.groupsOpen, key], ...extra });
}
export function setPoint(id) { if (id !== S.point) emit({ point: id }); }
export function setOpacity(v) {
  emit({ opacity: v });
  if (map?.getLayer("np-grid")) map.setPaintProperty("np-grid", "fill-opacity", v);
  if (map?.getLayer("np-woa")) map.setPaintProperty("np-woa", "fill-opacity", 0.8 * v);
  if (map?.getLayer("np-img")) map.setPaintProperty("np-img", "raster-opacity", v);
}

/* ---------------- the month slider */
export function setIdx(i) {
  if (!D) return;
  i = Math.max(0, Math.min(D.months.length - 1, i));
  if (i !== S.idx) emit({ idx: i });
}
let timer = 0;
export function play() {
  if (S.playing) { stop(); return; }
  if (isStill(S.layer)) return; // trends and scenarios are not a time series
  if (isHist(S.layer)) {
    const n = histFrames(S.layer).length, annual = LAYERS[S.layer].annual;
    if (S.hi >= n - 1) setHi(0);
    emit({ playing: true });
    timer = setInterval(() => { if (S.hi >= n - 1) { stop(); return; } setHi(S.hi + 1); }, annual ? 700 : 300);
    return;
  }
  if (S.idx >= D.months.length - 1) setIdx(0);
  emit({ playing: true });
  timer = setInterval(() => { if (S.idx >= D.months.length - 1) { stop(); return; } setIdx(S.idx + 1); }, 450);
}

/* ---------------- the NDMA history: its slider, its pictures, the clicked pixel */
export function setHi(i) {
  if (!isHist(S.layer)) return;
  i = Math.max(0, Math.min(histFrames(S.layer).length - 1, i));
  if (i !== S.hi) emit({ hi: i });
}
/** URL of a frame's picture. */
const imgUrl = (layerId, i) => `api/ndma/${LAYERS[layerId].set}/${histFrames(layerId)[i].key}.png`;
/** Share of the grid's water pixels that have a value (the picture's coverage) in frame i of a history layer. */
export const histValid = (layerId, i) => histFrames(layerId)[i].valid;
export const HIST_PIXELS = 278 * 195;
/** The clicked pixel's record in `set`, fetched once. */
async function loadPick(set) {
  const p = S.pick;
  if (!p || p.data[set]) return;
  const r = await fetch(`api/ndma/pixel/${set}?lat=${p.lat}&lon=${p.lon}`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
  if (r && S.pick === p) emit({ pick: { ...p, data: { ...p.data, [set]: r } } });
}
export function pickPixel(lat, lon) {
  const g = D.hist.grid;
  if (lat > g.north || lat < g.south || lon < g.west || lon > g.east) return;
  emit({ pick: { lat, lon, data: {} } });
  loadPick(LAYERS[S.layer].set);
}
export function clearPick() { emit({ pick: null }); }
export function stop() { if (timer) clearInterval(timer); timer = 0; if (S.playing) emit({ playing: false }); }

/* ---------------- figures, worked out from the data */
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "April 2026" (or "Apr 2026" when short) for month index i, or for a "2026-04" string. */
export function monthLabel(i, short = false) {
  const m = typeof i === "string" ? i : D.months[i], name = MONTHS[+m.slice(5) - 1];
  return `${short ? name.slice(0, 3) : name} ${m.slice(0, 4)}`;
}
export const monthName = (i) => MONTHS[+D.months[i].slice(5) - 1];
export const placeOf = (id) => D?.places.find((p) => p.id === id) ?? D?.places[0];
const median = (v) => { const s = [...v].sort((a, b) => a - b), k = Math.floor(s.length / 2); return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };
/** Percentage change from base to v; null when either is missing or base is zero. */
export const change = (v, base) => (v == null || base == null || base === 0 ? null : (100 * (v - base)) / base);

/**
 * The usual value for month i's calendar month at a place: the median of its 2020-2024 readings of that month, with
 * their range. Needs at least three readings (the observatory's rule); null otherwise.
 */
export function usual(p, i) {
  const [y0, y1] = D.baseline_years, m = D.months[i].slice(5);
  const vals = D.months.flatMap((mm, j) => (mm.slice(5) === m && +mm.slice(0, 4) >= y0 && +mm.slice(0, 4) <= y1 && p.values[j] != null ? [p.values[j]] : []));
  return vals.length < 3 ? null : { median: median(vals), min: Math.min(...vals), max: Math.max(...vals), n: vals.length };
}

/** Everything the panel says about place p in month i. */
export function figures(p, i) {
  const v = p.values[i], u = usual(p, i), prev = i > 0 ? p.values[i - 1] : null, yr = i >= 12 ? p.values[i - 12] : null;
  return {
    v, u, prev, yr,
    vsUsual: change(v, u?.median), vsPrev: change(v, prev), vsYear: change(v, yr),
    pos: v == null || !u ? null : v > u.max ? "above" : v < u.min ? "below" : "within",
    valid: p.values.filter((x) => x != null).length,
  };
}

/** What the layer colours a point by in month i: the value, or a change in %. */
export function shownValue(id, p, i) {
  const kind = LAYERS[id]?.kind, f = figures(p, i);
  return kind === "season" ? f.vsUsual : kind === "year" ? f.vsYear : f.v;
}

/** The nutrient cell nearest to place p (by centre), with its value. */
export function nearestCell(key, p) {
  let best = null, d = Infinity;
  for (const c of D[key].cells) { const x = (c[0] - p.pixel.lat) ** 2 + (c[1] - p.pixel.lon) ** 2; if (x < d) { d = x; best = c; } }
  return best && { lat: best[0], lon: best[1], value: best[2], km: Math.round(Math.sqrt(d) * 111) };
}

export const fmt = (v, d = 2) => (v == null ? "—" : v >= 100 ? Math.round(v).toLocaleString("en") : v.toFixed(v >= 10 ? 1 : d));
export const pct = (v) => (v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v) >= 10 ? Math.round(Math.abs(v)) : Math.abs(v).toFixed(1)} %`);

/* ---------------- colours */
/** Chlorophyll on a log scale, as satellite chlorophyll maps are drawn: clear blue water to green to yellow-red. */
export const CHL_STOPS = [[0.1, "#2c1f6b"], [0.3, "#1f4fa3"], [1, "#1aa3b8"], [3, "#4fbf5a"], [10, "#e6d43a"], [30, "#e2582c"]];
export const CHANGE_STOPS = [[-60, "#2f5fbf"], [-25, "#86a9e0"], [0, "#dfe7e6"], [25, "#e7b65c"], [60, "#d0542c"]];
export const NUTRIENT_STOPS = {
  nitrate: [[0.4, "#f3e7c4"], [0.8, "#e0a64e"], [1.2, "#9c5420"]],
  phosphate: [[0.4, "#e3eef7"], [0.5, "#7fb0d8"], [0.6, "#2f5f99"]],
};
const hex = (c) => [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16));
function ramp(stops, v, log = false) {
  const t = (x) => (log ? Math.log(x) : x), x = t(Math.max(stops[0][0], Math.min(stops.at(-1)[0], v)));
  for (let k = 1; k < stops.length; k++) {
    const [a, ca] = stops[k - 1], [b, cb] = stops[k];
    if (x <= t(b)) { const f = (x - t(a)) / (t(b) - t(a) || 1), A = hex(ca), B = hex(cb); return `rgb(${A.map((q, j) => Math.round(q + (B[j] - q) * f)).join(",")})`; }
  }
  return stops.at(-1)[1];
}
export const chlColor = (v) => ramp(CHL_STOPS, v, true);
export const changeColor = (v) => ramp(CHANGE_STOPS, v);
export const nutrientColor = (key, v) => ramp(NUTRIENT_STOPS[key], v);
/** CSS gradient of a ramp, evenly spaced as its legend ticks are. */
export const gradient = (stops) => `linear-gradient(90deg, ${stops.map(([, c], k) => `${c} ${(100 * k) / (stops.length - 1)}%`).join(", ")})`;

/* ---------------- the portal's map */
let map = null, attachedFor = null, names = [], cellLabels = [], popup = null;
const EMPTY = { type: "FeatureCollection", features: [] };
const SOURCES = ["np-grid", "np-woa", "np-link", "np-asked", "np-pts"];
const IDS = ["np-img", "np-grid", "np-woa", "np-woa-line", "np-link", "np-asked", "np-pts"]; // map layers, bottom to top
const square = (lat, lon, h) => ({ type: "Polygon", coordinates: [[[lon - h, lat - h], [lon + h, lat - h], [lon + h, lat + h], [lon - h, lat + h], [lon - h, lat - h]]] });

/** The Nutrients & Plankton layer went on the map (src/map/renderers.js): add its sources and draw. */
export async function attach(m, portalLayerId) {
  map = m; attachedFor = portalLayerId;
  await start();
  if (map !== m || !S.ready || map.getSource("np-pts")) return;
  const before = ["pakistan-border-edge", "pakistan-border"].find((id) => map.getLayer(id));
  SOURCES.forEach((id) => map.addSource(id, { type: "geojson", data: EMPTY }));
  drawnGrid = null; drawnImg = null;
  if (D.hist) { // the NDMA pictures: one image source whose picture is swapped as the slider moves
    const g = D.hist.grid;
    map.addSource("np-img", { type: "image", url: "api/ndma/chl/2025-12.png", coordinates: [[g.west, g.north], [g.east, g.north], [g.east, g.south], [g.west, g.south]] });
    map.addLayer({ id: "np-img", type: "raster", source: "np-img", layout: { visibility: "none" }, paint: { "raster-opacity": S.opacity, "raster-resampling": "nearest", "raster-fade-duration": 0 } }, before);
  }
  map.addLayer({ id: "np-grid", type: "fill", source: "np-grid", paint: { "fill-color": ["get", "_c"], "fill-opacity": S.opacity, "fill-antialias": false } }, before);
  map.addLayer({ id: "np-woa", type: "fill", source: "np-woa", paint: { "fill-color": ["get", "_c"], "fill-opacity": 0.8 * S.opacity } }, before);
  map.addLayer({ id: "np-woa-line", type: "line", source: "np-woa", paint: { "line-color": "#e6eef0", "line-opacity": 0.45, "line-width": 1 } }, before);
  map.addLayer({ id: "np-link", type: "line", source: "np-link", paint: { "line-color": "#e6eef0", "line-width": 1.4, "line-dasharray": [2, 2], "line-opacity": 0.85 } });
  map.addLayer({ id: "np-asked", type: "circle", source: "np-asked", paint: { "circle-radius": 4.5, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#e6eef0", "circle-stroke-width": 1.5 } });
  map.addLayer({ id: "np-pts", type: "circle", source: "np-pts", paint: { "circle-radius": ["get", "_r"], "circle-color": ["get", "_c"], "circle-stroke-color": ["get", "_s"], "circle-stroke-width": ["get", "_w"] } });
  // Hajamro Creek's pixel lies just north-west of Keti Bandar's, so its name goes on the left where the two would collide
  names = D.places.map((p) => { const left = p.id === "hajamro"; return new maplibregl.Marker({ element: Object.assign(document.createElement("div"), { className: `np-name ${left ? "left" : ""}` }), anchor: left ? "right" : "left", offset: [left ? -14 : 14, 0] }).setLngLat([p.pixel.lon, p.pixel.lat]).addTo(map); });
  map.on("click", onClick);
  map.on("mousemove", hover);
  map.on("mouseenter", "np-pts", pointer); map.on("mouseleave", "np-pts", unpointer);
  draw();
}
const pointer = () => { map.getCanvas().style.cursor = "pointer"; }, unpointer = () => { map.getCanvas().style.cursor = ""; };

/** The layer came off the map. */
export function detach(m, portalLayerId) {
  if (m !== map || portalLayerId !== attachedFor) return;
  stop();
  map.off("click", onClick); map.off("mousemove", hover); map.off("mouseenter", "np-pts", pointer); map.off("mouseleave", "np-pts", unpointer);
  [...names, ...cellLabels].forEach((x) => x.remove()); names = []; cellLabels = [];
  popup?.remove(); popup = null;
  [...IDS].reverse().forEach((id) => { if (map.getLayer(id)) map.removeLayer(id); });
  [...SOURCES, "np-img"].forEach((id) => { if (map.getSource(id)) map.removeSource(id); });
  map = null; attachedFor = null; drawnGrid = null; drawnImg = null;
}

let drawnImg = null; // which NDMA picture is on the map now
let drawnGrid = null; // which layer's cells are on the map now, so the slider does not resend them
function draw() {
  if (!map?.getSource("np-pts") || !D || !S.layer) return;
  const l = LAYERS[S.layer], i = l.kind === "grid" ? D.months.indexOf(D.chlorophyll.date) : S.idx;
  const hist = l.kind === "hmap";
  if (map.getLayer("np-img")) {
    map.setLayoutProperty("np-img", "visibility", hist ? "visible" : "none");
    if (hist) {
      const url = imgUrl(S.layer, S.hi);
      if (drawnImg !== url) { drawnImg = url; map.getSource("np-img").updateImage({ url }); }
      for (let k = 1; k <= 3 && S.hi + k < histFrames(S.layer).length; k++) new Image().src = imgUrl(S.layer, S.hi + k); // warm the next pictures
    }
  }
  if (l.kind === "insitu") { drawInsitu(l); return; }
  if (hist) { // the places do not belong to these pictures: only the clicked pixel is marked
    map.getSource("np-grid").setData(EMPTY); map.getSource("np-woa").setData(EMPTY); map.getSource("np-link").setData(EMPTY); map.getSource("np-pts").setData(EMPTY);
    drawnGrid = null;
    cellLabels.forEach((x) => x.remove()); cellLabels = [];
    map.getSource("np-asked").setData(!S.pick ? EMPTY : { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [S.pick.lon, S.pick.lat] } }] });
    names.forEach((m) => { m.getElement().style.display = "none"; });
    return;
  }
  names.forEach((m) => { m.getElement().style.display = ""; });
  /* the April 2026 map, or a nutrient average: one set of squares per layer */
  if (drawnGrid !== S.layer) {
    drawnGrid = S.layer;
    const g = D.chlorophyll, h = g.cell_deg / 2;
    map.getSource("np-grid").setData(l.kind !== "grid" ? EMPTY : { type: "FeatureCollection", features: g.cells.map(([lat, lon, v]) => ({ type: "Feature", properties: { v, _c: chlColor(v) }, geometry: square(lat, lon, h) })) });
    const w = l.kind === "woa" ? D[l.key] : null;
    map.getSource("np-woa").setData(!w ? EMPTY : { type: "FeatureCollection", features: w.cells.map(([lat, lon, v]) => ({ type: "Feature", properties: { v, lat, lon, _c: nutrientColor(l.key, v) }, geometry: square(lat, lon, w.cell_deg / 2) })) });
    cellLabels.forEach((x) => x.remove());
    cellLabels = !w ? [] : w.cells.map(([lat, lon, v]) => new maplibregl.Marker({ element: Object.assign(document.createElement("div"), { className: "np-cell", textContent: v.toFixed(2) }) }).setLngLat([lon, lat]).addTo(map));
  }
  /* the five places: the pixel used (coloured by this month's value), and where a nearby pixel stands in, a dashed line from the place asked for */
  const nearby = D.places.filter((p) => p.nearby);
  map.getSource("np-link").setData({ type: "FeatureCollection", features: nearby.map((p) => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[p.requested.lon, p.requested.lat], [p.pixel.lon, p.pixel.lat]] } })) });
  map.getSource("np-asked").setData({ type: "FeatureCollection", features: nearby.map((p) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [p.requested.lon, p.requested.lat] } })) });
  map.getSource("np-pts").setData({ type: "FeatureCollection", features: D.places.map((p) => {
    const v = l.kind === "woa" ? null : shownValue(S.layer, p, i), on = p.id === S.point;
    const c = l.kind === "woa" ? "#e6eef0" : v == null ? "rgba(0,0,0,0)" : l.kind === "season" || l.kind === "year" ? changeColor(v) : chlColor(v);
    return { type: "Feature", properties: { id: p.id, _c: c, _r: on ? 10 : 7.5, _s: v == null && l.kind !== "woa" ? "#9db4b7" : on ? "#ffffff" : "#04121f", _w: on ? 3 : v == null ? 2 : 1.5 }, geometry: { type: "Point", coordinates: [p.pixel.lon, p.pixel.lat] } };
  }) });
  names.forEach((m, k) => {
    const p = D.places[k], v = l.kind === "woa" ? null : shownValue(S.layer, p, i), el = m.getElement();
    el.classList.toggle("on", p.id === S.point);
    el.innerHTML = `<b>${p.name}</b>${l.kind === "woa" ? "" : `<span>${v == null ? "no reading" : l.kind === "season" || l.kind === "year" ? pct(v) : `${fmt(v)} mg/m³`}</span>`}`;
  });
}

/* ---------------- in-situ records: plankton presence in quarter-degree squares, measured values as dots */
export const INS_STOPS = [[1, "#2c1f6b"], [10, "#1f4fa3"], [100, "#1aa3b8"], [1000, "#e6d43a"], [5000, "#e2582c"]];
export const insColor = (n) => ramp(INS_STOPS, n, true);
/** Colour stops for a measured variable: its 5th, 50th and 95th percentile. */
export function domUnit(key) {
  const c = {}; D.insitu.measured.forEach((m) => { if (m.v === key) c[m.unit] = (c[m.unit] ?? 0) + 1; });
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}
export function measuredStops(key) {
  const v = insRows(key).map((m) => m.value).sort((a, b) => a - b), q = (f) => v[Math.min(v.length - 1, Math.floor(f * v.length))];
  if (!v.length) return [[0, "#2c1f6b"], [1, "#e6d43a"]];
  const a = q(0.05), m = q(0.5), b = q(0.95);
  return a < m && m < b ? [[a, "#2c1f6b"], [m, "#1aa3b8"], [b, "#e6d43a"]] : [[a, "#2c1f6b"], [b === a ? a + 1 : b, "#e6d43a"]];
}
export function setInsVar(k) { emit({ insVar: k, insPick: null }); }
/** Depth bands for measured values: a deep bottle and a surface reading at one place must not be drawn as one map. No depth given = a surface sample. */
export const DEPTHS = [{ id: "surface", label: "Surface, 0-10 m", min: -1, max: 10 }, { id: "upper", label: "10-200 m", min: 10, max: 200 }, { id: "deep", label: "Below 200 m", min: 200, max: Infinity }, { id: "all", label: "All depths", min: -1, max: Infinity }];
const inBand = (m, b) => (m.depth == null ? b.id === "surface" || b.id === "all" : m.depth > b.min && m.depth <= b.max);
export const insBand = () => DEPTHS.find((d) => d.id === S.insDepth) ?? DEPTHS[0];
export function setInsDepth(id) { emit({ insDepth: id, insPick: null }); }
/** The rows drawn for a variable: its main unit, in the chosen depth band, deepest first so the shallowest sit on top. */
export function insRows(key) {
  const u = domUnit(key), b = insBand();
  return D.insitu.measured.map((m, i) => ({ ...m, i })).filter((m) => m.v === key && m.unit === u && inBand(m, b)).sort((a, z) => (z.depth ?? 0) - (a.depth ?? 0));
}
/** Rows of a variable in each depth band (for the band buttons). */
export const insBandCounts = (key) => { const u = domUnit(key), r = D.insitu.measured.filter((m) => m.v === key && m.unit === u); return Object.fromEntries(DEPTHS.map((b) => [b.id, r.filter((m) => inBand(m, b)).length])); };
function drawInsitu(l) {
  const I = D.insitu, h = I.plankton.cell_deg / 2;
  ["np-woa", "np-link"].forEach((id) => map.getSource(id).setData(EMPTY));
  map.getSource("np-asked").setData(EMPTY); drawnGrid = null;
  cellLabels.forEach((x) => x.remove()); cellLabels = [];
  names.forEach((m) => { m.getElement().style.display = "none"; });
  const sel = S.insPick;
  if (l.mode === "plankton") {
    map.getSource("np-grid").setData({ type: "FeatureCollection", features: I.plankton.cells.map((c, i) => ({ type: "Feature", properties: { i, _c: insColor(c.n) }, geometry: square(c.lat, c.lon, h) })) });
    map.getSource("np-pts").setData(!sel || sel.kind !== "cell" ? EMPTY : { type: "FeatureCollection", features: [{ type: "Feature", properties: { _c: "rgba(0,0,0,0)", _r: 12, _s: "#ffffff", _w: 3 }, geometry: { type: "Point", coordinates: [I.plankton.cells[sel.i].lon, I.plankton.cells[sel.i].lat] } }] });
  } else {
    const key = S.insVar ?? insVars()[0]?.key, stops = key ? measuredStops(key) : null;
    map.getSource("np-grid").setData(EMPTY);
    map.getSource("np-pts").setData({ type: "FeatureCollection", features: !key ? [] : insRows(key).map(({ i, ...m }) => ({ type: "Feature",
      properties: { i, _c: ramp(stops, m.value), _r: sel?.kind === "point" && sel.i === i ? 9 : 5.5, _s: sel?.kind === "point" && sel.i === i ? "#ffffff" : "#04121f", _w: sel?.kind === "point" && sel.i === i ? 3 : 1 }, geometry: { type: "Point", coordinates: [m.lon, m.lat] } })) });
  }
}

/** A crosshair over the NDMA pictures (a click reads that pixel's record from the API: the picture itself holds no numbers). */
function hover() { if (!map || !D) return; const c = map.getCanvas().style; if (isHist(S.layer)) c.cursor = "crosshair"; else if (c.cursor === "crosshair") c.cursor = ""; }

function onClick(ev) {
  if (!D || !S.layer) return;
  if (isHist(S.layer)) { pickPixel(ev.lngLat.lat, ev.lngLat.lng); return; }
  if (isInsitu(S.layer)) {
    const mode = LAYERS[S.layer].mode, f = map.queryRenderedFeatures(ev.point, { layers: [mode === "plankton" ? "np-grid" : "np-pts"] })[0];
    popup?.remove();
    if (!f) { emit({ insPick: null }); return; }
    const i = f.properties.i, kind = mode === "plankton" ? "cell" : "point";
    emit({ insPick: { kind, i } });
    const html = kind === "cell" ? (() => { const c = D.insitu.plankton.cells[i]; return `<div class="src">Plankton records · ${c.lat.toFixed(3)}° N, ${c.lon.toFixed(3)}° E (25 km square)</div><b>${c.n.toLocaleString("en")} records${c.years ? `, ${c.years[0]}-${c.years[1]}` : ""}</b><div class="row">${Object.entries(c.taxa).slice(0, 4).map(([t, k]) => `${t} (${k})`).join(", ")}</div><div class="row muted">Presence only, not amounts</div>`; })()
      : (() => { const m = D.insitu.measured[i]; return `<div class="src">${m.v.replace(/_/g, " ")} · ${m.date ?? "date unknown"}</div><b>${m.value} ${m.unit}</b><div class="row muted">${m.depth != null ? `depth ${m.depth} m · ` : ""}${m.src}</div>`; })();
    popup = new maplibregl.Popup({ closeButton: false, offset: 12, maxWidth: "300px", className: "om-pop" }).setLngLat(ev.lngLat).setHTML(html).addTo(map);
    return;
  }
  const at = (ids) => map.queryRenderedFeatures(ev.point, { layers: ids.filter((id) => map.getLayer(id)) })[0];
  const l = LAYERS[S.layer], hit = at(["np-pts"]);
  popup?.remove();
  const show = (lngLat, html) => { popup = new maplibregl.Popup({ closeButton: false, offset: 12, maxWidth: "300px", className: "om-pop" }).setLngLat(lngLat).setHTML(html).addTo(map); };
  if (hit) {
    const p = placeOf(hit.properties.id), i = l.kind === "grid" ? D.months.indexOf(D.chlorophyll.date) : S.idx, f = figures(p, i);
    setPoint(p.id);
    show(hit.geometry.coordinates, `<div class="src">${p.name} · ${monthLabel(i)}</div><b>${f.v == null ? "No valid satellite reading" : `${fmt(f.v)} mg/m³ chlorophyll-a`}</b>
      ${f.u ? `<div class="row">Usual for ${monthName(i)}: ${fmt(f.u.median)} (${pct(f.vsUsual)})</div>` : ""}
      ${p.nearby ? `<div class="row muted">Nearby water pixel, ${p.offset_km} km from the place asked for (dashed line)</div>` : ""}`);
    return;
  }
  const cell = l.kind === "grid" ? at(["np-grid"]) : l.kind === "woa" ? at(["np-woa"]) : null;
  if (!cell) return;
  const { lng, lat } = ev.lngLat;
  show(ev.lngLat, l.kind === "grid"
    ? `<div class="src">Satellite · ${monthLabel(D.chlorophyll.date)}</div><b>${fmt(cell.properties.v)} mg/m³ chlorophyll-a</b><div class="row muted">${lat.toFixed(2)}° N, ${lng.toFixed(2)}° E · one 4 km pixel</div>`
    : `<div class="src">World Ocean Atlas 2023 · ${D[l.key].period}</div><b>${cell.properties.v.toFixed(3)} µmol/kg ${l.short.toLowerCase()}</b><div class="row muted">Cell centred ${cell.properties.lat}° N, ${cell.properties.lon}° E (about 100 km across)</div>`);
}
export const attachedLayer = () => attachedFor;
