/**
 * The ocean monitoring package (Pakistan Ocean Climate Portal, Sir Tayyab / Rana Hasnain) inside the portal: the React
 * version of its webapp/js/app.js. This module is the controller: which tab and layer are open, the year slider, the
 * raster on the portal's map, compare, measurement points, the national cards and the right panel. The React parts in
 * this folder draw from its state (useOm); the package's own modules (virtual:ocean-monitoring, see vite.config.js)
 * draw the panel's charts, tables and key points, so every number and sentence is the package's.
 *
 * Differences from the package's app, all about fitting the portal:
 *   - the map is the portal's map (src/components/MapView.jsx); the raster, outlines and dots are added to it while the
 *     Ocean or Fisheries layer is on, and Compare opens a second map beside it (Map2 in OceanMonitoring.jsx);
 *   - the emissions scenario is the portal's one (state.oceanScenario), so keys 1-3 and the SSP keys of other layers agree;
 *   - colours are for the portal's dark panels (onDark), the national cards sit in the free map area through CSS.
 */
import { useSyncExternalStore } from "react";
import maplibregl from "maplibre-gl";
import * as P from "virtual:ocean-monitoring";
import { getState, subscribe as subscribeApp, setSsp, focusLayer } from "../state.js";

const { Core, Panel, Numbers, KeyPoints, TABS, LAYER_SETS, LAYER_CHART, CHARTS, COMPARE, LAYER_FINDINGS, DRIVER_OF, DONUTS, MEAS, CHECKS, SCEN, REGIONS, CMAPS } = P;
export const available = P.available;
export { TABS, SCEN, REGIONS };

/* ---------------- state shared with the React parts */
let S = {
  ready: false, error: null,
  tab: null, layer: null, open: [], groupsOpen: [], vectors: { eez: true, subregions: true, study_box: false },
  entries: [], idx: 0, region: "Whole EEZ", opacity: 0.92, playing: false, loading: false,
  title: null, legend: null, card: null, compare: false, cmp: null, meas: null, measOn: false, splitL: "", splitR: "",
};
const listeners = new Set();
const emit = (patch) => { S = { ...S, ...patch }; listeners.forEach((f) => f()); };
const subscribe = (f) => (listeners.add(f), () => listeners.delete(f));
/** A part of the state, for a React component: const idx = useOm((s) => s.idx). */
export const useOm = (pick) => useSyncExternalStore(subscribe, () => pick(S));
export const omState = () => S;

let L = {}, F = {}, eez = null, current = null, ZONAL = null;
const tabOf = {};
export const layers = () => L;
const scenario = () => getState().oceanScenario;

/** A theme colour that reads on the portal's dark panels: dark ones are lightened, light ones kept. */
export function onDark(c) {
  if (!/^#[0-9a-f]{6}$/i.test(c || "")) return c;
  const rgb = [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16));
  const lum = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
  if (lum >= 0.55) return c;
  const t = (0.62 - lum) / (1 - lum);
  return `#${rgb.map((v) => Math.round(v + (255 - v) * t).toString(16).padStart(2, "0")).join("")}`;
}
export const tabColor = (t) => onDark(t?.color ?? "#5B3F8C");
const tabOfLayer = (id) => TABS.find((x) => x.id === (tabOf[id] || S.tab)) || TABS[1];
const chartKey = (id) => { const m = LAYER_CHART.find(([re]) => re.test(id)); return m ? m[1] : null; };
const cleanTitle = (t) => t.replace(/, each year \(time slider\)| \(time slider\)/, "");

/* ---------------- start: the catalog, the findings, the EEZ (once) */
let started = null;
export function start() {
  if (!available) { emit({ error: "The ocean monitoring package is not installed on this computer (Other Data/AMHK/ocean-monitoring_*)." }); return Promise.resolve(); }
  started ??= (async () => {
    const cat = await Core.json("catalog.json");
    cat.layers.forEach((l) => { L[l.id] = l; });
    Object.entries(LAYER_SETS).forEach(([id, D]) => {
      const first = L[D.items[0][0]]; if (!first) return;
      L[id] = { id, type: "layer_set", step: D.step, title: D.title, shows: D.shows, period: first.period, units: first.units, badges: first.badges, items: D.items.filter(([x]) => L[x]) };
    });
    const f = await Core.json("findings/findings.json");
    (f.findings || f).forEach((x) => { F[x.id] = x; });
    eez = (await Core.json(L.eez.path)).features[0];
    const linked = new Set(Object.values(COMPARE).map((c) => c.with));
    TABS.forEach((t) => {
      (t.groups || []).forEach((g) => g.layers.filter((id) => L[id] && !linked.has(id)).forEach((id) => { tabOf[id] = t.id; (L[id].items || []).forEach(([x]) => { tabOf[x] = t.id; }); }));
      (t.chartOnly || []).forEach((c) => { tabOf[c.id] = t.id; });
    });
    emit({ ready: true });
  })().catch((e) => { console.error(e); emit({ error: `The ocean monitoring data could not be read (${e.message}).` }); });
  return started;
}

/** The layers of a group as listed in the left panel (linked comparison layers are reached through Compare). */
export function groupLayers(g) {
  const linked = new Set(Object.values(COMPARE).map((c) => c.with));
  return g.layers.filter((id) => L[id] && !linked.has(id));
}

/** Every entry of the left panel in its order, EEZ boundary to National index: [{ tab, id }] (id null for the EEZ tab). For the showcase. */
export async function listAll() {
  await start();
  return TABS.flatMap((t) => (t.vectors ? [{ tab: t, id: null }] : [...(t.groups || []).flatMap((g) => groupLayers(g)), ...(t.chartOnly || []).map((c) => c.id)].map((id) => ({ tab: t, id }))));
}

/** Read every map a layer's slider steps through (each scenario's projections too), so playing it never waits. For the showcase. */
export async function preload(id) {
  await start();
  const l = L[id];
  if (!l) return;
  const paths = entriesOf(l).flatMap((e) => (e.kind === "proj" ? Object.keys(SCEN).map((k) => e.proj.path.replace("{scenario}", k).replace("{year}", e.year)) : [e.path]));
  await Promise.all(paths.map((p) => Core.raster(p).catch(() => null)));
}

