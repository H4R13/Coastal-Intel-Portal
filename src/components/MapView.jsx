/**
 * The map area: the MapLibre map, the title plate, the tool buttons with their two pop-overs (map layers, settings),
 * the legend with Hela's button beside it, the timeline and the cursor coordinates.
 * While the Ocean or Fisheries layer is open (OM mode) the ocean monitoring package takes the legend's and the
 * timeline's places: its layer list and legend on the left, its year slider at the bottom, its title card and tools at
 * the top (src/oceanMonitoring/OceanMonitoring.jsx). Nutrients & Plankton does the same with its own parts and a month
 * slider (src/nutrients/Nutrients.jsx).
 * The map itself is not drawn by React. It is created once (useEffect below) and then driven from the store: every
 * state change calls sync(), which applies the basemap, the overlays and the layer renderers (src/map/renderers.js).
 */
import { Fragment, useEffect, useReducer, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { LAYERS, PLACES, REGION_LABELS, MAP_VIEW } from "../config/layers.js";
import { BASEMAPS, OVERLAYS } from "../config/basemaps.js";
import { renderersOf } from "../map/renderers.js";
import { prefetch, setBusyCheck } from "../map/prefetch.js";
import { registerDemProtocol } from "../map/demProtocol.js";
import { getState, setState, subscribe, useStore, clearLayers } from "../state.js";
import { loadAmibCatalog, currentMap } from "../amib/amibData.js";
import { Icon } from "../lib.jsx";
import { Timeline } from "./Timeline.jsx";
import { TerminalButton } from "./Terminal.jsx";
import { TourButton } from "./Tour.jsx";
import { ShowcaseButton } from "./Showcase.jsx";
import { AssistantButton } from "./Assistant.jsx";
import { OmLeft, OmTop, OmDock, OmFree, OmFloats, isOmLayer, useOmTab } from "../oceanMonitoring/OceanMonitoring.jsx";
import { NpLeft, NpTop, NpDock, isNpLayer, useNpStart } from "../nutrients/Nutrients.jsx";

const DEM_TILES = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const GLOBE_VIEW = { center: [66, 20], zoom: 1.75 };
const STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json";
const TILT = 45;
const WIDE = "(min-width: 1101px)";

const TOOLS = [
  { act: "in", tip: "Zoom in", label: "Zoom in", paths: '<path d="M12 5v14M5 12h14"/>' },
  { act: "out", tip: "Zoom out", label: "Zoom out", paths: '<path d="M5 12h14"/>' },
  null,
  { act: "tilt", tip: "Toggle 3D tilt", label: "Toggle 3D tilt", paths: '<path d="M12 3 4 7v10l8 4 8-4V7Z"/><path d="m4 7 8 4 8-4M12 11v10"/>' },
  { act: "globe", tip: "Earth view", label: "Earth view", paths: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>' },
  { act: "reset", tip: "Reset to Pakistan coast", label: "Reset view", paths: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>' },
  { act: "full", tip: "Fullscreen", label: "Fullscreen map", paths: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>' },
];
const LAYERS_ICON = '<path d="m12 3 9 5-9 5-9-5Z"/><path d="m3 13 9 5 9-5"/><path d="m3 17.500 9 5 9-5" opacity=".55"/>';
const SETTINGS_ICON = '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>';
const INFO_ICON = '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>';

/* ---------- the map, outside React ---------- */
/** Creates the map in `host` (the #map element) and keeps it in step with the store. Returns { act, destroy }. */
function createMap(host, root, onStatus, onCoords) {
  if (maplibregl.config) maplibregl.config.MAX_PARALLEL_IMAGE_REQUESTS = 32; // default 16 throttles tile-heavy views
  if (!maplibregl.__demRegistered) { registerDemProtocol(maplibregl); maplibregl.__demRegistered = true; }
  const shell = root.closest(".shell");

  const map = new maplibregl.Map({
    container: host,
    style: STYLE,
    center: GLOBE_VIEW.center,
    zoom: GLOBE_VIEW.zoom,
    minZoom: 1.2,
    maxZoom: 14,
    maxPitch: 75,
    attributionControl: { compact: true },
    pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5), // retina canvases cost 4x the pixels for little visible gain
    maxTileCacheSize: 400, // keep more decoded tiles in memory so zooming back is instant
    fadeDuration: 120,
  });
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 110, unit: "metric" }), "bottom-right");
  window.__map = map; // debugging handle; the tour and the system check also read it

  /* Fly from the Earth view down to the study area (and back). Camera padding lifts the globe clear of the timeline. */
  /* The panels are glass overlays above the map, so account for whichever ones are open. */
  const insets = () => {
    if (!window.matchMedia(WIDE).matches) return { l: 0, r: 0 };
    const omLeft = shell.classList.contains("om-mode") && shell.querySelector(".om-left"); // OM mode: the package's layer list is on the left
    return {
      l: shell.classList.contains("left-closed") ? 0 : omLeft ? omLeft.offsetWidth + 16 : shell.querySelector(".sidebar").offsetWidth,
      r: shell.classList.contains("right-closed") ? 0 : shell.querySelector(".analysis").offsetWidth,
    };
  };
  const globePad = () => { const { l, r } = insets(); return { top: 20, bottom: 150, left: l, right: r }; };
  const fit = () => {
    const { l, r } = insets();
    const cam = map.cameraForBounds(MAP_VIEW.bounds, { padding: { top: 60, bottom: 90, left: 40 + l, right: 60 + r }, maxZoom: 7.2 });
    map.flyTo({ ...cam, pitch: TILT, bearing: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 2600, essential: true });
  };
  const showGlobe = () => map.flyTo({ center: GLOBE_VIEW.center, zoom: GLOBE_VIEW.zoom, pitch: 0, bearing: 0, padding: globePad(), duration: 2000, essential: true });

  let vectorLayers = []; // the dark vector map's layers and their default visibility
  /* The dark style's vector source, read from its water layer: CARTO renamed it ("carto" → "protomaps", seen 2026-10-22),
     and a hard-coded name left the navy water fill over the satellite pictures, where it covered the Indus Delta. */
  const vectorSource = () => map.getStyle().layers.find((l) => l.id === "water")?.source ?? "carto";
  /* Pakistan's border as officially drawn (Jammu and Kashmir inside Pakistan; public/boundaries/pakistan.geojson from
     server/build-boundaries.mjs, split into land and coast). The basemap's own borders (OpenStreetMap: the Line of
     Control and India's claim) are switched off, state and district lines with them, since India's draw through Kashmir.
     Bold black on land. The coastal stretch steps back so it does not sit on the coastal data being watched: bold with
     no layer on the map, a faint hairline once a layer is on (the map has flown to it), and gone once the scale bar
     reads less than 100 km (50 km and closer). The land border always stays. Not basemap layers, so they stay over imagery too. */
  const COAST_GONE_KM = 100;
  const SCALE_PX = 110; // the scale bar's width (ScaleControl maxWidth below): it shows the largest round distance that fits
  const BORDER_W = ["interpolate", ["linear"], ["zoom"], 3, 2.2, 8, 3.5, 12, 4.5];
  let coastLook = null;
  function addBorders() {
    ["boundary_country_outline", "boundary_country_inner", "boundary_state", "boundary_county"].forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, "visibility", "none"));
    map.addSource("pakistan-border", { type: "geojson", data: "boundaries/pakistan.geojson" });
    // a faint light edge under the black line, so it still reads on the dark map
    map.addLayer({ id: "pakistan-border-edge", type: "line", source: "pakistan-border", filter: ["==", ["get", "kind"], "land"], layout: { "line-join": "round" }, paint: { "line-color": "#c9d6d6", "line-opacity": 0.35, "line-width": ["interpolate", ["linear"], ["zoom"], 3, 4.2, 8, 5.5, 12, 6.5] } });
    map.addLayer({ id: "pakistan-border", type: "line", source: "pakistan-border", filter: ["==", ["get", "kind"], "land"], layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#000000", "line-width": BORDER_W } });
    map.addLayer({ id: "pakistan-coast", type: "line", source: "pakistan-border", filter: ["==", ["get", "kind"], "coast"], layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#000000", "line-width": BORDER_W, "line-width-transition": { duration: 300, delay: 0 }, "line-opacity-transition": { duration: 300, delay: 0 } } });
    map.on("move", styleCoast);
    styleCoast();
  }
  /** The distance the scale bar can span, in km, measured the way MapLibre's scale control does (across the middle). */
  function scaleKm() {
    const y = map.getContainer().clientHeight / 2;
    return map.unproject([0, y]).distanceTo(map.unproject([SCALE_PX, y])) / 1000;
  }
  function styleCoast() {
    if (!map.getLayer("pakistan-coast")) return;
    const look = scaleKm() < COAST_GONE_KM ? "gone" : getState().activeLayers.length ? "faint" : "bold";
    if (look === coastLook) return;
    coastLook = look;
    map.setPaintProperty("pakistan-coast", "line-width", look === "bold" ? BORDER_W : 0.6);
    map.setPaintProperty("pakistan-coast", "line-opacity", look === "bold" ? 1 : look === "faint" ? 0.18 : 0);
  }

  /* Re-tint the stock dark style: navy sea, slate land, luminous coastline; drop road/building clutter. */
  function tintBasemap() {
    const set = (id, prop, v) => map.getLayer(id) && map.setPaintProperty(id, prop, v);
    set("background", "background-color", "#2c2c2c");
    ["landcover", "landuse", "park_national_park", "park_nature_reserve"].forEach((id) => set(id, "fill-color", "#303030"));
    set("landuse_residential", "fill-color", "#2c2c2c");
    set("water", "fill-color", "#1a1a1a");
    set("waterway", "line-color", "#4d4d4d");
    set("boundary_country_outline", "line-color", "#3a3a3a");
    set("boundary_country_inner", "line-color", "#3a3a3a");
    map.getStyle().layers.forEach((l) => {
      if (["transportation", "building", "aeroway"].includes(l["source-layer"]) && !/^road_(pri|trunk|mot)_fill/.test(l.id)) map.setLayoutProperty(l.id, "visibility", "none");
    });
    /* 3D: globe projection, free terrain-RGB DEM, hillshade, optional satellite imagery, atmosphere */
    map.setProjection({ type: "globe" });
    // separate sources: terrain needs fine detail only when tilted, hillshade is fine at lower resolution
    // "dem://" serves the project's 12.5 m DEM (MSL-corrected) where it exists, else global terrain with a flat sea
    map.addSource("dem", { type: "raster-dem", encoding: "terrarium", tileSize: 256, maxzoom: 13, tiles: ["dem://{z}/{x}/{y}"], attribution: "Terrain: project DEM (12.5 m) · global terrain: Mapzen / AWS Open Data" });
    map.addSource("dem-hs", { type: "raster-dem", encoding: "terrarium", tileSize: 256, maxzoom: 11, tiles: ["demhs://{z}/{x}/{y}"] });
    map.addLayer({ id: "hillshade", type: "hillshade", source: "dem-hs", paint: { "hillshade-shadow-color": "#0d0d0d", "hillshade-highlight-color": "#676767", "hillshade-accent-color": "#1a1a1a", "hillshade-exaggeration": 0.45 } }, "waterway");
    try { map.setSky({ "sky-color": "#161616", "horizon-color": "#4d4d4d", "fog-color": "#161616", "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.6, "fog-ground-blend": 0.9, "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 1, 8, 0] }); } catch {}
    map.addLayer({ id: "coast-line", type: "line", source: vectorSource(), "source-layer": "water", paint: { "line-color": "#5a9e9c", "line-opacity": 0.7, "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.7, 10, 1.3] } }, "water_shadow");
    addBorders();
    vectorLayers = map.getStyle().layers.filter((l) => l.source === vectorSource()).map((l) => ({ id: l.id, vis: l.layout?.visibility ?? "visible" }));
  }

  map.on("load", () => {
    try { tintBasemap(); } catch (e) { console.warn("Basemap tint skipped", e); }
    root.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
    root.querySelector(".maplibregl-ctrl-attrib")?.removeAttribute("open");
    addReference(); sync(getState());
    map.jumpTo({ ...GLOBE_VIEW, pitch: 0, padding: globePad() });
    updateGlobeState();
    // the service worker may only take control after first load, so try the cache warm-up again once idle
    map.once("idle", () => setTimeout(() => warmCache(BASEMAPS.find((b) => b.id === getState().basemap)), 3000));
  });

  /* Earth view: clicking the globe flies to the study area */
  const updateGlobeState = () => root.classList.toggle("is-globe", map.getZoom() < 4.2);
  map.on("zoom", updateGlobeState);
  const onPanels = () => { if (map.getZoom() < 3.2 && !map.isMoving()) map.easeTo({ padding: globePad(), duration: 320 }); };
  window.addEventListener("panelschange", onPanels);
  map.on("click", () => { if (map.getZoom() < 3.2) fit(); });
  map.on("error", (e) => { if (e?.error?.status || /Failed to fetch/.test(e?.error?.message ?? "")) onStatus("Basemap tiles unavailable — check your connection"); });

  /* --- reference labels (places only, no environmental values) --- */
  const markers = [];
  function addReference() {
    PLACES.forEach((p) => {
      const el = document.createElement("div");
      el.className = `place r${p.rank}`;
      el.append(document.createElement("i"), Object.assign(document.createElement("span"), { textContent: p.name }));
      markers.push(new maplibregl.Marker({ element: el, anchor: "left", offset: [-4, 0] }).setLngLat(p.lngLat).addTo(map));
    });
    REGION_LABELS.forEach((r) => {
      const el = Object.assign(document.createElement("div"), { className: "region", textContent: r.name });
      markers.push(new maplibregl.Marker({ element: el }).setLngLat(r.lngLat).addTo(map));
    });
  }

  /* --- layers switched on with the toggles --- */
  const mounted = new Map();
  function syncLayers(s) {
    mounted.forEach((layer, id) => {
      if (!s.activeLayers.includes(id)) { renderersOf(layer).forEach((r) => r.remove(map, layer)); mounted.delete(id); }
    });
    s.activeLayers.forEach((id) => {
      const layer = LAYERS.find((l) => l.id === id);
      if (mounted.has(id)) return renderersOf(layer).forEach((r) => r.update?.(map, layer, s)); // follow the timeline year
      renderersOf(layer).forEach((r) => r.add(map, layer, s));
      mounted.set(id, layer);
    });
  }

  /* Clicking a layer's dock icon brings the map to where that layer is: the area in layers.js, or for the
     intrusion/salinity package the extent of the map layer chosen in its panel. */
  async function focusLayer(id) {
    const layer = LAYERS.find((l) => l.id === id);
    let bounds = layer?.focus;
    if (layer?.amib) {
      const catalog = await loadAmibCatalog(), b = catalog && currentMap(catalog, layer, getState()).L?.bounds;
      if (b) bounds = [[b[0], b[1]], [b[2], b[3]]];
    }
    if (!bounds) return;
    const { l, r } = insets();
    const cam = map.cameraForBounds(bounds, { padding: { top: 70, bottom: 170, left: 50 + l, right: 60 + r }, maxZoom: 11.5 });
    map.flyTo({ ...cam, pitch: 0, bearing: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 1800, essential: true });
  }
  const onFocus = (e) => focusLayer(e.detail);
  window.addEventListener("layerfocus", onFocus);

  /* Raster basemaps are added lazily on first use and cross-faded; the dark vector map is the fallback. */
  const RASTERS = BASEMAPS.filter((b) => b.type === "raster");
  const baseAdded = new Set();
  function ensureBasemap(bm) {
    if (baseAdded.has(bm.id)) return;
    baseAdded.add(bm.id);
    const id = `bm-${bm.id}`;
    map.addSource(id, { type: "raster", tiles: bm.tiles, tileSize: bm.tileSize, maxzoom: bm.maxzoom, attribution: bm.credit });
    map.addLayer({ id, type: "raster", source: id, layout: { visibility: "none" }, paint: { ...bm.paint, "raster-fade-duration": 120, "raster-opacity": 0, "raster-opacity-transition": { duration: 500, delay: 0 } } }, "waterway");
  }

  let lastBase = "";
  function applyBasemap(s) {
    if (!map.getSource("dem")) return;
    const key = `${s.basemap}|${s.terrain}`;
    if (key !== lastBase) {
      lastBase = key;
      const bm = BASEMAPS.find((b) => b.id === s.basemap) ?? BASEMAPS[BASEMAPS.length - 1];
      const raster = bm.type === "raster";
      if (raster) ensureBasemap(bm);
      RASTERS.forEach((b) => {
        if (!baseAdded.has(b.id)) return;
        const id = `bm-${b.id}`;
        if (b.id === bm.id) {
          map.setLayoutProperty(id, "visibility", "visible");
          requestAnimationFrame(() => map.setPaintProperty(id, "raster-opacity", 1));
        } else {
          map.setPaintProperty(id, "raster-opacity", 0);
          setTimeout(() => { if (lastBase.split("|")[0] !== b.id) map.setLayoutProperty(id, "visibility", "none"); }, 650);
        }
      });
      map.setLayoutProperty("hillshade", "visibility", raster ? "none" : "visible");
      // Over a raster basemap the vector layers are redundant. Hiding them (not just fading) means the map stops
      // requesting and parsing vector tiles altogether, which is a big part of the zoom lag.
      vectorLayers.forEach(({ id, vis }) => map.setLayoutProperty(id, "visibility", !raster || (bm.keepCoast && id === "coast-line") ? vis : "none"));
      map.setPaintProperty("coast-line", "line-color", raster ? bm.coast : "#5a9e9c");
      updateTerrain();
      warmCache(bm);
    }
    applyOverlays(s);
    applyFlood(s);
  }

  /* Sea-level exposure tiles built by tools/build-flood.mjs: one tile set per water level, swapped as the selection changes. */
  let floodShown = null;
  function applyFlood(s) {
    if (s.floodId === floodShown) return;
    if (floodShown) {
      const old = `flood-${floodShown}`;
      if (map.getLayer(old)) { map.removeLayer(old); map.removeSource(old); }
    }
    floodShown = s.floodId;
    if (!s.floodId) return;
    const id = `flood-${s.floodId}`;
    const url = `${new URL("data/sealevel/", location.href).href}${s.floodId}/{z}/{x}/{y}.png`; // tile URLs must be absolute for MapLibre's workers
    map.addSource(id, { type: "raster", tiles: [url], tileSize: 256, minzoom: 0, maxzoom: 13, attribution: "Sea-level exposure: project DEM" }); // z0–z13 so it never drops out when zooming out
    map.addLayer({ id, type: "raster", source: id, paint: { "raster-opacity": 0, "raster-opacity-transition": { duration: 300, delay: 0 }, "raster-resampling": "linear" } }, "coast-line");
    requestAnimationFrame(() => map.setPaintProperty(id, "raster-opacity", 1));
  }

  /* 3D terrain makes the map re-drape every layer on every frame, so only pay for it when it's visible:
     tilted view, zoomed in. Flat top-down views use the (cheap) hillshade instead. */
  let terrainOn = false;
  function updateTerrain() {
    const want = getState().terrain && map.getPitch() >= 10 && map.getZoom() >= 5;
    if (want === terrainOn) return;
    terrainOn = want;
    map.setTerrain(want ? { source: "dem", exaggeration: 1.6 } : null);
  }
  map.on("moveend", updateTerrain);
  let lastInteraction = 0;
  setBusyCheck(() => map.isMoving() || document.hidden === false && performance.now() - lastInteraction < 1500);
  const touched = () => (lastInteraction = performance.now());
  root.addEventListener("pointerdown", touched, { passive: true });
  root.addEventListener("wheel", touched, { passive: true });

  /* While the camera is moving, drop the CSS backdrop blur (it re-blurs the canvas every frame); it returns when still. */
  let calmTimer = 0;
  map.on("movestart", () => { clearTimeout(calmTimer); shell.classList.add("map-moving"); });
  map.on("moveend", () => { clearTimeout(calmTimer); calmTimer = setTimeout(() => shell.classList.remove("map-moving"), 250); });

  /* Warm the persistent tile cache (sw.js) for the study area: terrain, vector coast and the active imagery. */
  function warmCache(bm) {
    prefetch("dem", DEM_TILES);
    prefetch("vector", map.getSource(vectorSource())?.tiles?.[0]);
    if (bm?.type === "raster" && !bm.noPrefetch) prefetch(bm.id, bm.tiles[0], { maxZ: bm.maxzoom < 9 ? bm.maxzoom : 9 });
  }

  /* Live ocean overlays (e.g. sea surface temperature) above the basemap, below the coastline. */
  const overlayAdded = new Set();
  let lastOverlays = "";
  function applyOverlays(s) {
    const key = JSON.stringify(s.overlays);
    if (key === lastOverlays) return;
    lastOverlays = key;
    OVERLAYS.forEach((o) => {
      const st = s.overlays[o.id], id = `ov-${o.id}`;
      if (st?.on && !overlayAdded.has(o.id)) {
        overlayAdded.add(o.id);
        map.addSource(id, { type: "raster", tiles: o.tiles, tileSize: o.tileSize, maxzoom: o.maxzoom, attribution: o.credit });
        map.addLayer({ id, type: "raster", source: id, paint: { "raster-opacity": 0, "raster-opacity-transition": { duration: 250, delay: 0 }, "raster-resampling": "linear" } }, "coast-line");
      }
      if (overlayAdded.has(o.id)) {
        map.setLayoutProperty(id, "visibility", st.on ? "visible" : "none");
        requestAnimationFrame(() => map.setPaintProperty(id, "raster-opacity", st.on ? st.opacity : 0));
      }
    });
  }

  function sync(s) {
    applyBasemap(s);
    syncLayers(s);
    styleCoast(); // a layer coming on or off changes how much of the coast border shows
    markers.forEach((m) => (m.getElement().style.display = s.showPlaces ? "" : "none"));
  }
  const unsubscribe = subscribe((s) => { if (map.getSource("dem")) sync(s); }); // style is ready once the 3D sources exist; don't gate on tile loading

  map.on("mousemove", (e) => onCoords(e.lngLat));
  const onFullscreen = () => setTimeout(() => map.resize(), 100);
  document.addEventListener("fullscreenchange", onFullscreen);
  const resized = new ResizeObserver(() => map.resize());
  resized.observe(root);

  const act = (name) => {
    if (name === "in") map.zoomIn();
    if (name === "out") map.zoomOut();
    if (name === "reset") { clearLayers(); fit(); } // both start the map clean: every layer off
    if (name === "globe") { clearLayers(); showGlobe(); }
    if (name === "tilt") map.easeTo({ pitch: map.getPitch() > 5 ? 0 : 55, duration: 700 });
    if (name === "full") document.fullscreenElement ? document.exitFullscreen() : shell.requestFullscreen?.();
  };
  const destroy = () => {
    unsubscribe(); resized.disconnect(); clearTimeout(calmTimer);
    window.removeEventListener("panelschange", onPanels); window.removeEventListener("layerfocus", onFocus);
    document.removeEventListener("fullscreenchange", onFullscreen);
    root.removeEventListener("pointerdown", touched); root.removeEventListener("wheel", touched);
    mounted.forEach((layer) => renderersOf(layer).forEach((r) => r.remove(map, layer)));
    if (window.__map === map) window.__map = null;
    map.remove();
  };
  return { act, destroy };
}

/* ---------- React components ---------- */
/** Colours of the layers that are on the map. The renderers say what they draw (legend, describe) once their data is in. */
function Legend() {
  const active = useStore((s) => s.activeLayers);
  const [, redraw] = useReducer((n) => n + 1, 0);
  useEffect(() => { window.addEventListener("layerdatachange", redraw); return () => window.removeEventListener("layerdatachange", redraw); }, []);
  const num = (v) => (typeof v === "number" ? +v.toPrecision(4) : v ?? "");
  const layers = active.map((id) => LAYERS.find((l) => l.id === id));
  return (
    <div className="legend" id="legend">
      <span className="card-kicker">Legend</span>
      {layers.map((l) => {
        const rs = renderersOf(l), legends = rs.map((r) => r.legend?.(l)).filter(Boolean), note = rs.map((r) => r.describe?.(l)).filter(Boolean).join(" · ");
        return (
          <div className="lg" key={l.id}>
            <div className="lg-name"><i style={{ background: l.color }} />{l.title}</div>
            {legends.length ? legends.map((g, i) => (g.classes
              ? <ul className="lg-classes" key={i}>{g.classes.map((c, j) => <li key={j}><i style={{ background: c.color, opacity: c.opacity ?? 1 }} />{c.label}</li>)}</ul>
              : <Fragment key={i}><span className="sw-ramp filled" style={{ background: g.ramp }} /><span className="lg-scale"><em>{num(g.min)}</em><em>{g.unit ?? ""}</em><em>{num(g.max)}</em></span></Fragment>))
              : <small className="lg-note">Nothing to draw for this layer yet</small>}
            {note ? <small className="lg-note">{note}</small> : null}
          </div>
        );
      })}
      {!layers.length ? <small className="lg-note">Switch a layer on with the toggles above to see its colours here.</small> : null}
    </div>
  );
}

/** "Map layers" picker: basemap gallery + live ocean overlays. */
function LayersPopover() {
  const basemap = useStore((s) => s.basemap), overlays = useStore((s) => s.overlays);
  const update = (id, patch) => setState({ overlays: { ...getState().overlays, [id]: { ...getState().overlays[id], ...patch } } });
  return (
    <div className="popover layers-pop" onClick={(e) => e.stopPropagation()}>
      <h3 className="side-title">Basemap</h3>
      <div className="bm-grid">
        {BASEMAPS.map((b) => (
          <button key={b.id} className={`bm ${b.id === basemap ? "active" : ""}`} aria-pressed={b.id === basemap} onClick={() => setState({ basemap: b.id })}>
            <span className={`bm-thumb ${b.thumb ? "" : "bm-dark"}`} style={b.thumb ? { backgroundImage: `url('${b.thumb}')` } : undefined} />
            <span className="bm-name">{b.label}</span>
            <span className="bm-sub">{b.sub}</span>
          </button>
        ))}
      </div>
      <h3 className="side-title ov-title">Ocean overlays</h3>
      {OVERLAYS.map((o) => {
        const st = overlays[o.id];
        return (
          <div className={`ov ${st?.on ? "on" : ""}`} key={o.id}>
            <label className="ov-row">
              <input type="checkbox" checked={!!st?.on} onChange={(e) => update(o.id, { on: e.target.checked })} />
              <span className="switch" />
              <span className="ov-text"><b>{o.label}</b><small>{o.sub}</small></span>
            </label>
            <label className="ov-opacity"><span>Opacity</span><input type="range" min="0.15" max="1" step="0.05" value={st?.opacity ?? o.opacity} onChange={(e) => update(o.id, { opacity: +e.target.value })} /></label>
          </div>
        );
      })}
      <p className="bm-note">Free, open sources. Credits appear under the ⓘ on the map.</p>
    </div>
  );
}

function SettingsPopover() {
  const terrain = useStore((s) => s.terrain), showPlaces = useStore((s) => s.showPlaces), showCoords = useStore((s) => s.showCoords);
  return (
    <div className="popover" onClick={(e) => e.stopPropagation()}>
      <h3 className="side-title">Map settings</h3>
      <label className="row"><input type="checkbox" checked={terrain} onChange={(e) => setState({ terrain: e.target.checked })} /> 3D terrain</label>
      <label className="row"><input type="checkbox" checked={showPlaces} onChange={(e) => setState({ showPlaces: e.target.checked })} /> Reference places &amp; regions</label>
      <label className="row"><input type="checkbox" checked={showCoords} onChange={(e) => setState({ showCoords: e.target.checked })} /> Cursor coordinates</label>
    </div>
  );
}

const Tool = ({ tip, label = tip, paths, ...rest }) => <button className="tool" data-tip={tip} aria-label={label} {...rest}><Icon paths={paths} /></button>;

/** `handles` are the two panel handles (src/App.jsx), which sit on the map's edges. */
export function MapView({ onAbout, handles }) {
  const showCoords = useStore((s) => s.showCoords), primary = useStore((s) => s.primaryLayer);
  const open = LAYERS.find((l) => l.id === primary), omMode = isOmLayer(open), npMode = isNpLayer(open);
  useOmTab(omMode ? open : null);
  useNpStart(npMode ? open : null);
  const root = useRef(null), host = useRef(null), api = useRef(null), coords = useRef(null);
  const [status, setStatus] = useState(null);
  const [pop, setPop] = useState(null); // "layers" | "settings" | null: the two pop-overs close each other

  useEffect(() => {
    try {
      api.current = createMap(host.current, root.current, setStatus, (p) => { if (coords.current) coords.current.textContent = `${p.lat.toFixed(3)}°N   ${p.lng.toFixed(3)}°E`; });
    } catch (e) {
      console.warn("Map failed to start", e);
      setStatus("Map library failed to load — check your connection");
    }
    return () => { api.current?.destroy(); api.current = null; };
  }, []);
  useEffect(() => { // a click anywhere else closes the open pop-over
    if (!pop) return undefined;
    const close = () => setPop(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [pop]);
  const toggle = (name) => (e) => { e.stopPropagation(); setPop(pop === name ? null : name); };

  return (
    <main id="map-area" className="map-area" ref={root}>
      <div id="map" className="map" aria-label="Pakistan coastline base map" ref={host} />
      <div className="map-vignette" />
      <div className="coin" aria-label="NDMA Pakistan" role="img">
        <div className="coin-spin">
          {[1, 2, 3, 4].map((i) => <span key={i} className="coin-edge" style={{ "--z": `${-i * 0.7}px` }} />)}
          <span className="coin-face"><img src="/brand/ndma.png" alt="" /></span>
          <span className="coin-face coin-back"><img src="/brand/ndma.png" alt="" /></span>
        </div>
      </div>
      <div className="brand brand-float">
        <div><h1>Coastal Inteligence</h1><p>Pakistan Coastal Environmental Monitoring</p></div>
      </div>
      <div className="map-tools">
        {TOOLS.map((t, i) => (t ? <Tool key={t.act} tip={t.tip} label={t.label} paths={t.paths} data-act={t.act} onClick={() => api.current?.act(t.act)} /> : <span className="tool-sep" key={i} />))}
        <span className="tool-sep" />
        <Tool tip="Map layers" paths={LAYERS_ICON} onClick={toggle("layers")} />
        <Tool tip="Map settings" paths={SETTINGS_ICON} id="btnSettings" onClick={toggle("settings")} />
        <Tool tip="About this portal" paths={INFO_ICON} id="btnInfo" onClick={onAbout} />
      </div>
      {pop === "layers" ? <LayersPopover /> : null}
      {pop === "settings" ? <SettingsPopover /> : null}
      {omMode ? <OmLeft /> : npMode ? <NpLeft /> : <Legend />}
      <div className="bot-dock"><AssistantButton /></div>
      {omMode ? <><OmDock /><OmTop /><OmFree /></> : npMode ? <><NpDock /><NpTop /></> : <Timeline />}
      <OmFloats />
      <div className="coords" id="coords" ref={coords} style={{ display: showCoords ? "" : "none" }}>— °N &nbsp; — °E</div>
      {status ? <div className="map-status" id="mapStatus">{status}</div> : null}
      {handles}
      <TerminalButton />
      <TourButton />
      <ShowcaseButton />
    </main>
  );
}
