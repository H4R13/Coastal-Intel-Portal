/**
 * Map layer renderers — one per visualization type.
 * Each implements { add(map, layer), remove(map, layer) }, and optionally update (follow the timeline), describe (one
 * line saying what is drawn) and legend ({ classes: [{ color, label }] } or { ramp, min, max, unit }) for the map legend.
 * With no endpoint connected they add nothing, so the map stays honest.
 * To plug in data, set layer.mapLayer.endpoint (GeoJSON URL, or tile URL template for rasters).
 */
import { loadManifest, pickTiles } from "./manifest.js";
import { loadCatalog, loadDoc, resolveLayer, pickYear } from "../ocean/oceanData.js";
import { drawGrid, gradientCss, CLASS_COLORS } from "../ocean/colormaps.js";
import { nationalAt, NATIONAL_RAMP } from "../ocean/national.js";
import { loadPlastics, viewOf as plasticsView, sitesGeojson, scaleMax, colorExpr, PLASTIC_RAMP } from "../plastics/plastics.js";
import { loadAmibCatalog, resolveView, pickStep, stepLabel, hiddenStops } from "../amib/amibData.js";

const srcId = (l) => `env-${l.id}`;
const lyrId = (l, s) => `env-${l.id}-${s}`;

function geojson(kind) {
  return {
    add(map, layer) {
      const url = layer.mapLayer.endpoint;
      if (!url || map.getSource(srcId(layer))) return;
      map.addSource(srcId(layer), { type: "geojson", data: url });
      const c = layer.color;
      if (kind === "points") map.addLayer({ id: lyrId(layer, "pts"), type: "circle", source: srcId(layer), paint: { "circle-radius": 5, "circle-color": c, "circle-stroke-color": "#04121f", "circle-stroke-width": 1 } });
      if (kind === "polygons") map.addLayer({ id: lyrId(layer, "fill"), type: "fill", source: srcId(layer), paint: { "fill-color": c, "fill-opacity": 0.45, "fill-outline-color": c } });
      if (kind === "lines") map.addLayer({ id: lyrId(layer, "line"), type: "line", source: srcId(layer), paint: { "line-color": c, "line-width": 1.5 } });
      if (kind === "heatmap") map.addLayer({ id: lyrId(layer, "heat"), type: "heatmap", source: srcId(layer), paint: { "heatmap-opacity": 0.7 } });
    },
    remove(map, layer) {
      ["pts", "fill", "line", "heat"].forEach((s) => map.getLayer(lyrId(layer, s)) && map.removeLayer(lyrId(layer, s)));
      map.getSource(srcId(layer)) && map.removeSource(srcId(layer));
    },
  };
}

const raster = {
  add(map, layer) {
    const url = layer.mapLayer.endpoint;
    if (!url || map.getSource(srcId(layer))) return;
    map.addSource(srcId(layer), { type: "raster", tiles: [url], tileSize: 256 });
    map.addLayer({ id: lyrId(layer, "r"), type: "raster", source: srcId(layer), paint: { "raster-opacity": 0.75, "raster-fade-duration": 300 } });
  },
  remove(map, layer) {
    map.getLayer(lyrId(layer, "r")) && map.removeLayer(lyrId(layer, "r"));
    map.getSource(srcId(layer)) && map.removeSource(srcId(layer));
  },
};

/**
 * Vector tiles served per year from the database. The layer's manifest lists the years that exist; the map
 * follows the timeline year (and scenario) by swapping the tile URL on one source.
 */