/* ---------------- left panel */
export function toggleTab(id) {
  const open = !S.open.includes(id);
  emit({ open: open ? [id] : S.open.filter((x) => x !== id) });
  if (open && S.tab !== id) selectTab(id);
}
export function toggleGroup(key) { emit({ groupsOpen: S.groupsOpen.includes(key) ? S.groupsOpen.filter((x) => x !== key) : [...S.groupsOpen, key] }); }

export async function selectTab(id) {
  await start();
  const t = TABS.find((x) => x.id === id); if (!t) return;
  emit({ tab: id, open: [id] });
  if (t.vectors) { await selectLayer(null, "eez"); return; }
  if (tabOf[S.layer] !== id) await selectLayer(t.first);
}

export function setVector(v, on) {
  emit({ vectors: { ...S.vectors, [v]: on } });
  applyVectors();
}

/* ---------------- layer selection */
function entriesOf(l) {
  if (l.type === "layer_set") return l.items.map(([id, label]) => ({ kind: "drv", label, step: l.step, layer: L[id], path: L[id].path, year: null }));
  if (l.type !== "raster_series") return [{ path: l.path, year: null, kind: "single" }];
  const out = l.years.map((y) => ({ year: y, kind: "obs", path: l.path.replace("{year}", y) }));
  const p = l.projection && L[l.projection];
  if (p) p.years.forEach((y) => out.push({ year: y, kind: "proj", proj: p }));
  return out;
}

export async function selectLayer(id, chartOverride, opts = {}) {
  await start();
  stop();
  current = null;
  const l = L[id];
  const groupKey = l ? TABS.flatMap((t) => (t.groups || []).map((g) => [`${t.id}:${g.title}`, g])).find(([, g]) => g.layers.includes(id))?.[0] : null;
  emit({ layer: id, card: null, click: null, groupsOpen: groupKey && !S.groupsOpen.includes(groupKey) ? [...S.groupsOpen, groupKey] : S.groupsOpen });
  setPin(null);
  if (!l) {
    emit({ cmp: null, entries: [], legend: null });
    if (S.compare) await setCompare(false, true);
    hideRaster();
    if (DONUTS[id]) { await startCard(id); return; }
    const t = TABS.find((x) => x.id === (tabOf[id] || S.tab));
    emit({ title: { k: `${t.title} · ${t.steps}`, color: tabColor(t), v: t.vectors ? "Pakistan EEZ and its three sub-regions" : (t.chartOnly.find((c) => c.id === id) || {}).title,
      s: t.vectors ? "The frame of every layer: the EEZ (Marine Regions v12), Sindh shelf, Makran shelf and the offshore EEZ."
        : "National numbers (FAO and the Step 11 index) have no location, so they are shown as a card, not on the map. More charts are in the right panel." } });
    if (id === "nindex") emit({ card: { id: "nindex" } });
    await renderPanel(chartOverride || id, null);
    return;
  }
  const entries = entriesOf(l);
  const lastObs = entries.filter((e) => e.kind !== "proj").length - 1;
  const idx = l.type === "layer_set" ? 0 : opts.year ? Math.max(0, entries.findIndex((e) => e.year === opts.year)) : lastObs;
  if (opts.scenario) setSsp(opts.scenario);
  emit({ entries, idx });
  await showEntry();
}

let showToken = 0;
async function showEntry() {
  if (S.card?.id === "catch") { await showCard(); return; }
  const e = S.entries[S.idx]; if (!e) return;
  const l = e.layer || L[S.layer]; // a driver entry carries its own layer
  const my = ++showToken; // only the latest request may change the map and the panel
  emit({ loading: true });
  try {
    const path = e.kind === "proj" ? e.proj.path.replace("{scenario}", scenario()).replace("{year}", e.year) : e.path;
    const r = await Core.raster(path);
    if (my !== showToken) return;
    S.path = path;
    current = { r, l, e, path };
    drawRaster();
    await drawPartner(l);
  } catch (err) { if (err?.name !== "AbortError") console.error(err); }
  if (my !== showToken) return;
  emit({ loading: false, title: titleOf(l, e), legend: legendOf(l, e), cmp: cmpOf(l) });
  if (S.compare && !cmpOf(l)) await setCompare(false, true);
  await renderPanel(chartKey(S.layer), l);
}

/** Move the slider to entry i (a year, a projection decade or a driver). */
export function setIdx(i) {
  i = Math.max(0, Math.min(S.entries.length - 1, i));
  if (i === S.idx) return;
  emit({ idx: i });
  showEntry();
}
export function stepBy(d) { stop(); setIdx(S.idx + d); }

/** The emissions scenario (portal-wide: keys 1-3, the SSP keys of other layers and the slider's buttons). */
export function pickScenario(k) { setSsp(k); }
let lastScenario = getState().oceanScenario;
subscribeApp((s) => {
  if (s.oceanScenario === lastScenario) return;
  lastScenario = s.oceanScenario;
  if (!S.ready) return;
  if (S.entries[S.idx]?.kind === "proj") showEntry();
  else if (S.layer) renderPanel(L[S.layer] ? chartKey(S.layer) : S.layer, L[S.layer] ?? null);
});

function titleOf(l, e) {
  const t = tabOfLayer(l.id);
  const when = e.kind === "proj" ? `${e.year} (decade ${e.year - 5}-${e.year + 4}), ${SCEN[scenario()].label} emissions` : e.year ? String(e.year) : l.period || "";
  return { k: `${t.title} · ${t.steps}${e.kind === "proj" ? " · projection" : ""}`, color: tabColor(t), v: cleanTitle(l.title), when, s: (e.kind === "proj" ? e.proj.shows : l.shows) || "" };
}

/* decimals for a layer's values: heatwave days are counted in whole days, and shown as whole days (Rana) */
const dig = (l, d) => (/day/.test((l && l.units) || "") ? 0 : d);
const scaleOf = (l, Pl) => (COMPARE[l.id].same ? { colormap: l.colormap, vmin: l.vmin, vmax: l.vmax } : { colormap: Pl.colormap, vmin: Pl.vmin, vmax: Pl.vmax });

