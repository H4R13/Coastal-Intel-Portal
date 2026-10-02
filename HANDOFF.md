# Coastal Environmental Intelligence Portal — Handoff

Frontend for a Pakistan-coast environmental monitoring portal. Written for someone (or a fresh Claude session) picking this up with **no prior context**. Last updated 2026-10-01.

> **Standing rule from the owner: never fabricate environmental data.** No invented measurements, trends, projections, erosion rates, salinity values or statistics. Anything without a real dataset shows a placeholder ("—", "Dataset required", "No data connected"). All real data comes from the owner's team and is not available yet, except the DEM-derived terrain and exposure layers described in §5.

---

## 1. Status at a glance

| Area | State |
|---|---|
| UI shell (map, left dock, right panel, controls) | Done, visually iterated with the owner |
| 7 layer buttons, per-layer config, charts, indicators, about/metadata | Done as **placeholders**; no real data connected |
| 3D globe basemap, 7 basemaps, SST overlay | Done |
| Tile caching + study-area prefetch (service worker) | Done, **unverified in a real browser** |
| Zoom-speed fixes | Done in code, **never measured** (see §7) |
| DEM → MSL-corrected terrain tiles | Done (4,175 tiles, 383 MB) |
| Sea-level "terrain exposure" tiles + selector | Done (5 illustrative levels), **not seen rendering in the portal** |
| Time slider + play button (1990–2050) | **Built 2026-10-02**; moves `state.year` only, no layer reads the year yet (see §4a) |
| Icons vs map toggles | **Split 2026-10-02**: icons open the panel, toggles under the dock show layers on the map |
| Coastal Erosion, Mangroves data layers | **Waiting on the team's data** (these two go first) |
| Scenario/projection values for 2050 | **Waiting on the team** |

---

## 2. Run it

```bash
cd D:\NDMA\PakCoast
node serve.mjs          # static server on http://localhost:5173
```

- No build step and no `npm install` for the app: plain ES modules, MapLibre GL JS **5.6.0** from unpkg CDN, Manrope from Google Fonts.
- `.claude/launch.json` defines a `pakcoast` preview config that runs the same command.
- `serve.mjs` serves the app and `data/`; it deliberately 404s `/tools`, `/.claude`, `/node_modules`.
- Needs internet (tiles, CDN, fonts). The service worker only works on `localhost` or https.
- Benchmark: open `http://localhost:5173/?perf` and press **Run** (see §7).
- Not a git repository. Recommend `git init` plus a `.gitignore` for `data/`, `tools/node_modules/`, `tools/data/` (see §9).

---

## 3. The original brief (condensed)

One persistent interactive coastal base map in the centre; exactly **seven** primary layer buttons on the left; a dynamic analysis panel on the right (graphs, indicators, description) that changes with the selected layer. Select layer → update map → update panel. It should feel like a professional environmental-intelligence/GIS platform, not a generic SaaS or sci-fi dashboard. Config-driven: each layer has its own metadata, chart config, map-layer config and future data endpoint; never hard-code per layer.

Layers: Sea Level Rise, Saltwater Intrusion, Salinity Index, Mangroves, Coastal Erosion, Microplastics, Fisheries. Modes: Current, Historical, 2050 outlook. Most layers will eventually have historic + projected data to 2050 driven by a time slider. Multi-layer overlay is supported by the architecture; **no composite "risk score"** was asked for or built.

---

## 4. Current UI (what exists after many revisions)

Layout is a full-bleed map with two overlay panels (desktop ≥1101px):