const shown = new Map(); // layer id → what is on the map now: { key, pick } (null until the manifest arrives)
const yeartiles = {
  add(map, layer, s) { shown.set(layer.id, null); this.update(map, layer, s); },
  async update(map, layer, s) {
    const manifest = await loadManifest(layer);
    if (!manifest || !shown.has(layer.id)) return; // no data connected, or switched off while loading
    const pick = pickTiles(manifest, s.year, s.scenario);
    const key = pick ? `${pick.scenario}/${pick.year}` : "";
    if (shown.get(layer.id)?.key === key) return;
    shown.set(layer.id, { key, pick });
    const src = srcId(layer), fill = lyrId(layer, "fill");
    if (!pick) {
      map.getLayer(fill) && map.setLayoutProperty(fill, "visibility", "none");
    } else {
      const tiles = [`${new URL(layer.mapLayer.endpoint, location.href).href}${key}/{z}/{x}/{y}.mvt`]; // absolute, for MapLibre's workers
      if (map.getSource(src)) { map.getSource(src).setTiles(tiles); map.setLayoutProperty(fill, "visibility", "visible"); }
      else {
        map.addSource(src, { type: "vector", tiles, minzoom: 0, maxzoom: 12 });
        // no outline and no antialiasing: the shapes arrive cut into pieces, and their seams must not show
        map.addLayer({ id: fill, type: "fill", source: src, "source-layer": layer.id, paint: { "fill-color": layer.color, "fill-opacity": 0.7, "fill-antialias": false } });
      }
    }
    window.dispatchEvent(new Event("layerdatachange"));
  },
  /** One line for the legend saying which year is actually drawn. */
  describe(layer) {
    const pick = shown.get(layer.id)?.pick;
    if (!pick) return shown.get(layer.id) ? "No extent mapped for this year" : null;
    return pick.projected ? `Showing ${pick.year} · ${pick.scenario} scenario (projected)` : `Showing ${pick.year} · mapped`;
  },
  remove(map, layer) {
    shown.delete(layer.id);
    map.getLayer(lyrId(layer, "fill")) && map.removeLayer(lyrId(layer, "fill"));
    map.getSource(srcId(layer)) && map.removeSource(srcId(layer));
  },
};

/**
 * One vector tile set whose features each carry the period they belong to (start_yr, end_yr, kind).
 * The timeline year filters them on the client, so moving the slider needs no new tiles: a period is drawn
 * once it has begun. Projected periods are drawn fainter than mapped ones.
 */
const periodState = new Map(); // layer id → { manifest, year }
const periodtiles = {
  add(map, layer, s) { periodState.set(layer.id, { manifest: null, year: null }); this.update(map, layer, s); },
  async update(map, layer, s) {
    const manifest = await loadManifest(layer);
    const st = periodState.get(layer.id);
    if (!manifest || !st || st.year === s.year) return;
    Object.assign(st, { manifest, year: s.year });
    const src = srcId(layer), fill = lyrId(layer, "fill");
    if (!map.getSource(src)) {
      map.addSource(src, { type: "vector", tiles: [`${new URL(layer.mapLayer.endpoint, location.href).href}{z}/{x}/{y}.mvt`], minzoom: 0, maxzoom: 12 });
      map.addLayer({ id: fill, type: "fill", source: src, "source-layer": layer.id, paint: { "fill-color": layer.color, "fill-opacity": ["case", ["==", ["get", "kind"], "projected"], 0.45, 0.85], "fill-antialias": false } });
    }
    map.setFilter(fill, ["<", ["get", "start_yr"], s.year]);
    window.dispatchEvent(new Event("layerdatachange"));
  },
  describe(layer) {
    const st = periodState.get(layer.id);
    if (!st?.manifest) return null;
    const begun = st.manifest.periods.filter((p) => p.from < st.year);
    if (!begun.length) return "No period mapped before this year";
    const mapped = begun.filter((p) => p.kind === "observed"), last = begun.at(-1);
    return last.kind === "projected"
      ? `Mapped ${mapped[0].from}–${mapped.at(-1).to}, projected to ${last.to} (fainter)`
      : `Mapped ${mapped[0].from}–${last.to}`;
  },
  legend(layer) {
    return periodState.get(layer.id)?.manifest ? { classes: [{ color: layer.color, label: "Land lost, mapped" }, { color: layer.color, opacity: 0.5, label: "Land lost, projected" }] } : null;
  },
  remove(map, layer) {
    periodState.delete(layer.id);
    map.getLayer(lyrId(layer, "fill")) && map.removeLayer(lyrId(layer, "fill"));
    map.getSource(srcId(layer)) && map.removeSource(srcId(layer));
  },
};

/**
 * Ocean package layers (js/ocean): one data grid at a time, coloured in the browser and stretched over its bounds,
 * with the EEZ outline and, for trend layers, dots where the trend is statistically significant.
 * Which grid is drawn comes from the panel's choice (state.oceanView), the scenario and, for yearly layers, the timeline.
 */
