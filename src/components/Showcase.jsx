/**
 * Showcase (standby mode): the portal plays every layer by itself, round after round, for a screen left running at an
 * event or in the office. Started from the turning play button above the tour button, or by opening the page with
 * ?showcase (?showcase=<part> starts the first round at coast, sealevel, intrusion, salinity, hazards, mangroves,
 * erosion, plastics, ocean or nutrients). Esc or the Stop button on the caption ends it and gives the portal back as it was.
 *
 * The order (owner, 2026-10-22): the coast at rest → terrain exposure off, +0.5, +1, +2 m, off → Sea Level Rise
 * (sea-level rise at the coast, land falling below sea level, land sinking) → Saline Water Intrusion (saline water under
 * the coast, fresh groundwater, sea salt up the Indus) → Salinity Index (salt-affected soils at Sujawal and Keti Bandar,
 * sea-surface salinity yearly and change by year, the warmer / saltier / more acidic sea by measure) → land lost to the
 * sea at its six places → Mangroves → Coastal Erosion → Plastics (5 s) → every ocean monitoring layer, EEZ boundary to
 * National index (fisheries included), each one's slider played like the timeline.
 *
 * Each map plays its own data years on the timeline, 4× when they span more than 60 years, else 3×; a map with emissions
 * scenarios then shows its last year under each scenario in turn. Maps that do not change with the years hold a few
 * seconds. Before the first round every picture of the script is downloaded (the browser keeps them a day), and while a
 * map plays the timeline waits for any year whose picture is not there yet (setPlayGate), so no year is skipped.
 * The side panels, the map tools and the ocean layer list are hidden while it plays; a caption names what is shown.
 * The camera stays close, scale bar 20–30 km (zoom 8.2), on the part of each map where the change shows (owner: the
 * land-below-sea-level map shows mostly between Keti Bandar and Karachi); closer for terrain exposure (7 km), sea-level
 * rise (10 km) and land below sea level (5 km), farther for sea-surface salinity change (50 km). Wherever a map would
 * not reach the screen's edges at that zoom the camera goes closer and moves in until it does (cover(), owner
 * 2026-10-26: every map edge to edge); the ocean layers fill the screen with the EEZ the same way.
 */
import { useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { LAYERS, TIME_RANGE, PRESENT_YEAR } from "../config/layers.js";
import { getState, setState, selectLayer, setSsp, setYear, setYearTo } from "../state.js";
import { HAZARDS, SSPS } from "../amib/hazards.js";
import { loadAmibCatalog, resolveHazard, imageUrl, layerById } from "../amib/amibData.js";
import { amibReady } from "../map/renderers.js";
import { loadManifest, pickTiles } from "../map/manifest.js";
import { loadPlastics, pointsGeojson } from "../plastics/plastics.js";
import * as om from "../oceanMonitoring/om.js";
import * as np from "../nutrients/np.js";
import { setPlayGate } from "./Timeline.jsx";
import { Icon } from "../lib.jsx";

/* Camera zooms by the distance the 110 px scale bar spans (Web Mercator, 512 px tiles, at the coast's 24.5° N):
   km(z) = 110 px × 40 075 km × cos 24.5° / (512 × 2^z); the bar itself shows the round distance below that. */
const zoomFor = (km) => Math.log2((110 * 40075 * Math.cos((24.5 * Math.PI) / 180)) / (512 * km));
const Z = 8.2; // scale bar 20 km (owner: 20–30 km)
const Z_FLOOD = zoomFor(7); // terrain exposure: 7 km across the bar (owner, 2026-10-26)
const Z_SEA = zoomFor(12.5); // sea-level rise at the coast: bar 10 km
const Z_BELOW = zoomFor(6); // land falling below sea level: bar 5 km
const Z_WIDE = zoomFor(60); // sea-surface salinity change by year: bar 50 km
const SEA = [67.25, 24.5]; // between Karachi and Keti Bandar, where the sea-level maps change most
const OFFSHORE = [66.95, 24.15]; // the shelf off the Indus mouths, for the sea maps
const YEAR_MS = 700; // one year per step at 1× (STEP_MS in Timeline.jsx)
const SSP_ORDER = ["ssp126", "ssp245", "ssp585"];
const sspName = (k) => { const s = SSPS.find((x) => x.id === k); return s ? `${s.short} · ${s.label.toLowerCase()}` : ""; };
const layerOf = (id) => LAYERS.find((l) => l.id === id);
const middle = ([[w, s], [e, n]]) => [(w + e) / 2, (s + n) / 2];
const hazard = (id) => HAZARDS.find((h) => h.id === id);

/* The package maps in the order they are shown: the portal layer that carries them, the hazard, its place or flow
   assumption (variant), its measure, and where the camera looks (else the middle of the map). */
const MAPS = [
  { layer: "sealevel", hazard: "sea-rise", at: SEA, zoom: Z_SEA },
  { layer: "sealevel", hazard: "inundation", at: SEA, zoom: Z_BELOW },
  { layer: "sealevel", hazard: "sinking", at: [67.15, 24.75] },
  { layer: "intrusion", hazard: "saltwedge", at: SEA },
  { layer: "intrusion", hazard: "groundwater", at: [67.95, 24.4] },
  { layer: "intrusion", hazard: "river-salt", at: [67.7, 24.27] },
  { layer: "salinity", hazard: "salty-soils", variant: 1 }, // Sujawal
  { layer: "salinity", hazard: "salty-soils", variant: 0 }, // Keti Bandar coast
  { layer: "salinity", hazard: "sea-salinity", variant: 0, at: OFFSHORE },
  { layer: "salinity", hazard: "sea-salinity", variant: 1, at: OFFSHORE, zoom: Z_WIDE }, // change by year (owner: 50 km, it was too close)
  ...hazard("future-ocean").measures.map((m) => ({ layer: "salinity", hazard: "future-ocean", measure: m.id, at: OFFSHORE })),
  ...hazard("shoreline").variants.map((_, i) => ({ layer: "hazards", hazard: "shoreline", variant: i })),
];

/** What one package map needs to play: its years, speed, scenarios, the pictures to download first and its caption. */
function plan(catalog, m) {
  const layer = layerOf(m.layer), view = { hazard: m.hazard, variant: m.variant ?? 0, measure: m.measure, raw: null };
  const at = (y, ssp = "ssp245") => resolveHazard(catalog, layer, view, ssp, y);
  const h = at(PRESENT_YEAR);
  if (!h?.L) return null;
  const ref = h.variant.ssp?.[h.sspUsed] ?? h.variant.layer, fill = (id) => (h.measure ? id.replace("{m}", h.measure.id) : id);
  let from = null, to = null;
  if (Array.isArray(ref)) { from = PRESENT_YEAR; to = Math.max(...ref.map((id) => layerById(catalog, fill(id))?.year ?? 0)); } // outlook maps for fixed years
  else if (h.L.steps && h.L.time_step !== "month-of-year") { from = Math.max(TIME_RANGE.from, h.L.steps[0].t); to = Math.min(TIME_RANGE.max, h.L.steps.at(-1).t); }
  if (!(to > from)) from = to = null;
  const ssps = h.variant.ssp ? SSP_ORDER.filter((k) => h.variant.ssp[k]) : [];
  const urls = new Set();
  for (let y = from ?? PRESENT_YEAR; y <= (to ?? PRESENT_YEAR); y++) { const r = at(y); if (r.L) urls.add(imageUrl(r.L, r.step)); }
  ssps.forEach((k) => { const r = at(to ?? PRESENT_YEAR, k); if (r.L) urls.add(imageUrl(r.L, r.step)); });
  const [w, s, e, n] = h.L.bounds;
  return {
    layer, view, from, to, speed: to - from > 60 ? 4 : 3, ssps: ssps.length > 1 ? ssps : null, urls: [...urls],
    kicker: layer.title, title: [h.hazard.title, h.hazard.variants.length > 1 ? h.variant.label : null, h.measure?.label].filter(Boolean).join(" · "),
    fixed: h.hazard.variants.length > 1 ? "One map: it does not change with the years" : h.variant.label,
    at: m.at ?? [(w + e) / 2, (s + n) / 2], zoom: m.zoom ?? Z, bounds: h.L.bounds,
  };
}

/* ---- caption store, shared by the runner and the React parts ---- */
let cap = { running: false, kicker: "", title: "", sub: "", progress: null };
const watchers = new Set();
const caption = (patch) => { cap = { ...cap, ...patch }; watchers.forEach((fn) => fn()); };
const useCap = () => useSyncExternalStore((fn) => (watchers.add(fn), () => watchers.delete(fn)), () => cap);

/* ---- the runner: every wait checks that this round is still the one playing ---- */
let token = 0;
const STOPPED = Symbol("stopped");
const live = (t) => { if (t !== token) throw STOPPED; };
const sleep = (ms, t) => new Promise((r) => setTimeout(r, ms)).then(() => live(t));
async function until(test, t, ms = 8000) {
  const end = performance.now() + ms;
  while (!test() && performance.now() < end) await sleep(60, t);
  live(t);
}

/* Web Mercator position (0–1) of a longitude / latitude, and back */
const mx = (lng) => (lng + 180) / 360, lngOf = (x) => x * 360 - 180;
const my = (lat) => { const r = (lat * Math.PI) / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2; };
const latOf = (y) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;

/** The camera on `at` at `zoom`, or closer and moved in where needed so the map `bounds` [w, s, e, n] fill the whole
    screen, edge to edge (owner: no map edge on screen during the show). */
function cover(at, zoom, bounds) {
  const map = window.__map;
  if (!map || !bounds) return { center: at, zoom };
  const { clientWidth: W, clientHeight: H } = map.getContainer(), [w, s, e, n] = bounds;
  const z = Math.max(zoom, Math.log2(Math.max(W / (mx(e) - mx(w)), H / (my(s) - my(n))) / 512) + 0.08); // a little over, for the globe's curve
  const vw = W / (512 * 2 ** z) / 2, vh = H / (512 * 2 ** z) / 2;
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  return { center: [lngOf(clamp(mx(at[0]), mx(w) + vw, mx(e) - vw)), latOf(clamp(my(at[1]), my(n) + vh, my(s) - vh))], zoom: z };
}

let lastAt = null;
async function fly(at, zoomAsked, t, bounds = null, ms = 1800) {
  const map = window.__map;
  if (!map) return;
  const { center, zoom } = cover(at, zoomAsked, bounds);
  const key = `${center}|${zoom}`;
  if (key === lastAt) return; // already there
  lastAt = key;
  map.flyTo({ center, zoom, pitch: 0, bearing: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: ms, essential: true });
  await sleep(ms + 150, t);
}

function show(id) {
  if (getState().primaryLayer !== id) selectLayer(id);
  setState({ activeLayers: [id] });
}

/** Play the timeline from `from` to `to` at `speed`×; resolves when it gets there. */
async function playYears(from, to, speed, t) {
  await until(() => getState().yearTo >= Math.min(to, TIME_RANGE.max), t, 2500); // the timeline's end follows the open map (useTimeEnd in App.jsx)
  if (getState().yearTo < to) setYearTo(to);
  setYear(from);
  setState({ speed, loop: false, playing: true });
  await until(() => getState().year >= to || !getState().playing, t, (to - from + 10) * YEAR_MS * 4);
  setState({ playing: false });
}

async function playMap(catalog, p, t) {
  setPlayGate(null);
  setSsp("ssp245");
  setState({ amibView: { ...getState().amibView, [p.layer.id]: p.view }, floodId: null });
  show(p.layer.id);
  if (p.from != null) setYear(p.from);
  const ready = (y) => amibReady(catalog, p.layer, getState(), y);
  caption({ kicker: p.kicker, title: p.title, sub: p.from != null ? `${p.from}–${p.to} · timeline ${p.speed}×${p.ssps ? ` · ${sspName("ssp245")}` : ""}` : p.fixed });
  const flight = fly(p.at, p.zoom, t, p.bounds);
  await until(() => ready(getState().year), t);
  await flight;
  if (p.from != null) {
    setPlayGate(ready);
    await playYears(p.from, p.to, p.speed, t);
    setPlayGate(null);
    await sleep(700, t);
  } else await sleep(4000, t);
  for (const k of p.ssps ?? []) { // the last year under each emissions scenario
    setSsp(k);
    caption({ sub: `${getState().year} · ${sspName(k)}` });
    await until(() => ready(getState().year), t);
    await sleep(1300, t);
  }
}

async function playExposure(t) {
  setState({ activeLayers: [], floodId: null });
  selectLayer("sealevel");
  caption({ kicker: "Sea Level Rise", title: "Terrain exposure", sub: "Off" });
  await fly(SEA, Z_FLOOD, t);
  const levels = await fetch("data/sealevel/index.json").then((r) => (r.ok ? r.json() : null)).then((j) => j?.levels ?? []).catch(() => []);
  for (const l of [...levels, null]) {
    await sleep(1400, t);
    setState({ floodId: l?.id ?? null });
    caption({ sub: l ? `Land below +${l.level_m} m and open to the sea` : "Off" });
  }
  await sleep(1200, t);
}

async function playMangroves(t) {
  const layer = layerOf("mangroves"), man = await loadManifest(layer);
  setSsp("ssp245"); show("mangroves"); setYear(TIME_RANGE.from);
  caption({ kicker: layer.title, title: "Mangrove forest against 1990: standing, gained, lost", sub: `${TIME_RANGE.from}–${TIME_RANGE.to} · timeline 3×` });
  const at = middle(layer.focus), frame = man?.change?.frames.find((f) => { const [w, s, e, n] = f.bounds; return at[0] >= w && at[0] <= e && at[1] >= s && at[1] <= n; });
  await fly(at, Z, t, frame?.bounds); // the picture of that stretch of coast fills the screen
  await sleep(600, t);
  await playYears(TIME_RANGE.from, TIME_RANGE.to, 3, t);
  for (const k of SSP_ORDER) { setSsp(k); caption({ sub: `${TIME_RANGE.to} · ${sspName(k)}` }); await sleep(1500, t); }
  setSsp("ssp245");
}

async function playErosion(t) {
  const layer = layerOf("erosion");
  show("erosion"); setYear(TIME_RANGE.from);
  caption({ kicker: layer.title, title: "Eroded area through time", sub: `Mapped from 1985; after the last mapped period, a projection to ${TIME_RANGE.to} · timeline 3×` });
  await fly(middle(layer.focus), Z, t);
  await sleep(600, t);
  await playYears(TIME_RANGE.from, TIME_RANGE.to, 3, t);
  await sleep(1200, t);
}

async function playPlastics(t) {
  const layer = layerOf("microplastics"), d = await loadPlastics();
  const pts = d ? pointsGeojson(d).features.filter((f) => f.properties.kind === "stations").map((f) => f.geometry.coordinates) : [];
  show("microplastics");
  caption({ kicker: layer.title, title: "Plastic debris at the sampling stations", sub: "Pieces per m², with published sites along the coast" });
  const at = pts.length ? [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length] : middle(layer.focus);
  await fly(at, Z, t);
  await sleep(5000, t);
}

const omIdle = (t) => until(() => !om.omState().loading, t, 6000);

async function playOcean(t) {
  setSsp("ssp245");
  show("ocean");
  caption({ kicker: "Ocean & Fisheries", title: "Ocean monitoring", sub: "" });
  await om.start();
  await sleep(900, t); // the layer opens its own tab first (useOmTab)
  const [[w, s], [e, n]] = layerOf("ocean").focus; // the EEZ, as wide as fills the screen edge to edge
  await fly(middle(layerOf("ocean").focus), 0, t, [w, s, e, n]);
  for (const { tab, id } of await om.listAll()) {
    live(t);
    caption({ title: `${tab.title} · ${tab.steps}`, sub: "" });
    if (!id) await om.selectTab(tab.id); else await om.selectLayer(id);
    await omIdle(t);
    const entries = om.omState().entries, n = entries.length;
    if (n < 2) { await sleep(om.omState().card ? 5000 : 3000, t); continue; }
    const drivers = entries[0].kind === "drv", speed = n > 60 ? 4 : 3;
    caption({ sub: drivers ? `Each ${entries[0].step} in turn` : `${entries[0].year}–${entries[n - 1].year} · slider ${speed}×` });
    om.setIdx(0);
    await omIdle(t);
    await sleep(500, t);
    for (let i = 1; i < n; i++) { om.setIdx(i); await omIdle(t); await sleep(drivers ? 1200 : YEAR_MS / speed, t); }
    if (entries[n - 1].kind === "proj") {
      for (const k of SSP_ORDER) { setSsp(k); caption({ sub: `${entries[n - 1].year} · ${sspName(k)}` }); await sleep(150, t); await omIdle(t); await sleep(1300, t); }
      setSsp("ssp245");
    }
    await sleep(900, t);
  }
}

/* Nutrients & Plankton (2026-11-11): the NDMA package's yearly satellite maps played like the timeline (3×), then the field
   records from open databases, a few seconds each. The camera fills the screen with the package's grid (60-70° E, 20-27° N). */
const npGrid = () => { const g = np.data()?.hist?.grid; return g ? [g.west, g.north - g.height * g.cell_deg, g.west + g.width * g.cell_deg, g.north] : [60, 20, 70, 27]; };
const NP_MEASURED = [["chlorophyll_a_insitu", "surface", "Chlorophyll from float and ship sensors, surface"], ["phosphate", "surface", "Phosphate at the surface, ship bottles"], ["silicate", "upper", "Silicate at 10-200 m, ship bottles"], ["dissolved_oxygen", "deep", "Oxygen below 200 m: the oxygen-poor layer"]];
async function playNutrients(t) {
  show("nutrients");
  caption({ kicker: "Nutrients & Plankton", title: "Algae, nutrients and plankton", sub: "" });
  await np.start();
  await sleep(900, t);
  const D = np.data();
  if (!D?.hist && !D?.insitu) return;
  const [w, s, e, n] = npGrid();
  await fly([(w + e) / 2, (s + n) / 2], 0, t, [w, s, e, n]);
  if (D.hist) for (const id of ["hist_chl_year", "hist_sst_year"]) {
    live(t);
    np.selectLayer(id);
    const f = np.histFrames(id);
    caption({ title: np.LAYERS[id].title, sub: "Year by year · 3×" });
    for (let i = 0; i < f.length; i++) { np.setHi(i); await sleep(i ? YEAR_MS / 3 : 900, t); }
    await sleep(1500, t);
  }
  if (D.insitu) {
    np.selectLayer("ins_plankton");
    caption({ title: "Plankton species records", sub: `${D.insitu.plankton.records.toLocaleString("en")} records · presence, not amounts` });
    await sleep(5000, t);
    const have = new Set(D.insitu.measured.map((m) => m.v));
    for (const [v, band, title] of NP_MEASURED.filter(([v]) => have.has(v))) {
      if (!D.insitu.measured.length) break;
      np.selectLayer("ins_measured"); np.setInsVar(v); np.setInsDepth(band);
      caption({ title, sub: "Measured in the water · one dot per reading" });
      await sleep(4000, t);
    }
    np.setInsDepth("surface"); np.setInsVar(null);
  }
}

/** Download every picture of the script once, so the first round plays as smoothly as the next ones. */
let warmed = false;
async function warm(plans, t) {
  caption({ kicker: "Showcase", title: "Preparing the show", sub: "Loading every map once, so it plays smoothly", progress: 0 });
  const urls = new Set(plans.flatMap((p) => p.urls));
  const mangroves = layerOf("mangroves"), man = await loadManifest(mangroves);
  if (man?.change) {
    const base = new URL(mangroves.mapLayer.endpoint, location.href).href;
    for (const sc of ["good", "normal", "worst"]) for (let y = TIME_RANGE.from; y <= TIME_RANGE.to; y++) {
      const p = pickTiles(man, y, sc);
      if (p) man.change.frames.forEach((f) => urls.add(`${base}${f.id}/${p.scenario}/${p.year}.png`));
    }
  }
  const ocean = (await om.listAll()).filter((x) => x.id);
  const list = [...urls], total = list.length + ocean.length;
  let done = 0;
  const tick = () => caption({ progress: ++done / total });
  const worker = async () => { for (let u = list.shift(); u; u = list.shift()) { live(t); await fetch(u).then((r) => r.blob()).catch(() => null); tick(); } };
  await Promise.all([1, 2, 3, 4, 5, 6].map(worker));
  for (const x of ocean) { live(t); await om.preload(x.id); tick(); }
  await np.start(); // the NDMA yearly pictures (56 small PNGs), when the package is loaded
  if (np.data()?.hist) await Promise.all(["chl_year", "sst_year"].flatMap((set) => np.data().hist.sets[set].frames.map((f) => fetch(`api/ndma/${set}/${f.key}.png`).then((r) => r.blob()).catch(() => null))));
  await Promise.all([loadManifest(layerOf("erosion")), loadPlastics()]);
  caption({ progress: null });
  warmed = true;
}

/** One round, in parts; `from` (?showcase=<part>) starts the first round at that part. */
async function round(catalog, plans, t, from) {
  setPlayGate(null);
  setState({ playing: false, floodId: null });
  setSsp("ssp245");
  lastAt = null;
  const maps = (id) => async () => { for (const p of plans.filter((x) => x.layer.id === id)) await playMap(catalog, p, t); };
  const parts = [
    ["coast", async () => {
      caption({ kicker: "Nereus Sentinel", title: "Pakistan's coast, 1990 to 2100", sub: "Every layer, playing by itself" });
      document.querySelector('.map-tools [data-act="reset"]')?.click(); // every layer off, the whole coast
      await sleep(3800, t);
      await playExposure(t);
    }],
    ["sealevel", maps("sealevel")], ["intrusion", maps("intrusion")], ["salinity", maps("salinity")], ["hazards", maps("hazards")],
    ["mangroves", () => playMangroves(t)], ["erosion", () => playErosion(t)], ["plastics", () => playPlastics(t)], ["ocean", () => playOcean(t)], ["nutrients", () => playNutrients(t)],
  ];
  const start = Math.max(0, parts.findIndex(([k]) => k === from));
  for (const [, play] of parts.slice(start)) await play();
}

/* ---- start and stop ---- */
let reopen = []; // the panel handles closed for the show, to open again after it
const tick = () => new Promise((r) => setTimeout(r, 90));
async function hidePanels() {
  reopen = [...document.querySelectorAll(".panel-handle[aria-expanded='true']")];
  for (const b of reopen) { b.click(); await tick(); } // one at a time: each click sees the other panel's new state
}
async function showPanels() {
  for (const b of reopen) { if (b.isConnected && b.getAttribute("aria-expanded") === "false") { b.click(); await tick(); } }
  reopen = [];
}

export async function startShowcase() {
  if (cap.running) return;
  const t = ++token;
  caption({ running: true, kicker: "Showcase", title: "Starting", sub: "", progress: null });
  document.body.classList.add("showcasing");
  try {
    await hidePanels();
    const catalog = await loadAmibCatalog();
    const plans = catalog ? MAPS.map((m) => plan(catalog, m)).filter(Boolean) : [];
    if (!warmed) await warm(plans, t);
    let from = new URLSearchParams(location.search).get("showcase");
    for (;;) { await round(catalog, plans, t, from); from = null; }
  } catch (e) {
    if (e !== STOPPED) { console.warn("Showcase stopped:", e); stopShowcase(); }
  }
}

export function stopShowcase() {
  if (!cap.running) return;
  token++;
  setPlayGate(null);
  om.stop(); np.stop();
  setState({ playing: false, speed: 1 });
  setSsp("ssp245");
  document.body.classList.remove("showcasing");
  lastAt = null;
  caption({ running: false, progress: null });
  showPanels();
}

function Caption() {
  const c = useCap();
  return (
    <div className="show-cap" role="status" aria-live="polite">
      <div className="show-k"><i className="show-dot" />{c.kicker}</div>
      <div className="show-t">{c.title}</div>
      {c.sub ? <div className="show-s">{c.sub}</div> : null}
      {c.progress != null ? <div className="show-bar"><i style={{ width: `${Math.round(c.progress * 100)}%` }} /></div> : null}
      <button className="show-stop" title="Stop the showcase (Esc)" onClick={stopShowcase}>Stop</button>
    </div>
  );
}

/** The caption while the showcase plays. Mounted once, in App. */
export function Showcase() {
  const running = useCap().running;
  useEffect(() => {
    if (!running) return undefined;
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); stopShowcase(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [running]);
  return running ? createPortal(<Caption />, document.body) : null;
}

/** The round button above the tour button, its ring always turning: it starts the showcase. */
export function ShowcaseButton() {
  return (
    <button className="show-btn" aria-label="Play the showcase: every layer by itself" title="Showcase: every layer plays by itself (Esc stops)" onClick={startShowcase}>
      <span className="show-ring" />
      <Icon filled paths='<path d="M9.5 7.5v9l7.5-4.5Z"/>' />
    </button>
  );
}