- **Left:** transparent magnifying **dock** of the 7 layers (icons only; name + descriptor appear in a tooltip on hover/focus). No outer panel box. A small "Overlay" switch below enables multi-layer mode (selected items get a coloured dot).
- **Right:** **glass panel** (blur, sheen) with the Current / Historical / 2050 outlook tabs at the top, then layer title + lead line, chart tabs + chart placeholder, key indicators, "What this layer shows", data availability, metadata. In 2050 mode it adds the scenario selector (disabled) and "—" outlook indicators. For **Sea Level Rise** it also shows the **Terrain exposure** chip row (§5.4).
- **Top-left:** glass plate with the portal name and subtitle (no logo).
- **Map controls (top right):** zoom in/out, 3D tilt, Earth view, reset to study area, fullscreen, **Map layers** (basemap gallery + overlays), **Map settings** (3D terrain, places, coordinates), About.
- **Bottom:** legend (bottom-left), disabled time control (bottom-centre, ticks change per mode), cursor coordinates (bottom-right), scale bar and the ⓘ attribution button.
- **Panel handles:** small tabs on the inner map edges slide each panel out/in (state saved in `localStorage` key `pakcoast.panels`).
- **Earth view:** the page opens on a globe with a starfield backdrop; **clicking the globe flies to the study area** (Pakistan coast, 45° tilt). The globe is kept centred between the panels via camera padding.
- **Tablet/phone (≤1100px):** panels stack (sidebar chips row → map → analysis), solid backgrounds, no magnification; layer list collapses on phones.
- **Removed on request:** header/navbar, bottom status bar, north arrow, the "Environmental data layer" map card, the logo SVG, the 01–07 numbering, the Earth-view hint pill and "Study area" pin.

Visual language (owner feedback): coastal research institute, **not** a sci-fi console. Deep blue-green surfaces, muted teal accent, **sand/gold secondary accent**, warm off-white text, Manrope, mostly sentence case (uppercase only for tiny kickers), restrained glow, soft rounded cards. Per-layer colours: sea level teal `#3fb6ae`, intrusion `#4e9fc0`, salinity aqua `#7acfd0`, mangroves green `#7fb069`, erosion coral `#d98272`, microplastics amber `#d8a85a`, fisheries blue `#5b8fd0`.

### 4a. Changes of 2026-10-02 (supersede the description above where they differ)

- **Rollback point:** `_snapshots/2026-10-02_before-timeline/` holds `css/`, `js/`, `DMJM/`, `index.html`, `serve.mjs`, `sw.js`, `HANDOFF.md` as they were before this work (git is not installed on this machine). To roll back, copy those back over the project root and delete `js/components/timeline.js`.
- **Tabs** are now Historical (1990–2025) / Normal (1990–2050) / Forecast (2027–2050), defined as year ranges in `MODES` (`js/config/layers.js`); `PRESENT_YEAR = 2026` marks where forecast starts. Mode ids changed from `current|historical|outlook` to `historical|normal|forecast`.
- **Timeline** (`js/components/timeline.js`): year slider + play/pause (one year per 700 ms, stops at the end of the range). State gained `year`, `playing`, and helpers `setMode`, `setYear`, `modeRange`. Nothing reads `year` yet: connecting a layer means filtering its map source and moving a chart cursor on `state.year`.
- **Dock icons** only open the analysis panel (`primaryLayer`). **Toggles** under the dock control `activeLayers` (what is drawn); it may be empty. The old "Overlay" switch and `multiSelect` are gone. A dot on an icon means that layer is on the map.
- Dock icon tiles are solid (no map showing through).
- `DMJM/` is a teammate's plastic-debris work: `index.html` there is a Python script saved as .html and does not run; the CSV is synthetic demo data (2025-01 to 2026-09, 12 sites); `simulate-2050.mjs` produced `projection_2050.json/.csv` (scenario ranges 2026–2050, not a forecast). None of it is wired into the portal.
- Checked in headless Chrome (panels, toggles, tabs, slider, play/pause, no console errors). The map canvas itself does not render headless, so the map was **not** visually checked.

### File map