const oceanMap = { on: false, key: null, layer: null, year: null };
const ocean = {
  add(map, layer, s) { oceanMap.on = true; oceanMap.key = null; this.update(map, layer, s); },
  async update(map, layer, s) {
    const catalog = await loadCatalog();
    if (!catalog || !oceanMap.on) return;
    const L = resolveLayer(catalog, s.oceanView[layer.id] ?? { step: layer.ocean.steps[0], variable: null }, s.oceanScenario);
    if (!L) return;
    const year = L.type === "raster_series" ? pickYear(L, s.year) : null;
    const key = `${L.id}/${year ?? ""}`;
    if (key === oceanMap.key) return;
    Object.assign(oceanMap, { key, layer: L, year });
    const [grid, dots, eez] = await Promise.all([loadDoc(`raster/${L.id}${year ? `/${year}` : ""}`), L.overlay ? loadDoc(`overlay/${L.id}`) : null, loadDoc("vector/eez")]);
    if (oceanMap.key !== key || !oceanMap.on || !grid) return; // superseded while loading
    // everything is limited to the open sea inside the EEZ: the grid, and the dots by the same test
    const { inside: seaward, ...img } = drawGrid(grid, L, eez), src = srcId(layer);
    const inside = dots ? { ...dots, features: dots.features.filter((f) => seaward(...f.geometry.coordinates)) } : dots;
    if (map.getSource(src)) map.getSource(src).updateImage(img);
    else {
      map.addSource(src, { type: "image", ...img });
      map.addLayer({ id: lyrId(layer, "grid"), type: "raster", source: src, paint: { "raster-opacity": 0.88, "raster-fade-duration": 0 } });
      map.addSource(`${src}-eez`, { type: "geojson", data: eez ?? { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: lyrId(layer, "eez"), type: "line", source: `${src}-eez`, paint: { "line-color": "#10232b", "line-width": 1, "line-opacity": 0.35 } }); // faint: the outline also traces every delta creek
      map.addSource(`${src}-dots`, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: lyrId(layer, "dots"), type: "circle", source: `${src}-dots`, paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 1, 8, 2.2], "circle-color": "#000", "circle-opacity": 0.75 } });
    }
    map.setPaintProperty(lyrId(layer, "grid"), "raster-resampling", L.classes ? "nearest" : "linear"); // class maps keep hard edges
    map.getSource(`${src}-dots`).setData(inside ?? { type: "FeatureCollection", features: [] });
    window.dispatchEvent(new Event("layerdatachange"));
  },
  describe() {
    const L = oceanMap.layer;
    return L ? `${L.title}${oceanMap.year ? ` · ${oceanMap.year}` : ""}${L.units ? ` · ${L.units}` : ""}` : null;
  },
  legend() {
    const L = oceanMap.layer;
    if (!L) return null;
    return L.classes ? { classes: Object.values(L.classes).map((label, i) => ({ color: CLASS_COLORS[i % CLASS_COLORS.length], label })) } : { ramp: gradientCss(L.colormap), min: L.vmin, max: L.vmax, unit: L.units };
  },
  remove(map, layer) {
    Object.assign(oceanMap, { on: false, key: null, layer: null, year: null });
    ["dots", "eez", "grid"].forEach((s) => map.getLayer(lyrId(layer, s)) && map.removeLayer(lyrId(layer, s)));
    [`${srcId(layer)}-dots`, `${srcId(layer)}-eez`, srcId(layer)].forEach((s) => map.getSource(s) && map.removeSource(s));
  },
};

/**
 * National numbers of the ocean package (js/ocean/national.js): a balloon over the sea that states the value of the
 * timeline year, coloured by it. Nothing is filled in on the map, so it never hides another layer. Used by Fisheries,
 * whose topics are one number for the whole country.
 */