/** The legend as HTML, the package's legend() for the portal's dark legend card. */
function legendOf(l, e) {
  const u = l.units || "";
  const classes = (cl) => Object.entries(cl).map(([c, lab]) => `<div class="cls"><i style="background:${CMAPS.categorical[c]}"></i>${lab}</div>`).join("");
  if (l.colormap === "categorical") {
    return `<div class="t"><b>${l.title.split(",")[0]}</b></div>${classes(l.classes)}${S.compare && COMPARE[l.id] ? `<div class="d">Left: ${l.period} · Right: ${COMPARE[l.id].label} (same classes)</div>` : ""}`;
  }
  const ticks = (vmin, vmax, at, ll) => at.map((f) => `<span style="left:${f * 100}%">${Core.fmt(vmin + f * (vmax - vmin), dig(ll, Math.abs(vmax - vmin) < 0.1 ? 4 : 3))}</span>`).join("");
  let html = `<div class="t"><b>${S.compare && COMPARE[l.id] ? '<span class="side-tag">Left</span> ' : ""}${l.title.split(/,| \(/)[0]}</b><span>${u}</span></div>
    <div class="ramp" style="background:${Core.gradientCSS(l.colormap)}"></div><div class="r">${ticks(l.vmin, l.vmax, [0, 0.25, 0.5, 0.75, 1], l)}</div>
    ${l.overlay ? `<div class="d"><i></i>${l.overlay.legend}</div>` : ""}
    ${l.projection ? '<div class="d p">One colour scale before and after 2024, so observed and projected maps compare directly.</div>' : ""}
    ${e.kind === "proj" ? `<div class="d p">Projection: ${e.proj.product}</div>` : ""}`;
  const C = COMPARE[l.id], Pl = C && L[C.with];
  if (S.compare && Pl) {
    const sc = scaleOf(l, Pl);
    html += `<div class="two"><div class="t"><b><span class="side-tag">Right</span> ${C.label}</b><span>${Pl.units || ""}</span></div>
      ${Pl.colormap === "categorical" ? classes(Pl.classes) : C.same ? `<div class="d">Same colour scale as the left side: ${Pl.title}.</div>`
        : `<div class="ramp" style="background:${Core.gradientCSS(sc.colormap)}"></div><div class="r">${ticks(sc.vmin, sc.vmax, [0, 0.5, 1], Pl)}</div>`}</div>`;
  }
  return html;
}

/* ---------------- the portal's map */
let map = null, attachedFor = null, labels = [];
const BLANK = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const EMPTY = { type: "FeatureCollection", features: [] };
const IDS = ["om-ras", "om-box", "om-sub", "om-eez", "om-dots", "om-meas", "om-pin"];
const SUB_LABELS = [["Sindh shelf", 67.05, 24.2], ["Makran shelf", 63.3, 25.18], ["Offshore EEZ", 63.6, 22.6]];

/** The Ocean or Fisheries layer went on the map (src/map/renderers.js): add the package's sources and draw. */
export async function attach(m, portalLayerId) {
  map = m; attachedFor = portalLayerId;
  await start();
  if (map !== m || !S.ready) return;
  const [box, sub] = await Promise.all([Core.json(L.study_box.path), Core.json(L.subregions.path)]);
  if (map !== m || map.getSource("om-ras")) return; // everything below is added at once: nothing may find half of it
  const before = ["pakistan-border-edge", "pakistan-border"].find((id) => map.getLayer(id));
  map.addSource("om-ras", { type: "image", url: BLANK, coordinates: [[60, 26], [69, 26], [69, 21], [60, 21]] });
  map.addLayer({ id: "om-ras", type: "raster", source: "om-ras", layout: { visibility: "none" }, paint: { "raster-opacity": S.opacity, "raster-resampling": "nearest", "raster-fade-duration": 0 } }, before);
  map.addSource("om-box", { type: "geojson", data: box });
  map.addLayer({ id: "om-box", type: "line", source: "om-box", layout: { visibility: "none" }, paint: { "line-color": "#9db4b7", "line-width": 1, "line-dasharray": [1, 2] } });
  map.addSource("om-sub", { type: "geojson", data: sub });
  map.addLayer({ id: "om-sub", type: "line", source: "om-sub", paint: { "line-color": "#cbd5e1", "line-width": 1, "line-opacity": 0.8, "line-dasharray": [3, 2] } });
  map.addSource("om-eez", { type: "geojson", data: { type: "FeatureCollection", features: [eez] } });
  map.addLayer({ id: "om-eez", type: "line", source: "om-eez", paint: { "line-color": "#e6eef0", "line-width": 1.6 } });
  map.addSource("om-dots", { type: "geojson", data: EMPTY });
  map.addLayer({ id: "om-dots", type: "circle", source: "om-dots", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 1.1, 8, 2.6], "circle-color": "#111" } });
  map.addSource("om-meas", { type: "geojson", data: EMPTY });
  map.addLayer({ id: "om-meas", type: "circle", source: "om-meas", layout: { visibility: "none" }, paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 4, 8, 7], "circle-color": ["get", "_c"], "circle-stroke-color": "#fff", "circle-stroke-width": 1.6, "circle-opacity": 0.92 } });
  map.addSource("om-pin", { type: "geojson", data: EMPTY });
  map.addLayer({ id: "om-pin", type: "circle", source: "om-pin", paint: { "circle-radius": 7, "circle-color": "#0369A1", "circle-stroke-color": "#fff", "circle-stroke-width": 3 } });
  labels = SUB_LABELS.map(([name, x, y]) => new maplibregl.Marker({ element: Object.assign(document.createElement("div"), { className: "om-sublabel", textContent: name }) }).setLngLat([x, y]).addTo(map));
  map.on("click", onClick);
  map.on("mouseenter", "om-meas", pointer); map.on("mouseleave", "om-meas", unpointer);
  applyVectors(); applyMeas();
  if (current) { drawRaster(); map.getSource("om-dots").setData(current.dots ?? EMPTY); }
  if (S.compare) layoutCompare();
}
const pointer = () => { map.getCanvas().style.cursor = "pointer"; }, unpointer = () => { map.getCanvas().style.cursor = ""; };

/** The layer came off the map. */
export function detach(m, portalLayerId) {
  if (m !== map || portalLayerId !== attachedFor) return;
  stop();
  if (S.compare) setCompare(false, true);
  map.off("click", onClick); map.off("mouseenter", "om-meas", pointer); map.off("mouseleave", "om-meas", unpointer);
  labels.forEach((x) => x.remove()); labels = [];
  [...IDS].reverse().forEach((id) => { if (map.getLayer(id)) map.removeLayer(id); if (map.getSource(id)) map.removeSource(id); });
  popups.forEach((p) => p.remove()); popups = [];
  map = null; attachedFor = null;
}
export const attachedLayer = () => attachedFor;