```
index.html            shell, About dialog, loads MapLibre CDN + js/main.js
css/styles.css        all styles (tokens in :root; "glass panels" and "sidebar: magnifying dock" sections)
serve.mjs             dev static server
sw.js                 service worker: persistent tile cache (cache-first; SWR for volatile tiles)
js/main.js            composition root; registers SW; ?perf hook
js/state.js           tiny store: mode, primaryLayer, activeLayers, multiSelect, chartIndex,
                      showPlaces/Coords, basemap, overlays, terrain, floodId
js/config/layers.js   THE layer registry (see below) + MODES, PLACES, REGION_LABELS, MAP_VIEW
js/config/basemaps.js BASEMAPS (7) and OVERLAYS (SST) with tile URLs, credits, licences
js/components/
  coastalMap.js       map, globe/terrain/hillshade, basemap + overlay + flood layers, legend, timeline,
                      controls, caching/prefetch wiring, perf-related behaviour
  layerSidebar.js     magnifying dock (vanilla port of a framer-motion Dock; spring physics)
  analysisPanel.js    right panel render; terrain-exposure section
  modeTabs.js         Current/Historical/2050 segmented control
  mapLayers.js        "Map layers" popover (basemap gallery, overlays)
  mapSettings.js      settings + About buttons/popover
  panelToggles.js     slide-in/out handles, dispatches `panelschange`
  chart.js            chart component: placeholder frame or minimal line/bar renderer from {series:[{points:[{x,y}]}]}
js/map/
  renderers.js        plug-in map layer renderers by type (raster/points/polygons/lines/heatmap); no-ops until an endpoint is set
  demProtocol.js      dem:// and demhs:// tile protocol (local DEM first, global fallback)
  prefetch.js         study-area tile cache warm-up (pauses while the user interacts)
js/perf.js            zoom benchmark (?perf)
tools/                offline data-prep scripts (not part of the web app) — see §5
data/                 GENERATED tiles (terrain, sealevel) — large, not in source control
```

### How a layer is defined (`js/config/layers.js`)

```js
{ id, title, descriptor, lead, color, icon /*svg*/, about,
  availability: [...],                      // rows under "Data availability"
  mapLayer: { type, label, planned:[...], endpoint:null },  // type picks a renderer in js/map/renderers.js
  legend: { kind:"ramp|categorical|diverging", label, unit },
  charts: [{ id,title,type,xLabel,yLabel,unit,placeholder,endpoint:null }],
  indicators: [{ id,label,unit,value:null }],   // null renders "—"
  meta: { source,temporal,spatial,updated },    // null renders "Not connected"/"Not available"
  endpoint:null }
```

To connect real data: set `mapLayer.endpoint` (GeoJSON or raster tile URL), `charts[].endpoint` (JSON shaped for `chart.js`), `indicators[].value`, `meta`. No component change is intended to be needed.

---

## 5. Data pipeline: DEM, sea level, erosion

### 5.1 Source rasters (outside the repo)

| File | Notes |
|---|---|
| `D:\NDMA\Sindh12.5.tif` | 12.5 m, UTM 42N, int16, nodata −32768, 3.6 GB, tiled 128², uncompressed. Covers lon 66.18–71.65, lat 23.79–28.53 (Karachi east + delta). |
| `D:\NDMA\Balochistan12.5.tif` | Same format, 11 GB. lon 60.26–70.81, lat 24.24–32.51 (Makran coast). |
| `D:\NDMA\Pakistan_s DEM 30M Resolution\Pakistan_DEM_Copernicus30-…tif` | Copernicus 30 m, WGS84, but **only lon 69.7–77.0, lat 23.7–28.3 (east Pakistan) — does not cover the coast.** It looks like one tile of a larger export. The owner said they would supply the missing tiles but then chose the 12.5 m route instead. If those tiles arrive, Copernicus is already orthometric (EGM2008) and needs no datum correction; the 12.5 m route could then be re-evaluated. |

The 12.5 m rasters' **origin product is unconfirmed** (they look like ALOS PALSAR RTC but this was not verified with the owner).

### 5.2 The vertical-datum correction (important)

The 12.5 m heights are **ellipsoidal (WGS84)**, not above sea level (Manora on the Karachi coast reads −37 m raw). Orthometric height is computed as `H = h − N` using the **EGM2008** geoid (N ≈ −44 to −47 m here).