const nat = { on: false, key: null, info: null, marker: null };
const BALLOON_AT = [65.9, 24.1]; // open sea south-west of Karachi, inside the EEZ
const national = {
  add(map, layer, s) { nat.on = true; nat.key = null; this.update(map, layer, s); },
  async update(map, layer, s) {
    const step = s.oceanView[layer.id]?.step ?? layer.ocean.steps[0];
    const info = await nationalAt(step, s.year);
    if (!nat.on || !info) return;
    const key = `${step}/${info.year ?? ""}`; // a year is either measured or forecast, never both
    if (key === nat.key) return;
    Object.assign(nat, { key, info });
    if (!nat.marker) {
      const el = Object.assign(document.createElement("div"), { className: "nat-balloon" });
      nat.marker = new maplibregl.Marker({ element: el, anchor: "bottom", offset: [0, -6] }).setLngLat(BALLOON_AT).addTo(map);
      if (!map.getBounds().contains(BALLOON_AT) && layer.focus) map.fitBounds(layer.focus, { padding: 90, pitch: 0, duration: 900 }); // out of view: go to it
    }
    const el = nat.marker.getElement(), v = +info.value.toPrecision(3);
    const range = info.forecast ? `likely ${+info.lo.toPrecision(3)}–${+info.hi.toPrecision(3)}${info.def.unit}` : "";
    el.style.setProperty("--c", info.color);
    el.classList.toggle("forecast", !!info.forecast);
    el.innerHTML = `<b>${info.forecast ? "≈ " : ""}${v}${info.def.unit}</b><span>${info.def.label}</span><small>${info.forecast ? `${info.year} · trend forecast, ${range}` : `${info.year ?? "one fixed value"} · whole country`}</small><i class="nat-pin"></i>`;
    window.dispatchEvent(new Event("layerdatachange"));
  },
  describe() {
    const i = nat.info;
    return i ? `${i.def.label}${i.year ? ` · ${i.year}` : ""}${i.forecast ? " (trend forecast, not measured)" : ""} · ${+i.value.toPrecision(3)}${i.def.unit}` : null;
  },
  legend() { return nat.info ? { ramp: NATIONAL_RAMP, min: 0, max: nat.info.def.max, unit: nat.info.def.unit || "index" } : null; },
  remove() {
    nat.marker?.remove();
    Object.assign(nat, { on: false, key: null, info: null, marker: null });
  },
};

/**
 * Mangrove change pictures (server/mangrove-change.mjs): the extent of the timeline year against the first mapped
 * year, drawn by the server as one picture per frame of coast. Yellow still standing, blue gained, red lost.
 */
const mg = { on: false, key: null, pick: null, manifest: null };
const MANGROVE_CLASSES = [{ color: "#ffd60a", label: "Still standing" }, { color: "#2484ff", label: "Gained" }, { color: "#ff3333", label: "Lost" }];
const mangrovechange = {
  add(map, layer, s) { mg.on = true; mg.key = null; this.update(map, layer, s); },
  async update(map, layer, s) {
    const manifest = await loadManifest(layer);
    if (!manifest?.change || !mg.on) return;
    const keyOf = (p) => (p ? `${p.scenario}/${p.year}` : ""), pick = pickTiles(manifest, s.year, s.scenario), key = keyOf(pick);
    if (key === mg.key) return;
    Object.assign(mg, { key, pick, manifest });
    const url = (f, p) => `${new URL(layer.mapLayer.endpoint, location.href).href}${f.id}/${keyOf(p)}.png`;
    for (const f of manifest.change.frames) {
      const id = `${srcId(layer)}-${f.id}`, [w, sth, e, n] = f.bounds;
      if (!pick) { map.getLayer(id) && map.setLayoutProperty(id, "visibility", "none"); continue; }
      const img = { url: url(f, pick), coordinates: [[w, n], [e, n], [e, sth], [w, sth]] };
      if (map.getSource(id)) { map.getSource(id).updateImage(img); map.setLayoutProperty(id, "visibility", "visible"); }
      else {
        map.addSource(id, { type: "image", ...img });
        map.addLayer({ id, type: "raster", source: id, paint: { "raster-opacity": 0.95, "raster-fade-duration": 0 } });
      }
    }
    // fetch the next step's pictures ahead, so playing the timeline does not wait for them
    let next = null;
    for (let y = s.year + 1; y <= s.year + 12 && !next; y++) { const p = pickTiles(manifest, y, s.scenario); if (keyOf(p) !== key) next = p; }
    if (next) manifest.change.frames.forEach((f) => { new Image().src = url(f, next); });
    window.dispatchEvent(new Event("layerdatachange"));
  },
  describe() {
    if (!mg.manifest) return null;
    const p = mg.pick, base = mg.manifest.change.baseline;
    if (!p) return "No extent mapped for this year";
    return `${p.year}${p.projected ? ` · ${p.scenario} scenario (projected)` : " · mapped"} · compared with ${base}`;
  },
  legend() { return mg.pick ? { classes: MANGROVE_CLASSES } : null; },
  remove(map, layer) {
    for (const f of mg.manifest?.change.frames ?? []) { const id = `${srcId(layer)}-${f.id}`; map.getLayer(id) && map.removeLayer(id); map.getSource(id) && map.removeSource(id); }
    Object.assign(mg, { on: false, key: null, pick: null });
  },
};

