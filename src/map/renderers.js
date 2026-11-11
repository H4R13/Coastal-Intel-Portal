/**
 * Map layer renderers — one per visualization type.
 * Each implements { add(map, layer), remove(map, layer) }, and optionally update (follow the timeline), describe (one
 * line saying what is drawn) and legend ({ classes: [{ color, label }] } or { ramp, min, max, unit }) for the map legend.
 * With no endpoint connected they add nothing, so the map stays honest.
 * These are plain map code, not React: src/components/MapView.jsx calls them as the state changes.
 * To plug in data, set layer.mapLayer.endpoint (GeoJSON URL, or tile URL template for rasters).
 */
import { loadManifest, pickTiles } from "./manifest.js";
import * as om from "../oceanMonitoring/om.js";
import * as np from "../nutrients/np.js";
import { loadPlastics, pointsGeojson, samplingPeriod, colorExpr, waterColorExpr, BIOTA_COLOR, SCALE_MAX, PLASTIC_RAMP, DENSITY_UNIT } from "../plastics/plastics.js";
import maplibregl from "maplibre-gl";
import { getState } from "../state.js";
import { TIME_RANGE } from "../config/layers.js";
import { loadAmibCatalog, currentMap, stepLabel, hiddenStops, clearsBackground, tintStops, shownColor, imageUrl, rampOf, legendOf, rampCss } from "../amib/amibData.js";

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
 * The ocean monitoring package (src/oceanMonitoring/om.js) for the Ocean and Fisheries layers: while one of them is on,
 * the package adds its raster, outlines, significance dots and measurement points to the map and draws what its own
 * layer list and year slider choose. Its legend sits in its own column (OmLeft); this one is only for the portal legend.
 */
const oceanMonitoring = {
  add(map, layer) { om.attach(map, layer.id); },
  remove(map, layer) { om.detach(map, layer.id); },
  describe() { const t = om.omState().title; return t ? `${t.v}${t.when ? ` · ${t.when}` : ""}` : null; },
};

/**
 * Nutrients & Plankton (src/nutrients/np.js), laid out like the ocean package: while it is on, the five monitoring
 * points (coloured by the month on its own slider), the April 2026 chlorophyll map or a nutrient average are drawn as
 * its layer list chooses. Its legend sits in its own column.
 */