- Geoid grid: PROJ `us_nga_egm08_25.tif` (80.6 MB) downloaded from `https://cdn.proj.org/us_nga_egm08_25.tif` to `tools/data/` — **the owner approved this download implicitly via the option "12.5 m rasters, with a proper geoid correction"**.
- Validation after correction: Karachi Saddar ≈ 9–10 m, Karachi airport ≈ 24 m, Manora ≈ 8 m, Keti Bandar ≈ 3 m, Indus delta creek ≈ 1–3 m, Gwadar ≈ 7 m, Pasni ≈ 6 m.
- Radar DEMs read high over mangrove/vegetation; vertical error in the flat delta is roughly **1–3 m**. This dominates any flood result.
- Coverage gap: the Sindh raster stops at ~23.8°N, so the southern tip of the delta is missing.

### 5.3 Scripts (`tools/`, ES modules; run from `tools/`)

`tools/package.json` is separate from the app; deps (`geotiff`, `pngjs`, `proj4`) are installed in `tools/node_modules`. Node 24, Windows. **Python is not usable** (WindowsApps stub; `py` launcher exists but no GIS libs) and no GDAL is installed — everything is Node.

| Script | Purpose |
|---|---|
| `build-terrain.mjs` | Merge Sindh+Balochistan → subtract geoid → write **Terrarium-encoded PNG tiles** to `data/terrain/{z}/{x}/{y}.png` + `manifest.json`. z10–11 every land tile; z12–13 only where land ≤ 40 m MSL (coastal lowland). Sea = exactly 0 m. Resumable (skips existing). ~11 min total. `node build-terrain.mjs --zmin 10 --zmax 13` |
| `build-flood.mjs` | From the z13 terrain tiles: 4-connected flood fill from the sea for given water levels; writes coloured depth tiles to `data/sealevel/<id>/{z}/{x}/{y}.png` for **z0–z13** plus `manifest.json`, and updates `data/sealevel/index.json`. Low inland basins the sea cannot reach stay dry. ~1 min per level. `node build-flood.mjs --levels 0.5,1,2,3,5` or `--level 1.2 --id slr_2050_mid` |
| `lib/geoid.mjs` | EGM2008 undulation sampler (bilinear) |
| `validate-geoid.mjs`, `check-terrain.mjs` | Sanity checks at known places |
| `inspect-dem.mjs`, `footprint.mjs`, `layout.mjs`, `sample-points.mjs` | Inspect rasters (extent, resolution, tiling, point samples) |

Built outputs now on disk: `data/terrain` (4,175 tiles: z10 114, z11 421, z12 798, z13 2,842; **383 MB**), `data/sealevel` (5 levels, **~190 MB**).

Exposure areas built (illustrative levels, **not projections**): +0.5 m → 560 km², +1 → 1,206, +2 → 1,960, +3 → 3,715, +5 → 8,253. The jump between 3 m and 5 m partly reflects very flat sabkha lowlands and the DEM error above.

### 5.4 How the portal uses it

- `demProtocol.js` serves `dem://{z}/{x}/{y}` (3D terrain) and `demhs://` (hillshade): local tile if listed in `data/terrain/manifest.json`, else the global AWS Terrarium tile. For terrain the global fallback is clamped to ≥ 0 m so the sea is flat; hillshade uses it raw (it sits under the water layer).
- 3D terrain is only enabled when the view is tilted (≥10°) and zoom ≥ 5, because draping all layers on terrain is expensive.
- `analysisPanel.js` reads `data/sealevel/index.json`; the Sea Level Rise panel shows "Off / +0.5 m … +5 m" chips. Selecting one sets `state.floodId`; `coastalMap.js#applyFlood` swaps a raster layer (z0–13) into the map just under the coastline. A caveat line states this is terrain exposure, not a projection.

### 5.5 Erosion and mangroves (next, blocked on the team)

Not started because there is no shoreline/mangrove data. The terrain tiles are ready to support erosion context (coastal slope, elevation along transects) once shorelines arrive. `layers.js` already declares `erosion` as `lines` (shorelines + transects, legend `diverging`) and `mangroves` as `polygons`; `renderers.js` already renders GeoJSON for those types when `mapLayer.endpoint` is set.

---

## 6. Map layers, sources and licences (all keyless)