/**
 * Beach debris survey sites (js/plastics): one dot per site, coloured and sized by plastic items per 100 m for the
 * timeline year (surveys, then the chosen scenario). Clicking a dot opens a small balloon with its numbers.
 */
const pl = { on: false, key: null, d: null, site: null, popup: null, handlers: null };
const sitePopHtml = (p) => `<b>${p.name}</b><span>${p.area}</span>${p.value < 0 ? `<em>No survey in ${p.year}</em>` : `<strong>${p.value} <small>items per 100 m</small></strong><span>${p.year} · ${p.kind}${p.lo >= 0 ? ` · range ${p.lo}–${p.hi}` : ""}</span>`}`;
const plastics = {
  add(map, layer, s) { pl.on = true; pl.key = null; this.update(map, layer, s); },
  async update(map, layer, s) {
    const d = await loadPlastics();
    if (!d || !pl.on) return;
    const scenario = plasticsView(s).scenario, key = `${s.year}/${scenario}`;
    if (key === pl.key) return;
    Object.assign(pl, { key, d, year: s.year });
    const data = sitesGeojson(d, s.year, scenario), src = srcId(layer), pts = lyrId(layer, "pts"), max = scaleMax(d);
    if (map.getSource(src)) map.getSource(src).setData(data);
    else {
      const size = (add) => ["case", ["<", ["get", "value"], 0], 5 + add, ["interpolate", ["linear"], ["get", "value"], 0, 6 + add, max, 16 + add]];
      map.addSource(src, { type: "geojson", data });
      map.addLayer({ id: lyrId(layer, "halo"), type: "circle", source: src, paint: { "circle-radius": size(8), "circle-color": colorExpr(max), "circle-opacity": 0.28, "circle-blur": 0.7 } });
      map.addLayer({ id: pts, type: "circle", source: src, paint: { "circle-radius": size(0), "circle-color": colorExpr(max), "circle-stroke-color": "#04121f", "circle-stroke-width": 1.5 } });
      pl.handlers = {
        click: (e) => {
          const f = e.features[0];
          pl.site = f.properties.name;
          pl.popup?.remove();
          pl.popup = new maplibregl.Popup({ closeButton: false, className: "site-pop", offset: 16 }).setLngLat(f.geometry.coordinates).setHTML(sitePopHtml(f.properties)).addTo(map);
          pl.popup.on("close", () => { pl.site = null; });
        },
        enter: () => { map.getCanvas().style.cursor = "pointer"; },
        leave: () => { map.getCanvas().style.cursor = ""; },
      };
      map.on("click", pts, pl.handlers.click); map.on("mouseenter", pts, pl.handlers.enter); map.on("mouseleave", pts, pl.handlers.leave);
    }
    const open = pl.site && data.features.find((f) => f.properties.name === pl.site); // an open balloon follows the year too
    if (open && pl.popup) pl.popup.setHTML(sitePopHtml(open.properties));
    window.dispatchEvent(new Event("layerdatachange"));
  },
  describe() {
    if (!pl.d) return null;
    const p = pl.d.projection, first = +pl.d.surveys[0].survey_date.slice(0, 4);
    return pl.year < first ? `No surveys before ${first}` : pl.year < p.years[0] ? `${pl.year} · survey mean` : `${Math.min(pl.year, p.years.at(-1))} · ${pl.year === p.years[0] ? "survey baseline" : `${p.scenarios.find((x) => `${pl.year}/${x.id}` === pl.key)?.label ?? "scenario"} (simulation)`}`;
  },
  legend() { return pl.d ? { ramp: PLASTIC_RAMP, min: 0, max: scaleMax(pl.d), unit: "items per 100 m" } : null; },
  remove(map, layer) {
    const pts = lyrId(layer, "pts");
    if (pl.handlers) { map.off("click", pts, pl.handlers.click); map.off("mouseenter", pts, pl.handlers.enter); map.off("mouseleave", pts, pl.handlers.leave); }
    pl.popup?.remove();
    Object.assign(pl, { on: false, key: null, d: null, site: null, popup: null, handlers: null });
    ["pts", "halo"].forEach((x) => map.getLayer(lyrId(layer, x)) && map.removeLayer(lyrId(layer, x)));
    map.getSource(srcId(layer)) && map.removeSource(srcId(layer));
  },
};

