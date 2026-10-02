import { LAYERS, PLACES, REGION_LABELS, MAP_VIEW } from "../config/layers.js";
import { BASEMAPS, OVERLAYS } from "../config/basemaps.js";
import { RENDERERS } from "../map/renderers.js";
import { prefetch, setBusyCheck } from "../map/prefetch.js";
import { registerDemProtocol } from "../map/demProtocol.js";
import { getState, subscribe } from "../state.js";
import { Timeline } from "./timeline.js";

const DEM_TILES = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const GLOBE_VIEW = { center: [66, 20], zoom: 1.75 };
const STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json";
const ico = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;

export function CoastalMap(root) {
  root.innerHTML = `
    <div id="map" class="map" aria-label="Pakistan coastline base map"></div>
    <div class="map-vignette"></div>

    <div class="brand brand-float">
      <div><h1>Coastal Environmental Intelligence</h1><p>Pakistan Coastal Environmental Monitoring</p></div>
    </div>

    <div class="map-tools">
      <button class="tool" data-tip="Zoom in" data-act="in" aria-label="Zoom in">${ico('<path d="M12 5v14M5 12h14"/>')}</button>
      <button class="tool" data-tip="Zoom out" data-act="out" aria-label="Zoom out">${ico('<path d="M5 12h14"/>')}</button>
      <span class="tool-sep"></span>
      <button class="tool" data-tip="Toggle 3D tilt" data-act="tilt" aria-label="Toggle 3D tilt">${ico('<path d="M12 3 4 7v10l8 4 8-4V7Z"/><path d="m4 7 8 4 8-4M12 11v10"/>')}</button>
      <button class="tool" data-tip="Earth view" data-act="globe" aria-label="Earth view">${ico('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>')}</button>
      <button class="tool" data-tip="Reset to Pakistan coast" data-act="reset" aria-label="Reset view">${ico('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>')}</button>
      <button class="tool" data-tip="Fullscreen" data-act="full" aria-label="Fullscreen map">${ico('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>')}</button>
    </div>


    <div class="legend" id="legend"></div>
    <div class="timeline" id="timeline"></div>
    <div class="coords" id="coords">— °N &nbsp; — °E</div>
    <div class="map-status" id="mapStatus" hidden>Basemap tiles unavailable — check your connection</div>`;

  if (!window.maplibregl) {
    root.querySelector("#mapStatus").hidden = false;
    root.querySelector("#mapStatus").textContent = "Map library failed to load — check your connection";
    return { resize() {}, toggleFullscreen() {} };
  }

  if (maplibregl.config) maplibregl.config.MAX_PARALLEL_IMAGE_REQUESTS = 32; // default 16 throttles tile-heavy views
  if (!maplibregl.__demRegistered) { registerDemProtocol(maplibregl); maplibregl.__demRegistered = true; }

  const map = new maplibregl.Map({
    container: root.querySelector("#map"),
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
  window.__map = map; // debugging handle

  const TILT = 45;
  /* Fly from the Earth view down to the study area (and back). Camera padding lifts the globe clear of the timeline. */
  /* The panels are glass overlays above the map, so account for whichever ones are open. */
  const insets = () => {
    const shell = root.closest(".shell");
    if (!window.matchMedia("(min-width: 1101px)").matches) return { l: 0, r: 0 };
    return {
      l: shell.classList.contains("left-closed") ? 0 : shell.querySelector(".sidebar").offsetWidth,
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
  /* Re-tint the stock dark style: navy sea, slate land, luminous coastline; drop road/building clutter. */
  function tintBasemap() {
    const set = (id, prop, v) => map.getLayer(id) && map.setPaintProperty(id, prop, v);
    set("background", "background-color", "#1c3038");
    ["landcover", "landuse", "park_national_park", "park_nature_reserve"].forEach((id) => set(id, "fill-color", "#1e343d"));
    set("landuse_residential", "fill-color", "#1d2f38");
    set("water", "fill-color", "#0a1d2a");
    set("waterway", "line-color", "#2b5566");
    set("boundary_country_outline", "line-color", "#2b3d47");
    set("boundary_country_inner", "line-color", "#2b3d47");
    map.getStyle().layers.forEach((l) => {
      if (["transportation", "building", "aeroway"].includes(l["source-layer"]) && !/^road_(pri|trunk|mot)_fill/.test(l.id)) map.setLayoutProperty(l.id, "visibility", "none");
    });
    /* 3D: globe projection, free terrain-RGB DEM, hillshade, optional satellite imagery, atmosphere */
    map.setProjection({ type: "globe" });
    // separate sources: terrain needs fine detail only when tilted, hillshade is fine at lower resolution
    // "dem://" serves the project's 12.5 m DEM (MSL-corrected) where it exists, else global terrain with a flat sea
    map.addSource("dem", { type: "raster-dem", encoding: "terrarium", tileSize: 256, maxzoom: 13, tiles: ["dem://{z}/{x}/{y}"], attribution: "Terrain: project DEM (12.5 m) · global terrain: Mapzen / AWS Open Data" });
    map.addSource("dem-hs", { type: "raster-dem", encoding: "terrarium", tileSize: 256, maxzoom: 11, tiles: ["demhs://{z}/{x}/{y}"] });
    map.addLayer({ id: "hillshade", type: "hillshade", source: "dem-hs", paint: { "hillshade-shadow-color": "#050f14", "hillshade-highlight-color": "#4a6e74", "hillshade-accent-color": "#0a1d2a", "hillshade-exaggeration": 0.45 } }, "waterway");
    try { map.setSky({ "sky-color": "#0b1820", "horizon-color": "#2a5560", "fog-color": "#0b1820", "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.6, "fog-ground-blend": 0.9, "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 1, 8, 0] }); } catch {}
    map.addLayer({ id: "coast-line", type: "line", source: "carto", "source-layer": "water", paint: { "line-color": "#5a9e9c", "line-opacity": 0.7, "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.7, 10, 1.3] } }, "water_shadow");
    vectorLayers = map.getStyle().layers.filter((l) => l.source === "carto").map((l) => ({ id: l.id, vis: l.layout?.visibility ?? "visible" }));
  }
  let vectorLayers = []; // the dark vector map's layers and their default visibility

  map.on("load", () => {
    try { tintBasemap(); } catch (e) { console.warn("Basemap tint skipped", e); }
    root.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
    root.querySelector(".maplibregl-ctrl-attrib")?.removeAttribute("open");
    addReference(); applyBasemap(getState()); sync(getState());
    map.jumpTo({ ...GLOBE_VIEW, pitch: 0, padding: globePad() });
    updateGlobeState();
    // the service worker may only take control after first load, so try the cache warm-up again once idle
    map.once("idle", () => setTimeout(() => warmCache(BASEMAPS.find((b) => b.id === getState().basemap)), 3000));
  });

  /* Earth view: clicking the globe flies to the study area */
  const updateGlobeState = () => root.classList.toggle("is-globe", map.getZoom() < 4.2);
  map.on("zoom", updateGlobeState);
  window.addEventListener("panelschange", () => { if (map.getZoom() < 3.2 && !map.isMoving()) map.easeTo({ padding: globePad(), duration: 320 }); });
  map.on("click", () => { if (map.getZoom() < 3.2) fit(); });
  map.on("error", (e) => { if (e?.error?.status || /Failed to fetch/.test(e?.error?.message ?? "")) root.querySelector("#mapStatus").hidden = false; });

  /* --- reference labels (places only, no environmental values) --- */
  const markers = [];
  function addReference() {
    PLACES.forEach((p) => {
      const el = document.createElement("div");
      el.className = `place r${p.rank}`;
      el.innerHTML = `<i></i><span>${p.name}</span>`;
      markers.push({ kind: "place", m: new maplibregl.Marker({ element: el, anchor: "left", offset: [-4, 0] }).setLngLat(p.lngLat).addTo(map) });
    });
    REGION_LABELS.forEach((r) => {
      const el = document.createElement("div");
      el.className = "region";
      el.textContent = r.name;
      markers.push({ kind: "region", m: new maplibregl.Marker({ element: el }).setLngLat(r.lngLat).addTo(map) });
    });
  }

  /* --- overlays driven by state --- */
  const mounted = new Map();
  function syncLayers(s) {
    mounted.forEach((layer, id) => {
      if (!s.activeLayers.includes(id)) { RENDERERS[layer.mapLayer.type]?.remove(map, layer); mounted.delete(id); }
    });
    s.activeLayers.forEach((id) => {
      if (mounted.has(id)) return;
      const layer = LAYERS.find((l) => l.id === id);
      RENDERERS[layer.mapLayer.type]?.add(map, layer);
      mounted.set(id, layer);
    });
  }

  function renderLegend(s) {
    const layers = s.activeLayers.map((id) => LAYERS.find((l) => l.id === id));
    root.querySelector("#legend").innerHTML = `<span class="card-kicker">Legend</span>` + layers.map((l) => {
      const g = l.legend;
      const swatch = g.kind === "categorical"
        ? `<span class="sw-cat" style="--layer:${l.color}"></span>`
        : `<span class="sw-ramp ${g.kind}" style="--layer:${l.color}"></span>`;
      const scale = g.kind === "categorical" ? "" : `<span class="lg-scale"><em>min</em><em>${g.unit && g.unit !== "—" ? g.unit : ""}</em><em>max</em></span>`;
      return `<div class="lg fade"><div class="lg-name">${g.label}</div>${swatch}${scale}</div>`;
    }).join("") + `<small class="lg-note">${layers.length ? "Scale will appear once data is connected" : "No layers switched on"}</small>`;
  }

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
  setBusyCheck(() => map.isMoving() || document.hidden === false && performance.now() - lastInteraction < 1500);
  let lastInteraction = 0;
  root.addEventListener("pointerdown", () => (lastInteraction = performance.now()), { passive: true });
  root.addEventListener("wheel", () => (lastInteraction = performance.now()), { passive: true });

  /* While the camera is moving, drop the CSS backdrop blur (it re-blurs the canvas every frame); it returns when still. */
  const shell = root.closest(".shell");
  let calmTimer = 0;
  map.on("movestart", () => { clearTimeout(calmTimer); shell.classList.add("map-moving"); });
  map.on("moveend", () => { clearTimeout(calmTimer); calmTimer = setTimeout(() => shell.classList.remove("map-moving"), 250); });

  /* Warm the persistent tile cache (sw.js) for the study area: terrain, vector coast and the active imagery. */
  function warmCache(bm) {
    prefetch("dem", DEM_TILES);
    prefetch("vector", map.getSource("carto")?.tiles?.[0]);
    if (bm?.type === "raster") prefetch(bm.id, bm.tiles[0], { maxZ: bm.maxzoom < 9 ? bm.maxzoom : 9 });
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
    markers.forEach(({ m }) => (m.getElement().style.display = s.showPlaces ? "" : "none"));
    root.querySelector("#coords").style.display = s.showCoords ? "" : "none";
  }

  let prev = {};
  subscribe((s) => {
    if (prev.activeLayers !== s.activeLayers.join()) renderLegend(s);
    prev = { activeLayers: s.activeLayers.join() };
    if (map.getSource("dem")) sync(s); // style is ready once the 3D sources exist; don't gate on tile loading
  });
  const s0 = getState();
  renderLegend(s0);
  Timeline(root.querySelector("#timeline"));
  prev = { activeLayers: s0.activeLayers.join() };

  /* --- controls --- */
  const coords = root.querySelector("#coords");
  map.on("mousemove", (e) => (coords.innerHTML = `${e.lngLat.lat.toFixed(3)}°N &nbsp; ${e.lngLat.lng.toFixed(3)}°E`));

  function toggleFullscreen() {
    const host = root.closest(".shell");
    document.fullscreenElement ? document.exitFullscreen() : host.requestFullscreen?.();
  }
  document.addEventListener("fullscreenchange", () => setTimeout(() => map.resize(), 100));

  root.querySelector(".map-tools").addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "in") map.zoomIn();
    if (act === "out") map.zoomOut();
    if (act === "reset") fit();
    if (act === "globe") showGlobe();
    if (act === "tilt") map.easeTo({ pitch: map.getPitch() > 5 ? 0 : 55, duration: 700 });
    if (act === "full") toggleFullscreen();
  });
  new ResizeObserver(() => map.resize()).observe(root);

  return { toggleFullscreen };
}