Basemaps (`js/config/basemaps.js`): Satellite (Esri World Imagery, **default**; free but not open source), Sentinel-2 cloudless 2021 (EOX, **CC BY-NC-SA — non-commercial**), Blue Marble relief + bathymetry (NASA GIBS), Live MODIS true colour (NASA GIBS, date = today − 2 days), Black Marble night lights (NASA GIBS), OpenTopoMap (CC-BY-SA, fair-use policy), Dark map (CARTO dark-matter vector, re-tinted). Overlay: sea surface temperature (NASA MUR via GIBS, `default/default` = latest). Terrain: AWS Terrarium (global fallback). Vector backdrop: CARTO. Credits show under the ⓘ.

Behaviour worth knowing: raster basemaps are added lazily and cross-faded; when a raster basemap is active **all CARTO vector layers are hidden** (stops vector tile loading); only Dark map and Night lights keep the vector coastline. Chlorophyll was tried and dropped (NASA GIBS only exposes patchy swath data).

Check licences before any public launch (Esri terms, EOX non-commercial, OpenTopoMap usage).

---

## 7. Performance — what was done, what is unknown

The owner repeatedly reported slow zooming. Changes made (none measured):

1. `sw.js`: persistent tile cache (cache-first; stale-while-revalidate for latest-SST and style/tilejson), cap 6,000 entries, never touches app files.
2. `prefetch.js`: warms terrain, vector coast and the active basemap for the study area (z0–9) at low priority; **pauses while the camera moves or within 1.5 s of a click/scroll**.
3. Map options: `pixelRatio` capped at 1.5, `maxTileCacheSize` 400, `fadeDuration` 120, `MAX_PARALLEL_IMAGE_REQUESTS` 32.
4. 3D terrain only when tilted and zoomed in; separate DEM sources for terrain vs hillshade (hillshade at lower resolution).
5. Vector layers hidden under raster basemaps.
6. Reduced backdrop blur; small cards use plain translucent fills; blur on the right panel and title plate is switched off while the camera moves.

**Never verified.** The in-app browser pane in the previous session was hidden and refuses service workers; the Claude in Chrome extension was not connected. Run `/?perf` in Chrome (cold vs warm pass; reports avg/p95 frame time, slow frames, settle time) and use `?perf` output to decide next steps. Likely remaining suspects if it is still slow: first-visit network latency of remote tiles, the globe projection, the vector basemap for the dark map, HiDPI cost. Options noted but not tried: self-hosted PMTiles for basemaps, dropping the globe at high zoom, 512px raster tiles.

Also to verify in Chrome: service worker registers and `pakcoast-tiles-v1` fills (DevTools → Application → Cache Storage).

---

## 8. Known issues / caveats

- **Nothing here has been visually verified since the DEM/flood work** (browser pane unavailable). Specifically unseen: flood layer rendering in the portal, `dem://` protocol, fallback clamping, the exposure chips, perf harness.
- The built-in browser pane's screenshots lag/render map tiles late; use `map.triggerRepaint()` or wait. Maps need the tab visible: a hidden pane stalls rendering.
- `window.__map` is exposed for debugging in `coastalMap.js`.
- The time control (bottom-centre) is a disabled placeholder; the slider logic does not exist.
- River channels connected to the sea can show as flooded in the exposure layer.
- Exposure uses z13 tiles only (~17 m); no tides, surge, defences, subsidence or erosion.
- Ormara/Sonmiani reference coordinates fall on water/lagoon pixels (0 m) — place coordinates in `layers.js` are approximate labels only.
- `data/` (~570 MB) and `tools/data/` (80 MB geoid) are generated/downloaded and should not be committed; the scripts regenerate them.

---

## 9. What to do next (suggested order)