/**
 * Saltwater intrusion / salinity package layers (js/amib): the pre-coloured image of the chosen layer, stretched over
 * its bounds. Year-by-year layers swap the image as the timeline moves. Runs alongside a layer's own renderer for
 * every portal layer that has layer.amib.
 */
const amibShown = new Map(); // portal layer id → { key, layer, step }
const amib = {
  add(map, layer, s) { amibShown.set(layer.id, { key: null }); this.update(map, layer, s); },
  async update(map, layer, s) {
    const catalog = await loadAmibCatalog(), st = amibShown.get(layer.id);
    if (!catalog || !st) return;
    const L = resolveView(catalog, layer, s.amibView[layer.id]).current, step = L ? pickStep(L, s.year) : 0;
    const key = L ? `${L.id}/${step}` : "";
    if (st.key === key) return;
    Object.assign(st, { key, layer: L, step });
    const src = `amib-${layer.id}`;
    if (!L) { map.getLayer(src) && map.setLayoutProperty(src, "visibility", "none"); }
    else {
      const [w, sth, e, n] = L.bounds;
      const clear = layer.amib.clearBackground && L.kind !== "categorical";
      const hide = hiddenStops(layer, L).map((c) => c.color.replace("#", "")).join(",");
      const query = [clear && "bg=clear", hide && `hide=${hide}`].filter(Boolean).join("&");
      const img = { url: `${new URL("api/amib/image/", location.href).href}${encodeURIComponent(L.id)}/${step}${query ? `?${query}` : ""}`, coordinates: [[w, n], [e, n], [e, sth], [w, sth]] };
      if (map.getSource(src)) { map.getSource(src).updateImage(img); map.setLayoutProperty(src, "visibility", "visible"); }
      else {
        map.addSource(src, { type: "image", ...img });
        map.addLayer({ id: src, type: "raster", source: src, paint: { "raster-opacity": 0.85, "raster-fade-duration": 0 } });
      }
      map.setPaintProperty(src, "raster-resampling", L.kind === "categorical" ? "nearest" : "linear"); // class maps keep hard edges
      map.setPaintProperty(src, "raster-opacity", L.kind === "categorical" || clear ? 0.85 : 0.6); // smooth fields cover their whole box, land included: let the map show through
    }
    window.dispatchEvent(new Event("layerdatachange"));
  },
  describe(layer) {
    const st = amibShown.get(layer.id);
    if (!st?.layer) return null;
    const clear = layer.amib.clearBackground && st.layer.kind !== "categorical";
    return `${st.layer.name}${stepLabel(st.layer, st.step) ? ` · ${stepLabel(st.layer, st.step)}` : ""}${clear ? " · the most common value is left clear; colour marks where it differs" : ""}`;
  },
  legend(layer) {
    const L = amibShown.get(layer.id)?.layer, stops = L?.legend ?? [];
    if (!stops.length) return null;
    return L.kind === "categorical"
      ? { classes: stops.filter((c) => !hiddenStops(layer, L).includes(c)).map((c) => ({ color: c.color, label: c.label ?? L.classes?.[c.value] ?? c.value })) }
      : { ramp: `linear-gradient(to right, ${stops.map((c) => c.color).join(", ")})`, min: stops[0].value, max: stops.at(-1).value, unit: L.units };
  },
  remove(map, layer) {
    amibShown.delete(layer.id);
    map.getLayer(`amib-${layer.id}`) && map.removeLayer(`amib-${layer.id}`);
    map.getSource(`amib-${layer.id}`) && map.removeSource(`amib-${layer.id}`);
  },
};

/** The renderers that draw a portal layer: its own type, plus the package renderer when it has layer.amib. */
export const renderersOf = (layer) => [RENDERERS[layer.mapLayer.type], layer.amib && amib].filter(Boolean);

export const RENDERERS = {
  ocean,
  national,
  mangrovechange,
  plastics,
  yeartiles,
  periodtiles,
  raster,
  points: geojson("points"),
  polygons: geojson("polygons"),
  lines: geojson("lines"),
  heatmap: geojson("heatmap"),
};