function drawRaster() {
  if (!map?.getSource("om-ras") || !current) return;
  const img = Core.draw(current.r, current.l, eez.geometry, 14);
  map.getSource("om-ras").updateImage({ url: img.url, coordinates: img.coords });
  map.setLayoutProperty("om-ras", "visibility", "visible");
  (async () => {
    const l = current.l, dots = l.overlay ? await Core.json(l.overlay.path) : EMPTY;
    if (current?.l !== l) return;
    current.dots = dots;
    map?.getSource("om-dots")?.setData(dots);
  })();
}
function hideRaster() {
  if (map?.getLayer("om-ras")) map.setLayoutProperty("om-ras", "visibility", "none");
  map?.getSource("om-dots")?.setData(EMPTY);
}
function applyVectors() {
  if (!map?.getLayer("om-eez")) return;
  const vis = (on) => (on ? "visible" : "none");
  map.setLayoutProperty("om-eez", "visibility", vis(S.vectors.eez));
  map.setLayoutProperty("om-sub", "visibility", vis(S.vectors.subregions));
  map.setLayoutProperty("om-box", "visibility", vis(S.vectors.study_box));
  labels.forEach((m) => { m.getElement().style.display = S.vectors.subregions ? "" : "none"; });
}
export function setOpacity(v) {
  emit({ opacity: v });
  [map, map2].forEach((m) => m?.getLayer("om-ras") && m.setPaintProperty("om-ras", "raster-opacity", v));
}
function setPin(p) { map?.getSource("om-pin")?.setData(p ? { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Point", coordinates: p } }] } : EMPTY); }

/* ---------------- compare: the linked layer on a second map beside the first (Map2 in OceanMonitoring.jsx) */
let map2 = null, map2Ready = null, syncing = false;
const cmpOf = (l) => { const C = l && COMPARE[l.id]; return C && L[C.with] ? { label: C.label } : null; };
/** The second map, created by Map2 in its own element. */
export function initMap2(container, style) {
  const main = map;
  map2 = new maplibregl.Map({ container, style, attributionControl: false, interactive: true, center: main?.getCenter() ?? [64.8, 23.4], zoom: main?.getZoom() ?? 5.4 });
  const mine = map2;
  map2Ready = new Promise((res) => map2.on("load", () => {
    map2.addSource("om-ras", { type: "image", url: BLANK, coordinates: [[60, 26], [69, 26], [69, 21], [60, 21]] });
    map2.addLayer({ id: "om-ras", type: "raster", source: "om-ras", paint: { "raster-opacity": S.opacity, "raster-resampling": "nearest", "raster-fade-duration": 0 } });
    Core.json(L.subregions.path).then((g) => { if (!map2) return; map2.addSource("om-sub", { type: "geojson", data: g }); map2.addLayer({ id: "om-sub", type: "line", source: "om-sub", paint: { "line-color": "#cbd5e1", "line-width": 1, "line-opacity": 0.8, "line-dasharray": [3, 2] } }); });
    map2.addSource("om-eez", { type: "geojson", data: { type: "FeatureCollection", features: [eez] } });
    map2.addLayer({ id: "om-eez", type: "line", source: "om-eez", paint: { "line-color": "#e6eef0", "line-width": 1.6 } });
    map2.on("click", onClick);
    // the two maps move together, whichever one is dragged or zoomed
    const follow = (a, b) => () => { if (syncing || !a || !b) return; syncing = true; b.jumpTo({ center: a.getCenter(), zoom: a.getZoom(), bearing: a.getBearing(), pitch: a.getPitch() }); syncing = false; };
    mine.__follow = [follow(main, mine), follow(mine, main)];
    main?.on("move", mine.__follow[0]); mine.on("move", mine.__follow[1]);
    mine.__follow[0]();
    res();
  }));
  if (current && S.compare) drawPartner(current.l);
  return () => {
    if (mine.__follow) main?.off("move", mine.__follow[0]);
    mine.remove();
    if (map2 === mine) { map2 = null; map2Ready = null; }
  };
}
async function drawPartner(l) {
  const C = COMPARE[l.id];
  if (!S.compare || !C || !L[C.with] || !map2Ready) return;
  await map2Ready;
  const Pl = L[C.with], r = await Core.raster(Pl.path);
  const img = Core.draw(r, Object.assign({}, Pl, scaleOf(l, Pl)), eez.geometry, 14);
  map2.getSource("om-ras").updateImage({ url: img.url, coordinates: img.coords });
  map2.setPaintProperty("om-ras", "raster-opacity", S.opacity);
  if (current) current.partner = { r, P: Pl };
  const e = S.entries[S.idx] || {};
  emit({ splitL: `${l.title.replace(/ \(CMEMS-LSCE\)|, each year \(time slider\)| \(time slider\)/g, "")}${e.year ? ` · ${e.year}` : ""}`, splitR: C.label });
}
/** Where the two maps meet: the main map keeps its EEZ in the left half of the free area (map padding). */
let half = null;
export function setHalf(h) { half = h; layoutCompare(); }
function layoutCompare() {
  if (!map) return;
  if (!S.compare || !half) { map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 }); return; }
  map.setPadding({ top: 0, bottom: 0, left: half.left, right: map.getContainer().clientWidth - half.mid });
  map.fitBounds([[61.4, 20.98], [68.76, 25.6]], { padding: { top: 150, bottom: 230, left: 20, right: 20 }, pitch: 0, bearing: 0, duration: 0 });
  map2?.__follow?.[0]();
}
export async function setCompare(on, quiet) {
  if (!quiet || !on) emit({ compare: on && !!cmpOf(current?.l) });
  if (!S.compare && half) { half = null; layoutCompare(); if (attachedFor) focusLayer(attachedFor); } // back to the whole EEZ, framed between the panels
  if (current) {
    emit({ legend: legendOf(current.l, current.e) });
    if (S.compare) await drawPartner(current.l);
    if (!quiet) await renderPanel(chartKey(S.layer), current.l);
  }
}

/* ---------------- national cards (no location in the data): in the free map area */
async function startCard(id) {
  const D = DONUTS[id];
  const rows = (await Core.csv(D.file)).sort((a, b) => a.year - b.year);
  emit({ card: { id: D.card ? "catch" : id, D, rows }, entries: rows.map((r) => ({ year: r.year, kind: "obs" })), idx: rows.length - 1 });
  await showCard();
}
async function showCard() {
  const { D, rows } = S.card, r = rows[S.idx], t = tabOfLayer(S.layer);
  emit({ title: { k: `${t.title} · ${t.steps}`, color: tabColor(t), v: `${D.title}, ${r.year}`, s: "FAO catch for all of Pakistan: the data has no location, so it is shown as a card, not on the map. Move the slider to see it change since 1950." } });
  await renderPanel(S.layer, null);
}
export const cardYearRow = () => S.card?.rows?.[S.idx];

/* ---------------- year slider */
export function play() {
  if (S.playing) { stop(); return; }
  if (S.idx >= S.entries.length - 1) setIdx(0);
  emit({ playing: true });
  timer = setInterval(() => { if (S.idx >= S.entries.length - 1) { stop(); return; } setIdx(S.idx + 1); }, 700);
}
let timer = 0;
export function stop() { if (timer) clearInterval(timer); timer = 0; if (S.playing) emit({ playing: false }); }

/* ---------------- click a place */
let popups = [];
const popup = (lngLat, html, on) => { const p = new maplibregl.Popup({ closeButton: false, offset: 10, maxWidth: "300px", className: "om-pop" }).setLngLat(lngLat).setHTML(html).addTo(on || map); popups.push(p); return p; };
async function onClick(ev) {
  const on = ev.target, hit = S.measOn && on === map && map.getLayer("om-meas") && map.queryRenderedFeatures(ev.point, { layers: ["om-meas"] })[0];
  if (hit) {
    const p = hit.properties;
    popup(hit.geometry.coordinates, `<div class="src">${p.source} · ${p.date}</div><b>${p.measured || ""}</b>${p.product ? `<div class="row">Products: ${p.product}</div>` : ""}
      <div class="row muted">${p.cruise || ""}${p.n > 1 ? ` · ${p.n} measurements` : ""}</div>`, on);
    return;
  }
  if (!current || !S.layer || !L[S.layer]) return;
  const { lng, lat } = ev.lngLat, l = current.l;
  const v = Core.valueAt(current.r, lng, lat);
  if (!isFinite(v)) return;
  setPin([lng, lat]);
  let lab = l.classes ? l.classes[String(Math.round(v))] : `${Core.fmt(v, dig(l, 4))} ${l.units || ""}`;
  if (S.compare && current.partner) {
    const v2 = Core.valueAt(current.partner.r, lng, lat), Pl = current.partner.P;
    if (isFinite(v2)) lab = `Left: ${lab}<br>Right (${COMPARE[l.id].label}): <b>${Core.fmt(v2, dig(Pl, 4))} ${Pl.units || ""}</b>`;
  }
  popup(ev.lngLat, `<b>${lab}</b><br><span class="muted">${lat.toFixed(2)}° N, ${lng.toFixed(2)}° E</span>`, on);
  emit({ click: { lng, lat } });
  if (l.type === "raster_series") await renderPanel(chartKey(S.layer), l);
}

async function pointSeries(l) {
  const { lng, lat } = S.click;
  const obs = [];
  for (const y of l.years) { const r = await Core.raster(l.path.replace("{year}", y)); obs.push({ x: y, y: Core.valueAt(r, lng, lat) }); }
  const proj = {};
  const p = l.projection && L[l.projection];
  if (p) for (const k of p.scenarios) {
    const pts = [{ x: obs[obs.length - 1].x, y: obs[obs.length - 1].y }];
    for (const y of p.years) { const r = await Core.raster(p.path.replace("{scenario}", k).replace("{year}", y)); pts.push({ x: y, y: Core.valueAt(r, lng, lat) }); }
    proj[k] = pts;
  }
  return { obs: obs.filter((o) => isFinite(o.y)), proj };
}

/* ---------------- right panel (rendered by the package's modules into the element OmPanel hands over) */
let panelRoot = null;
/** OmPanel's element, or null when it goes. Draws the open layer's panel into it. */
export function setPanelRoot(el) {
  panelRoot = el;
  if (!el) { Panel?.clear(); Panel?.closeStale(); return; }
  if (S.layer || S.tab) renderPanel(L[S.layer] ? chartKey(S.layer) : S.layer, L[S.layer] ?? null);
}
export function setRegion(rg) { emit({ region: rg }); if (S.layer) renderPanel(L[S.layer] ? chartKey(S.layer) : S.layer, L[S.layer] ?? null); }

const isTrendLayer = (id) => /_trend(_|$)/.test(id || "");
/* what a layer is, so that it shows only its own charts and numbers */
function layerKind(l) {
  const id = l.id;
  if (l.type === "raster_series") return "series";
  if (/_from_/.test(id)) return "driver";
  if (isTrendLayer(id)) return "trend";
  if (id === "omega_lowest_month_lsce") return "lowest";
  if (l.colormap === "categorical") return "class";
  if (/^z_o2_\d+_depth_(swm|nem)$/.test(id)) return "o2season";
  if (/^(z_o2_\d+_depth_mean|o2_(surface|50m|100m)_mean)$/.test(id)) return "o2mean";
  if (id === "bottom_o2_v23") return "seafloor";
  if (/^mhw_.*last5$/.test(id)) return "last5";
  if (/^(exposure_now|oa_pressure_now|heat_share_now)$/.test(id)) return "expo_now";
  return "static";
}

let renderToken = 0;
async function renderPanel(key, l) {
  const root = panelRoot;
  if (!root || !S.ready) return;
  const my = ++renderToken;
  Panel.clear();
  root.innerHTML = "";
  const t = TABS.find((x) => x.id === (l ? tabOf[l.id] : (tabOf[key] || S.tab))) || TABS[0], tc = tabColor(t);
  const C = CHARTS[key] || { findings: [] };
  root.insertAdjacentHTML("beforeend", `<div class="ph"><div class="k" style="color:${tc}">${t.title} · ${t.steps}</div>
    <h2>${l ? cleanTitle(l.title) : (t.chartOnly ? t.chartOnly.find((c) => c.id === key)?.title || t.title : t.title)}</h2>
    ${l ? `<p>${l.shows || ""}</p>` : ""}</div>`);
  const kind = l ? layerKind(l) : "chart";
  if (C.obs || l) {
    const regs = document.createElement("div"); regs.className = "regs";
    REGIONS.forEach((rg) => { const b = document.createElement("button"); b.className = `rg${rg === S.region ? " on" : ""}`; b.textContent = rg.replace(" EEZ", ""); b.onclick = () => setRegion(rg); regs.appendChild(b); });
    root.appendChild(regs);
  }
  try {
    const e = S.entries[S.idx] || {};
    if (l) await layerFacts(root, l, t);
    if (my !== renderToken) return;
    if (l) await KeyPoints.render(root, l, { region: S.region, Z: ZONAL, L }, tc); // the layer's message in plain words
    if (l && S.compare && COMPARE[l.id]) await Numbers.compare(root, l, key, e, S.path, ZONAL, L, S.region, scenario());
    if (S.click && l && l.type === "raster_series") {
      const ps = await pointSeries(l);
      const where = `${S.click.lat.toFixed(2)}° N, ${S.click.lng.toFixed(2)}° E`;
      Panel.card(root, "This place through the years", `${where} · ${l.units || ""}`, (host, h) => Panel.point(host, ps.obs, ps.proj, l.units, e.year, h === "fill" ? "fill" : 210), 210);
    }
    if (l) await Numbers.forLayer(root, l, key, kind, e, S.region, ZONAL); // this layer's numbers as tables
    if (kind === "trend" && C.trend) { // a trend layer: the trend line, decade by decade, then the trend by region
      await Panel.trendCards(root, key, S.region);
      if (key === "ph") await Panel.acidityDecades(root, S.region);
      Panel.card(root, "Trend by region", `${C.trend.unit} · bar = trend, whisker = 95 % interval`, (host, h) => Panel.trend(host, key, h));
      if (key === "ph") Panel.card(root, "Acidity rise by region", "hydrogen ions, nmol/kg per decade (about +4 % per decade)", (host, h) => Panel.trend(host, "h", h));
      if (C.note) root.insertAdjacentHTML("beforeend", `<div class="note-sm note-warn">${C.note}</div>`);
    } else if (C.obs && (kind === "series" || kind === "o2mean" || kind === "chart")) { // the layer's own series: observed and the outlook in one chart
      const hasProj = !!(C.proj || C.projFromPh);
      Panel.card(root, `${C.title}: ${hasProj ? "observed and outlook to 2050" : "observed"}`,
        `${S.region} · ${C.obs.monthly ? "monthly and annual mean" : "annual means"}${hasProj ? " · then decadal projections" : ""}`,
        (host, h) => Panel.annual(host, key, S.region, e.year || null, scenario(), h), 260);
      if (hasProj) root.insertAdjacentHTML("beforeend", '<div class="note-sm">After the observed years: decadal means of 11-14 CMIP6 climate models added to the observed level; band = spread between models.</div>');
      if (key === "ph") { // the same change as acidity: hydrogen ions (the quantity sea life feels)
        Panel.card(root, "Acidity (hydrogen ions): observed and outlook to 2050",
          `${S.region} · nmol/kg · the same data as pH, as the amount of acid`, (host, h) => Panel.annual(host, "h", S.region, e.year || null, scenario(), h), 240);
        root.insertAdjacentHTML("beforeend", '<div class="note-sm">pH is a log-10 scale: when pH falls, hydrogen ions rise by a percentage (0.1 pH = 26 %). Reported next to pH, as Fassbender et al. (2021) recommend.</div>');
      }
      if (C.note) root.insertAdjacentHTML("beforeend", `<div class="note-sm note-warn">${C.note}</div>`);
    }
    const checked = kind === "series" || kind === "o2mean" || kind === "chart"; // product checks: with the layer of the checked quantity
    if (checked) await Panel.checks(root, key);
    setMeasurements(checked ? key : null);
    const dy = S.card?.rows ? S.card.rows[S.idx]?.year : null;
    if (key === "catch") { // one view: the total catch and its shell-builders, then the stock status of the same catch
      await KeyPoints.renderKey(root, key, tc);
      Panel.section(root, "The catch and its shell-builders", "Step 10");
      await Numbers.forKey(root, "shells", dy); await Panel.catchTotal(root, dy); await Panel.shells(root, dy);
      Panel.section(root, "Stock status of the catch", "Step 9");
      await Numbers.forKey(root, "stocks", dy); await Panel.stocks(root, dy);
    } else if (!l) { await KeyPoints.renderKey(root, key, tc); await Numbers.forKey(root, key, dy); } // national views: plain words, then numbers
    if (key === "stocks") await Panel.stocks(root, dy);
    if (key === "shells") await Panel.shells(root, dy);
    if (key === "nindex") await Panel.nindex(root);
    if (key === "eez") await Panel.eezInfo(root);
    Panel.findingsBox(root, l ? (LAYER_FINDINGS.find(([re]) => re.test(l.id)) || [, C.findings || []])[1] : (C.findings || []), F);
  } catch (err) { console.error(err); root.insertAdjacentHTML("beforeend", `<p class="note-sm">Could not load a chart: ${err.message}</p>`); }
  if (my === renderToken) Panel.closeStale(); // only the latest render decides which windows stay open
  if (l && my === renderToken) root.insertAdjacentHTML("beforeend", `<div class="why"><b>How it was made.</b> ${l.justification || ""}<br><span class="muted">${l.product || ""}${l.status ? ` · ${l.status}` : ""}</span></div>`);
}

/* ---------------- measurement points (the checks' data) on request */
async function setMeasurements(key) {
  const K = CHECKS[key], M = K && K.points && MEAS[K.points];
  if (!M || !L[M.id]) { emit({ meas: null }); applyMeas(); return; }
  if (S.meas?.id !== M.id) {
    const g = await Core.json(L[M.id].path);
    g.features.forEach((f) => { f.properties._c = M.colors[f.properties.source] || "#e6eef0"; });
    const n = {}; g.features.forEach((f) => { n[f.properties.source] = (n[f.properties.source] || 0) + 1; });
    const yrs = L[M.id].years || [];
    emit({ meas: { id: M.id, geojson: g, label: `${M.label} (${g.features.length})`,
      legend: `<b>${M.label}</b>${Object.entries(n).map(([s, c]) => `<div><i style="background:${M.colors[s] || "#e6eef0"}"></i>${s}: ${c}</div>`).join("")}<p>Measured in ${yrs.length > 3 ? `${yrs[0]}-${yrs[yrs.length - 1]}` : yrs.join(", ")}. Click a point: measured value and the products at that place.</p>` } });
  }
  applyMeas();
}
export function toggleMeas() { emit({ measOn: !S.measOn }); applyMeas(); }
function applyMeas() {
  if (!map?.getLayer("om-meas")) return;
  const on = !!(S.measOn && S.meas);
  if (S.meas) map.getSource("om-meas").setData(S.meas.geojson);
  map.setLayoutProperty("om-meas", "visibility", on ? "visible" : "none");
}

/* ---------------- key findings of the active layer, from the raster on the map (portal/stats/zonal.json) */
async function layerFacts(root, l, t) {
  ZONAL = ZONAL || (await Core.json("stats/zonal.json")).rasters;
  const tc = tabColor(t);
  if (l.colormap === "categorical") { await classFacts(root, l, tc); return; }
  const z = ZONAL[S.path]; if (!z) return;
  const e = S.entries[S.idx] || {}, u = l.units || "";
  const fmt = (v) => (l.classes ? l.classes[String(Math.round(v))] || Core.fmt(v, 3) : Core.fmt(v, dig(l, Math.abs(v) < 0.1 ? 4 : 3)));
  const whole = z["Whole EEZ"];
  const when = e.kind === "proj" ? `${e.year} · ${SCEN[scenario()].label} emissions` : e.year || l.period || "";
  const items = [];
  const signed = (d) => `${d >= 0 ? "+" : ""}${Core.fmt(d, dig(l, 4))}`;
  if (l.type === "raster_series" && e.kind === "obs" && e.year !== l.years[0]) { // change since the first year
    const z0 = ZONAL[l.path.replace("{year}", l.years[0])];
    if (z0 && whole) items.push(`Since ${l.years[0]}: ${signed(whole.mean - z0["Whole EEZ"].mean)} ${u} (Whole EEZ)`);
  }
  if (e.kind === "proj") {
    const last = ZONAL[l.path.replace("{year}", l.years[l.years.length - 1])];
    if (last && whole) items.push(`Change from ${l.years[l.years.length - 1]}: ${signed(whole.mean - last["Whole EEZ"].mean)} ${u}`);
  }
  if (l.overlay) { // a share, not a count: the map cells (touching the EEZ) are not the report's cells (centre in the EEZ)
    const pc = (100 * l.overlay.cells_significant) / l.overlay.cells_with_data;
    items.push(pc === 100 ? "Significant at 95 % in every grid cell (the dots)" : `Significant at 95 % in ${Math.round(pc)} % of the grid cells (the dots)`);
  }
  const drv = DRIVER_OF.find(([re]) => re.test(l.id));
  if (drv && whole) {
    const tot = ZONAL[L[drv[1]].path] && ZONAL[L[drv[1]].path]["Whole EEZ"];
    if (tot && tot.mean) items.push(`About ${Math.round((100 * whole.mean) / tot.mean)} % of the whole ${drv[2]} (${Core.fmt(tot.mean, 4)} per decade) comes from this driver`);
  }
  if (whole) items.push(`Across the EEZ the map ranges from ${fmt(whole.min)} to ${fmt(whole.max)} ${l.classes ? "" : u}`);
  if (/^ph_(annual|trend)_lsce$/.test(l.id)) { // hydrogen ions: the same change as a percentage
    const a = (await Core.csv("step04/series/ph_regional_annual.csv")).filter((r) => r.product === "CMEMS-LSCE" && r.region === S.region).sort((x, y) => x.year - y.year);
    const y1 = e.kind === "obs" && e.year ? e.year : a[a.length - 1].year, r0 = a[0], r1 = a.find((r) => r.year === y1);
    if (r0 && r1) items.push(`Acidity (hydrogen ions, ${S.region}): ${Core.fmt(r0.h_mean, 3)} nmol/kg in ${r0.year} → ${Core.fmt(r1.h_mean, 3)} in ${r1.year}, ${r1.h_mean >= r0.h_mean ? "+" : ""}${(100 * (r1.h_mean / r0.h_mean - 1)).toFixed(1)} %`);
    const hm = ZONAL[L.h_mean_lsce.path] && ZONAL[L.h_mean_lsce.path]["Whole EEZ"];
    if (hm && l.id === "ph_annual_lsce") items.push(`Normal acidity (1991-2020): ${Core.fmt(hm.mean, 3)} nmol/kg hydrogen ions (Whole EEZ)`);
  }
  const C = COMPARE[l.id], Pl = C && L[C.with], zp = Pl && ZONAL[Pl.path] && ZONAL[Pl.path]["Whole EEZ"];
  if (whole && zp) {
    if (/^Normal/.test(C.label)) { // a baseline: how far this map is from the normal
      const d = whole.mean - zp.mean;
      items.push(`${C.label}: ${fmt(zp.mean)} ${u}; ${e.year || "this map"} is ${signed(d)} ${d >= 0 ? "above" : "below"} it`);
    } else {
      const k = Math.abs(whole.mean) / zp.mean;
      items.push(`${C.label}: ±${Core.fmt(zp.mean, 4)} ${Pl.units || ""}; the trend is about ${k.toFixed(0)} times larger than its uncertainty${k >= (/95/.test(C.label) ? 1 : 2) ? ", so it is clearly real" : ", so it is not clearly different from zero"}`);
    }
  }
  const regs = REGIONS.slice(1).filter((r) => z[r]);
  const missing = REGIONS.slice(1).filter((r) => !z[r]);
  if (missing.length) items.push(`${missing.join(" and ")}: not given, the layer covers less than half of ${missing.length > 1 ? "these regions" : "this region"}`);
  root.insertAdjacentHTML("beforeend", `<div class="facts" style="--tc:${tc}">
    <div class="ft">Key findings: this layer<span>${when}</span></div>
    ${whole ? `<div class="big" style="color:${tc}">${fmt(whole.mean)}<small>${l.classes ? "" : u} · Whole EEZ average</small></div>` : ""}
    ${regs.length ? `<div class="grid">${regs.map((r) => `<div class="cell"><div class="r">${r}</div><div class="v">${fmt(z[r].mean)}</div></div>`).join("")}</div>` : ""}
    <ul>${items.map((x) => `<li>${x}</li>`).join("")}</ul></div>`);
}

async function classFacts(root, l, tc) {
  const rows = (await Core.csv("step05/tables/omega_habitat_classes.csv")).filter((r) => r.product === "CMEMS-LSCE");
  const period = /last5/.test(l.id) ? "2020-2024" : "1991-2020";
  const C = COMPARE[l.id], other = C ? "1991-2020" : null;
  const cls = Object.values(l.classes);
  const share = (reg, per) => cls.map((c) => (rows.find((r) => r.region === reg && r.period === per && r.class === c) || {}).area_pct || 0);
  const bar = (vals) => `<div class="clsbar">${vals.map((v, i) => (v > 0 ? `<i title="${cls[i]}: ${v.toFixed(1)} %" style="width:${v}%;background:${CMAPS.categorical[String(i + 1)]}"></i>` : "")).join("")}</div>`;
  const line = (reg, per) => { const v = share(reg, per); return `<div class="cell" style="grid-column:1/-1"><div class="r">${reg} · ${per}</div>${bar(v)}
    <div class="r" style="margin-top:4px">${cls.map((c, i) => (v[i] > 0 ? `${c.split(" (")[0]} ${v[i].toFixed(1)} %` : "")).filter(Boolean).join(" · ")}</div></div>`; };
  root.insertAdjacentHTML("beforeend", `<div class="facts" style="--tc:${tc}">
    <div class="ft">Key findings: this layer<span>share of the area in each class</span></div>
    <div class="grid">${line(S.region, period)}${other ? line(S.region, other) : ""}</div>
    <ul><li>Classes for coral reefs by Ω aragonite (Guinotte et al. 2003): above 4 optimal, 3.5-4 adequate, 3-3.5 marginal, below 3 extremely marginal.</li>
    ${other ? `<li>Compare: in 1991-2020 the whole EEZ was ${share("Whole EEZ", other).map((v, i) => (v > 0 ? `${v.toFixed(0)} % ${cls[i].split(" (")[0].toLowerCase()}` : "")).filter(Boolean).join(", ")}.</li>` : ""}</ul></div>`);
}

/* ---------------- the national index card (Step 11) */
export async function indexCardHtml() {
  const T = await Core.csv("step11/tables/national_index.csv"), C = await Core.csv("step11/tables/sensitivity_countries.csv");
  const v = (re) => (T.find((r) => re.test(r.component)) || {}).value, pk = C.find((r) => String(r.country) === "Pakistan");
  const E = v(/^E /), Sv = v(/^S /), PI = v(/^PI/), n = C.length;
  const meter = (lab, val, col, note) => `<div class="ix-m"><span class="ix-l">${lab}</span><div class="ix-t"><i style="width:${100 * val}%;background:${col}"></i></div><b>${val.toFixed(2)}</b><em>${note}</em></div>`;
  const sub = (lab, val, raw, rank) => `<div class="ix-s"><span>${lab}</span><b>${val.toFixed(2)}</b><em>${raw} · rank ${rank} of ${n}</em></div>`;
  // 134 nations by sensitivity: dots stacked in bins of 0.025 along 0-1, Pakistan highlighted and labelled
  const W = 440, H = 124, pad = 12, bw = 0.025, R = 3.2, step = 7.2, cnt = {};
  const dots = [...C].sort((a, b) => a.S - b.S).map((r) => { const b = Math.floor(r.S / bw); cnt[b] = (cnt[b] || 0) + 1; return { r, x: pad + (b + 0.5) * bw * (W - 2 * pad), y: H - 18 - (cnt[b] - 0.5) * step }; });
  const me = dots.find((d) => d.r.country === "Pakistan");
  const svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Sensitivity of ${n} fishing nations; Pakistan ${pk.S.toFixed(2)}, rank ${pk.S_rank}">
    <line x1="${pad}" x2="${W - pad}" y1="${H - 14}" y2="${H - 14}" stroke="rgba(190,215,215,.35)"/>
    ${[0, 0.25, 0.5, 0.75, 1].map((x) => `<text x="${pad + x * (W - 2 * pad)}" y="${H - 2}" font-size="9.5" fill="#9db4b7" text-anchor="middle">${x}</text>`).join("")}
    ${dots.map((d) => (d === me ? "" : `<circle cx="${d.x}" cy="${d.y}" r="${R}" fill="#9db4b7" fill-opacity=".55"><title>${d.r.country}: ${d.r.S.toFixed(2)} (rank ${d.r.S_rank})</title></circle>`)).join("")}
    <circle cx="${me.x}" cy="${me.y}" r="${R + 3}" fill="#3fb37a" stroke="#202020" stroke-width="2"><title>Pakistan: ${pk.S.toFixed(2)} (rank ${pk.S_rank})</title></circle>
    <line x1="${me.x}" x2="${me.x}" y1="16" y2="${me.y - R - 4}" stroke="#e6eef0" stroke-width="1"/>
    <text x="${me.x - 4}" y="11" font-size="11" font-weight="700" fill="#f1f5f3" paint-order="stroke" stroke="#202020" stroke-width="3">Pakistan ${pk.S.toFixed(2)} · rank ${pk.S_rank} of ${n}</text></svg>`;
  return `<div class="cc-k" style="color:#c9d0dc">Pakistan's national index · Step 11</div>
    <div class="ix-hero"><div><b>${PI.toFixed(2)}</b><span>potential impact (0-1)</span></div>
      <div class="ix-eq">= ( exposure <b style="color:#f07a5c">${E.toFixed(2)}</b> + sensitivity <b style="color:#3fb37a">${Sv.toFixed(2)}</b> ) ÷ 2</div></div>
    ${meter("Potential impact", PI, "#2B80B4", "the national index")}
    ${meter("Climate exposure", E, "#D2502F", "acidification + heat (Step 8)")}
    ${meter("Sensitivity", Sv, "#2E8B57", `rank ${pk.S_rank} of ${n} (1 = most sensitive)`)}
    <div class="ix-subs"><div class="ix-st">Sensitivity is made of</div>
      ${sub("Catch from depleted stocks", pk.S1n, `${pk.S1_depleted_pct.toFixed(1)} % of the catch`, pk.S1_depleted_pct_rank)}
      ${sub("Molluscs in the catch", pk.S2n, `${pk.S2_mollusc_pct.toFixed(1)} % of the catch`, pk.S2_mollusc_pct_rank)}
      ${sub("Marine fish in the diet", pk.S3n, `${pk.S3_marine_protein_pct.toFixed(2)} % of protein`, pk.S3_marine_protein_pct_rank)}</div>
    <div class="ix-strip"><div class="ix-st">Sensitivity of ${n} fishing nations <span>each dot a country · right = more sensitive</span></div>${svg}</div>
    <div class="cc-tag">National numbers · not location-specific</div>`;
}
export { Core, DONUTS, P as pkg };