1. **Verify in Chrome** (connect the extension, or run `/?perf` by hand): load without console errors; SW registered; zoom speed; Sea Level Rise → exposure chips draw and stay visible zoomed out; 3D tilt shows local terrain.
2. **Add `.gitignore` + `git init`**, decide how `data/` ships (object storage/CDN; the tile folders are static files).
3. **Build the time slider** (currently a disabled placeholder in `coastalMap.js#renderTimeline`): observed / recent / projected zones, hatched projected zone, scenario selector. Drive it from per-layer JSON manifests (`scenarios`, `years`, `units`, `source`, `citation`, observed-vs-projected split) so `meta`/`temporal` fields fill automatically.
4. **Coastal Erosion** (team): shoreline polylines per year (`year` attribute) + transects (`rate`, `class`); render as `lines` coloured by year, transects coloured by rate; legend `diverging`; 2050 only as clearly labelled extrapolation of measured rates. Use the terrain tiles for slope/elevation context.
5. **Mangroves** (team): polygons with `year` and gain/loss class; year filter on a vector source (instant), recolour loss in coral; 2050 only if modelled.
6. **Sea Level Rise proper:** replace the illustrative `+0.5…+5 m` levels with the team's scenario × year water levels (`build-flood.mjs --level X --id slr_<scenario>_<year>`), add a scenario selector and tie it to the slider; keep the "exposure, not prediction" caveat; consider a local, vertically-calibrated DEM for the delta.
7. **Other layers** (fisheries, salinity, intrusion, microplastics): connect via `mapLayer.endpoint`/`charts[].endpoint`; real charts replace placeholders automatically.
8. Package data as single-file PMTiles if hosting simplicity matters.
9. Accessibility/responsive polish pass; unit tests for `state.js`, `chart.js`.

### Data contract to give the team

| Layer | Deliver as | Required fields |
|---|---|---|
| Sea Level Rise | flood-depth raster tiles or polygons per year × scenario | year, scenario, depth |
| Coastal Erosion | shoreline lines + transect lines | year; rate and class on transects |
| Mangroves | polygons | year; gain/loss class |
| Fisheries, Salinity | raster tiles per time step | time step, value units |
| Intrusion, Microplastics | points | sample year, value, units |
| Every layer | one JSON file | scenarios, year range, units, source, citation |

---

## 10. Environment gotchas (Windows)

- Shell: PowerShell + Git Bash. Bash `/tmp` is **not** Node's `/tmp` (Node resolves it as `D:\tmp`); write helper scripts to the Claude scratchpad or the repo and run with `node <path>`. Large heredocs with quotes can break in Bash — prefer the file-write tool, then run the script.
- Background jobs: `find`/`du` over `data/` (thousands of files) are slow; avoid recursive scans of `D:\NDMA` (huge).
- Node 24.19, npm 11. Python: not usable. No GDAL/QGIS.
- The dev server on 5173 was started manually (`node serve.mjs`); `preview_start` reports the port in use — navigate to the URL instead.
- Claude in Chrome: extension must be installed and signed in with the same account (https://chromewebstore.google.com/detail/fcoeoabgfenejglbffodgkkbkcdhcgfn).
- The earlier build logs are `tools/build-terrain.log` and `tools/build-flood.log`.

---

## 11. Decisions and owner preferences (so you don't re-litigate)

- Layout fixed: left layers, central map, right analysis. Desktop is the primary target.
- Look: glass panels, dock for layers, sand accent, sentence case, no logo, no status bar/navbar, no north arrow, no map info card.
- 3D globe via **MapLibre globe projection** (no token, lightest to integrate); Mapbox/Cesium were considered and rejected.
- Satellite is the default basemap; clicking the globe flies to the study area; no auto-fly on load.
- The owner chose the **12.5 m rasters with a proper geoid correction**, and wants the DEM used for **Sea Level Rise and Coastal Erosion**. Coastal Erosion and Mangroves are the first real layers; the team supplies the data.
- Do not invent scenario numbers; the five exposure levels exist only to demonstrate the layer.

## 12. Open questions for the owner

1. Provenance/licence of the 12.5 m DEM (ALOS PALSAR?) and whether a vertically calibrated local DEM exists for the delta.
2. Scenario × year water levels for 2050 sea-level rise (and tide/surge allowance).
3. Whether the portal will be public/commercial (affects Esri and EOX terms).
4. Hosting plan for ~570 MB of generated tiles.
5. Whether the missing Copernicus 30 m tiles are still going to be supplied (would give an orthometric cross-check of the 12.5 m correction).