const nutrients = {
  add(map, layer) { np.attach(map, layer.id); },
  remove(map, layer) { np.detach(map, layer.id); },
  describe() { const s = np.npState(); return s.layer ? np.LAYERS[s.layer].title : null; },
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
 * Plastic monitoring points (js/plastics), the same ones as on the team's own map: the sampling stations, coloured
 * and sized by plastic pieces per m², the published seawater and sediment sites, coloured by particles per litre,
 * and the places the published fish and crab records come from. None of them changes with the timeline year.
 * Clicking a dot opens a small balloon with its numbers.
 */
const pl = { on: false, key: null, d: null, site: null, popup: null, handlers: null };
const PL_DOTS = ["water", "biota", "pts"]; // the clickable layers, bottom to top
const plastics = {
  add(map, layer, s) { pl.on = true; pl.key = null; this.update(map, layer, s); },
  async update(map, layer) {
    const d = await loadPlastics();
    if (!d || !pl.on || pl.key) return;
    Object.assign(pl, { key: "stations", d });
    const data = pointsGeojson(d), src = srcId(layer), kind = (k) => ["==", ["get", "kind"], k];
    if (!map.getSource(src)) {
      const size = (add) => ["interpolate", ["linear"], ["get", "value"], 0, 6 + add, SCALE_MAX, 16 + add];
      map.addSource(src, { type: "geojson", data });
      map.addLayer({ id: lyrId(layer, "water"), type: "circle", source: src, filter: kind("water"), paint: { "circle-radius": 6, "circle-color": waterColorExpr(), "circle-stroke-color": "#f1f5f3", "circle-stroke-width": 1.2 } });
      map.addLayer({ id: lyrId(layer, "biota"), type: "circle", source: src, filter: kind("biota"), paint: { "circle-radius": 8, "circle-color": BIOTA_COLOR, "circle-stroke-color": "#f1f5f3", "circle-stroke-width": 2.5 } });
      map.addLayer({ id: lyrId(layer, "halo"), type: "circle", source: src, filter: kind("stations"), paint: { "circle-radius": size(8), "circle-color": colorExpr(), "circle-opacity": 0.28, "circle-blur": 0.7 } });
      map.addLayer({ id: lyrId(layer, "pts"), type: "circle", source: src, filter: kind("stations"), paint: { "circle-radius": size(0), "circle-color": colorExpr(), "circle-stroke-color": "#04121f", "circle-stroke-width": 1.5 } });
      pl.handlers = {
        click: (e) => {
          const f = e.features[0];
          pl.site = f.properties.name;
          pl.popup?.remove();
          pl.popup = new maplibregl.Popup({ closeButton: false, className: "site-pop", offset: 16 }).setLngLat(f.geometry.coordinates).setHTML(f.properties.pop).addTo(map);
          pl.popup.on("close", () => { pl.site = null; });
        },
        enter: () => { map.getCanvas().style.cursor = "pointer"; },
        leave: () => { map.getCanvas().style.cursor = ""; },
      };
      for (const id of PL_DOTS.map((x) => lyrId(layer, x))) { map.on("click", id, pl.handlers.click); map.on("mouseenter", id, pl.handlers.enter); map.on("mouseleave", id, pl.handlers.leave); }
    }
    window.dispatchEvent(new Event("layerdatachange"));
  },
  describe() { return pl.d ? `Stations sampled ${samplingPeriod(pl.d)} · published sites` : null; },
  legend() { return pl.d ? { ramp: PLASTIC_RAMP, min: 0, max: SCALE_MAX, unit: DENSITY_UNIT } : null; },
  remove(map, layer) {
    if (pl.handlers) for (const id of PL_DOTS.map((x) => lyrId(layer, x))) { map.off("click", id, pl.handlers.click); map.off("mouseenter", id, pl.handlers.enter); map.off("mouseleave", id, pl.handlers.leave); }
    pl.popup?.remove();
    Object.assign(pl, { on: false, key: null, d: null, site: null, popup: null, handlers: null });
    [...PL_DOTS, "halo"].forEach((x) => map.getLayer(lyrId(layer, x)) && map.removeLayer(lyrId(layer, x)));
    map.getSource(srcId(layer)) && map.removeSource(srcId(layer));
  },
};

/**
 * Saltwater intrusion / salinity package layers (js/amib): the pre-coloured image of the map chosen in the panel
 * (a hazard under the emissions scenario, or a raw package layer), stretched over its bounds. Year-by-year maps swap
 * the image as the timeline moves. Runs alongside a layer's own renderer for every portal layer that has layer.amib.
 *
 * The renderer downloads each image itself and hands the map a finished copy. Handing the map the server address
 * instead made it cancel a download whenever the year moved on before it ended, so a map still being drawn on the
 * server showed only a few of its years during playback, and every image was downloaded twice (once ahead, once to draw).
 * The rest of the timeline range is downloaded in the background, nearest years first, a few at a time; choosing
 * another map replaces that list, so the new map does not wait behind the old one.
 */
const amibShown = new Map(); // portal layer id → { key, layer, step, url, range, seq, drawn }
const frames = new Map(); // image address → Promise of a local copy (blob: address), most recently used last
const FRAME_LIMIT = 300; // copies kept (about 250 kB each at most); the least recently used are released
const wanted = new Map(); // portal layer id → image addresses still to download for its timeline range
const BUFFER = 3; // background downloads at once: one less than the server's drawing pool (server/amib.mjs), so the year on screen never waits
const buffering = new Map(); // image address → AbortController of a background download in progress
const arrived = new Set(); // image addresses whose local copy is ready

function frame(url, priority = "auto", signal) {
  let p = frames.get(url);
  if (p) { frames.delete(url); frames.set(url, p); return p; }
  p = fetch(url, { priority, signal }).then((r) => (r.ok ? r.blob() : null)).then((b) => b && URL.createObjectURL(b)).catch(() => null);
  p.then((local) => { if (local && frames.get(url) === p) arrived.add(url); else if (!local && frames.get(url) === p) frames.delete(url); }); // a failed download is tried again next time
  frames.set(url, p);
  for (const [old, q] of frames) {
    if (frames.size <= FRAME_LIMIT) break;
    frames.delete(old); arrived.delete(old);
    q.then((local) => local && URL.revokeObjectURL(local));
  }
  return p;
}

/**
 * Whether the package map a portal layer shows for `year` has arrived; if not, it is asked for at once. The showcase's
 * timeline waits on this (setPlayGate in src/components/Timeline.jsx), so no year goes by without its map.
 */
export function amibReady(catalog, layer, s, year) {
  const { L, step } = currentMap(catalog, layer, s, year);
  if (!L) return true;
  const url = imageUrl(L, step);
  if (arrived.has(url)) return true;
  frame(url, "high");
  return false;
}

function bufferNext() {
  while (buffering.size < BUFFER) {
    let url;
    for (const list of wanted.values()) { while (list.length && frames.has(list[0])) list.shift(); if (list.length) { url = list.shift(); break; } }
    if (!url) return;
    const stop = new AbortController();
    buffering.set(url, stop);
    frame(url, "low", stop.signal).finally(() => { buffering.delete(url); bufferNext(); });
  }
}

/** Stop background downloads no map wants any more (another map was chosen), which also frees the server's drawing threads. */
function dropUnwanted() {
  const keep = new Set([...wanted.values()].flat().concat([...amibShown.values()].map((st) => st.url))); // the year on screen may itself have started as a background download
  for (const [url, stop] of buffering) if (!keep.has(url)) stop.abort();
}

/** Queue the images of the timeline range: the years after this one first, then the earlier ones (for looping and scrubbing back). */
function bufferRange(catalog, layer, s, key) {
  const { from } = TIME_RANGE, to = s.yearTo, seen = new Set([key]), list = [];
  for (const y of [...Array(to - s.year).keys()].map((i) => s.year + 1 + i).concat([...Array(s.year - from).keys()].map((i) => from + i))) {
    const { L, step } = currentMap(catalog, layer, s, y), k = L && `${L.id}/${step}`;
    if (!k || seen.has(k)) continue;
    seen.add(k);
    list.push(imageUrl(L, step));
  }
  wanted.set(layer.id, list);
  dropUnwanted();
  bufferNext();
}

const amib = {
  add(map, layer, s) { amibShown.set(layer.id, { key: null, seq: 0, drawn: 0 }); this.update(map, layer, s); },
  async update(map, layer, s) {
    const catalog = await loadAmibCatalog(), st = amibShown.get(layer.id);
    if (!catalog || !st) return;
    const { L, step } = currentMap(catalog, layer, s);
    const key = L ? `${L.id}/${step}` : "";
    if (st.key === key) return;
    const moved = st.key !== key, other = st.layer !== L;
    Object.assign(st, { key, layer: L, step, url: L ? imageUrl(L, step) : null });
    const src = `amib-${layer.id}`;
    if (!L) { wanted.delete(layer.id); dropUnwanted(); st.drawn = ++st.seq; map.getLayer(src) && map.setLayoutProperty(src, "visibility", "none"); }
    else {
      if (other) { wanted.set(layer.id, []); dropUnwanted(); } // another map: its year on screen is fetched alone first, the rest after it
      if (moved) {
        const seq = ++st.seq, [w, sth, e, n] = L.bounds;
        frame(imageUrl(L, step), "high").then((local) => {
          if (amibShown.get(layer.id) === st && st.layer === L) bufferRange(catalog, layer, getState(), st.key);
          if (!local || amibShown.get(layer.id) !== st || seq < st.drawn || st.layer !== L) return; // gone, a later year is already on the map, or another map was chosen
          st.drawn = seq;
          const img = { url: local, coordinates: [[w, n], [e, n], [e, sth], [w, sth]] };
          if (map.getSource(src)) { map.getSource(src).updateImage(img); map.setLayoutProperty(src, "visibility", "visible"); }
          else {
            map.addSource(src, { type: "image", ...img });
            map.addLayer({ id: src, type: "raster", source: src, paint: { "raster-opacity": 0.85, "raster-fade-duration": 0 } });
          }
          const tinted = tintStops(L).length > 0 || !!rampOf(L); // a see-through tint (salt-affected soils) or a recoloured field: it carries its own opacity
          map.setPaintProperty(src, "raster-resampling", L.kind === "categorical" && !tinted ? "nearest" : "linear"); // class maps keep hard edges
          map.setPaintProperty(src, "raster-opacity", tinted ? 1 : L.kind === "categorical" || clearsBackground(L) ? 0.85 : 0.6); // smooth fields cover their whole box, land included: let the map show through
        });
      } else bufferRange(catalog, layer, s, key); // only the time range changed
    }
    if (moved) window.dispatchEvent(new Event("layerdatachange"));
  },
  describe(layer) {
    const st = amibShown.get(layer.id);
    if (!st?.layer) return null;
    return `${st.layer.name}${stepLabel(st.layer, st.step) ? ` · ${stepLabel(st.layer, st.step)}` : ""}${clearsBackground(st.layer) ? " · the most common value is left clear; colour marks where it differs" : ""}`;
  },
  legend(layer) {
    const L = amibShown.get(layer.id)?.layer, stops = legendOf(L);
    if (!stops.length) return null;
    return L.kind === "categorical"
      ? { classes: stops.filter((c) => !hiddenStops(L).includes(c)).map((c) => ({ color: shownColor(L, c), label: c.label ?? L.classes?.[c.value] ?? c.value })) }
      : { ramp: rampCss(stops), min: stops[0].value, max: stops.at(-1).value, unit: L.units };
  },
  remove(map, layer) {
    amibShown.delete(layer.id); wanted.delete(layer.id); dropUnwanted();
    map.getLayer(`amib-${layer.id}`) && map.removeLayer(`amib-${layer.id}`);
    map.getSource(`amib-${layer.id}`) && map.removeSource(`amib-${layer.id}`);
  },
};

/** The renderers that draw a portal layer: its own type, plus the package renderer when it has layer.amib. */
export const renderersOf = (layer) => [RENDERERS[layer.mapLayer.type], layer.amib && amib].filter(Boolean);

export const RENDERERS = {
  oceanMonitoring,
  nutrients,
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
