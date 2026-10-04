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

- Run `npm install` once for the server's database and cache clients (see §5.6); PostgreSQL and Memurai run as Windows services.
- No build step for the app: plain ES modules, MapLibre GL JS **5.6.0** from unpkg CDN, Manrope from Google Fonts.
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

### 5.6 Database and cache (added 2026-10-04)

PostgreSQL 18 + PostGIS 3.6 (`X:\PostgressSQL`, service `postgresql-x64-18`, port 5432, database `pakcoast`) holds layer data. Memurai, a Redis-compatible server for Windows (`X:\Memurai`, port 6379, capped at 512 MB, `allkeys-lru`), caches API answers. Connection settings are in `.env` (gitignored).

- `npm install` at the repo root installs `pg`, `ioredis`, `shapefile`. Without it `serve.mjs` logs "Data API off" and still serves the static site.
- `server/schema.sql` tables: `mangrove_extent` (scenario, year, polygon pieces in EPSG:3857), `mangrove_area` (scenario, year, km² as delivered), `layer_info`.
- `server/load-mangroves.mjs` loads `Other Data/AMSK/Mangrove year layers/Mangrove year layers` (31 mapped years, 9 projected layers, 2 CSVs), replaces previous contents in one transaction and clears the layer's Redis keys. Takes ~11 min (the yearly files are single dissolved multipolygons). Area of the loaded shapes matches the team's CSV to 0.1 km² for the five year/scenario pairs checked.
- `server/api.mjs` routes: `/api/health`, `/api/layers/mangroves` (manifest), `/api/layers/mangroves/series` (chart data), `/api/tiles/mangroves/<scenario>/<year>/<z>/<x>/<y>.mvt` (ST_AsMVT). All cached in Redis under `pakcoast:mangroves:*`; header `X-Cache: hit|miss`. If Redis is down the API answers from PostgreSQL.
- Frontend: `mangroves` uses renderer type `yeartiles` (`js/map/renderers.js`) with `js/map/manifest.js`. The map shows the newest tile set at or before `state.year` (projected sets use `state.scenario`, chosen in the Forecast tab) and the legend states which year is drawn; shapes are never interpolated. The area chart and the metadata block read the API. **API and cache tested; the map layer, legend line and scenario selector are unverified in a browser.**
- `serve.mjs` now serves only `index.html`, `sw.js`, `css/`, `js/`, `data/`; everything else (including `.env`, `server/`, `Other Data/`) returns 404.
- **Erosion (same day):** `server/load-erosion.mjs` loads `Other Data/AMSK/Erosion with transition/Erosion 01` into `erosion_area` (kind, start_yr, end_yr, pieces in EPSG:3857) in ~6 s: the four `Cleaned` period files as `observed`, and the yearly 2026–2050 steps of `Erosion_Projected_2050.shp` as `projected` (the 2025/2035/2045 files are subsets of it). Routes: `/api/layers/erosion`, `/api/layers/erosion/series` (cumulative km², computed from the polygons), `/api/layers/erosion/periods`, `/api/tiles/erosion/<z>/<x>/<y>.mvt`. Frontend renderer type `periodtiles`: one tile set, filtered on the client by `start_yr < state.year`, projected periods fainter. The layer was redefined from shorelines/transects to eroded-area polygons; its third chart ("Affected coastline length") is still a placeholder.
- **Owner decision 2026-10-04:** integrate team data as delivered; the projected mangrove and erosion layers come from a Cellular Automata–Markov model and are labelled so. Mangrove scenario labels are the team's ("Good (SSP1-2.6)" etc.). Earlier open questions to the data author are dropped.
- Open: indicators for mangroves and erosion are still "—"; cumulative erosion adds period areas and may double-count land eroded in more than one period.
- **Ocean package (AMHK), technical view built 2026-10-04.** Source: `Other Data/AMHKm/ndma-ocean-portal-data-main` (141 layers described by `catalog.json` + `README.md`; **its LICENSE forbids copying or sharing, so `Other Data/AMHK*` is gitignored and must not be pushed**).
  - `server/load-ocean.mjs` (2 s) stores everything in `ocean_doc` under API keys: `catalog`, `raster/<id>[/<year>]` (GeoTIFFs decoded to plain grids, 253 of them), `data/<id>` (45 chart/table files), `overlay/<id>` (significance dots), `vector/<id>`, `chart_style`, `findings`. Served by `GET /api/ocean/<key>`, cached in Redis.
  - Owner chose an **eighth dock button, "Ocean"** (topics 4, 5, 6, 7, 8, 13); **Fisheries** shows topics 9–11 (charts/tables only). Both use `layer.ocean = { steps }` and `js/ocean/oceanPanel.js`: topic select, map-layer select (main results first), Low/Medium/High scenario chips for outlook layers, badges, legend, notes, then the topic's charts and tables. State: `oceanView[layerId] = { step, variable }`, `oceanScenario`.
  - Map: renderer type `ocean` draws one grid at a time on a canvas (`js/ocean/colormaps.js`, catalog colour scale and vmin/vmax, cells kept crisp, rows placed by Mercator latitude) as a MapLibre image source, plus the EEZ outline and the 95 % significance dots. Year-by-year layers follow the timeline.
  - **Not done yet:** only `line_trend` charts are drawn (as plain lines, without the dashed trend line and trend text); the other 12 chart types are shown as their data tables. `chart_style.json` is stored but not applied. The **findings (decision-maker) view** in `findings/` is stored but not built. Sub-region outlines are not drawn. Logic was exercised in Node against the live API (all 93 map layers resolve to a grid, all 45 data files load); **nothing was checked in a browser**.
- **Later the same day (owner requests):** ocean grids and significance dots are clipped to the EEZ (`drawGrid(grid, layer, boundary)`); each ocean topic opens on its year-by-year layer when it has one (pH, aragonite, heatwave days, exposure) so the map moves with the timeline; fixed maps say so in the panel.
- **Smoothed display (owner request, overrides the ocean README's "no resampling"):** `drawGrid` now blends each pixel from the four nearest cell centres that have data (about 1 km per pixel), so 25 km and 1° cells no longer show as blocks and values reach the coast; class layers are never blended. Ocean and AMIB rasters use linear map resampling, nearest for class layers. The ocean panel states that the display is smoothed and the data grid is coarser.
- **Coast coverage (owner request):** before drawing, `fillGaps` gives every cell without data the mean of its neighbours, ring by ring, so the layer reaches the shore everywhere (the bay east of Sonmiani used to be an empty block). The clip is no longer the raw EEZ polygon but `seaMask`: that polygon shrunk and regrown by ~4 km, which drops the Indus Delta creeks (the EEZ outline runs up each one) and keeps the open coast; the significance dots use the same mask. The mask is built once per grid size (~2 s on first draw), then a frame takes ~140 ms at 768 px width. The EEZ outline is drawn faint for the same reason.
- **Ocean charts and tables (`js/ocean/oceanFigures.js`, owner request):** the list of collapsed rows is gone. A topic now shows *Key figures* (`big_number`), *Charts* (every year series as timeline-following lines with region / product / measure pickers; `bar`, `grouped_bar`, `horizontal_bar`, `dot_plot` as horizontal bars or dots with the package's reference lines; `strip_plot` as dot rows) and *Data tables* (tiles that open the table full screen; few-row, many-column tables are turned on their side). Each chart card has a Table/Chart switch and the pop-out; pickers work inside the pop-out too. Not done: stacked bars/areas are drawn as lines, monthly oxygen is shown as yearly means only, no model-spread bands, trend labels or change-point marks, and the package's scenario colours are replaced by the portal's (they are made for a white page).
- **Fisheries on the map (`js/ocean/national.js`, renderer `national`, owner request):** topics 9–11 are national numbers with no grid, so the EEZ polygon is tinted one colour for the value of the timeline year (blue → green → purple → red) and a balloon marker states it. Topic 9: `over-exploited_pct + collapsed_pct` from `ssp_catch` per year (this sum is the package's own indicator for 2023, 26.35 %), scale 0–40 %; topic 10: `molluscs_pct` from `shell_share_series`, scale 0–4 %; topic 11: the PI row of `national_index`, one fixed value, scale 0–1. The scale tops (40, 4) are our choice, not the package's. The balloon is anchored in the sea south-west of Karachi (`BALLOON_AT`); switching the layer on moves the map to the zone if that spot is out of view.
- **Fisheries trend forecast (owner request, NOT from the data package):** measured data ends in 2023. For 2024–2030 topics 9 and 10 use a random walk with drift fitted to 1990–2023 (`driftForecast` in `js/ocean/national.js`) with an 80 % prediction interval; the balloon gets a dashed border, "≈" and the likely range, the legend says "trend forecast, not measured", and a chart card at the top of the topic shows measured + forecast + range, badged "statistical extrapolation". Past 2030 the 2030 forecast is kept. The card states a hindcast: forecasting 2017–2023 from earlier years was off by 9.7 percentage points on average for the stock index, so the forecast is weak; the 2030 range is 10–53 %. A real forecast needs a stock assessment (e.g. CMSY) from the data authors.
- **Owner round of 2026-10-04 (all verified in headless Chrome):**
  - *Plastics layer* (was Microplastics; id still `microplastics`): `server/load-dmjm.mjs` (`npm run load:dmjm`) puts `Other Data/DMJM`'s survey CSV and `projection_2050.json` into `dmjm_doc`, served at `api/dmjm/<key>`. Map renderer `plastics`: one dot per survey site, coloured/sized by items per 100 m for the timeline year (2025 survey mean, 2026 baseline, then the scenario chosen in the panel; empty before 2025), click for a balloon. Panel `js/plastics/plasticsPanel.js` has three topics: surveys + scenarios, the debris index and the biomagnification model. The last two are the formulas of the team's two simulation pages re-implemented in `js/plastics/plastics.js`; they take no measured data and are not drawn on the map. The survey CSV is a demo dataset without sources; every card is badged accordingly.
  - *Mangroves on the map* are now change pictures, not plain extent: `server/mangrove-change.mjs` rasterises the delivered shapes of the timeline year and of the first mapped year (1988) and colours each pixel yellow (in both), blue (gained), red (lost). Two frames (east 4096 px, west 6144 px), served at `api/mangroves/change/<frame>/<scenario>/<year>.png`, cached in Redis. `npm run warm:mangroves` draws all 80 once (74 s); `load:mangroves` clears them, so run it again after a reload. The owner asked for "yellow, blue to red" raster colours; reading that as kept/gained/lost is our interpretation. The old `yeartiles` renderer and tile route remain but are unused.
  - *Fisheries* draws only the balloon (no fill over the sea zone), so it never hides the Ocean layer.
  - *Dock icons fly the map* to the layer (`focus` in `js/config/layers.js`; for intrusion/salinity/sea level the extent of the map layer chosen in the panel). The toggles still decide what is drawn.
  - *Intrusion/salinity topics* are now offered in the order of `layer.amib.products`; before, Salinity opened on the ocean pH product because of catalog order, which is why it looked unconnected.
  - *Legend* shows real colours: renderers have an optional `legend(layer)` returning classes or a ramp with min/max/unit.
  - *Timeline*: hovering the play button shows two bubbles, 2× speed and loop (`state.speed`, `state.loop`).
  - *Panel look*: the analysis panel sits on a much darker frosted pane with brighter text tokens (`--text`, `--text-2`, `--muted`, `--faint`), a lit edge and accent ticks on section titles. This supersedes the earlier "not a sci-fi console" note in §"Visual language": the owner asked for a more futuristic look.
- **Vercel deployment (prepared 2026-10-04, hosted database not yet created):** Vercel serves the static portal and runs the data API as one function (`api/index.mjs`, routed by `vercel.json`; same routes as `server/api.mjs`). It needs two environment variables in the Vercel project: `DATABASE_URL` (hosted PostgreSQL with PostGIS, e.g. Neon) and `REDIS_URL` (e.g. Upstash). `npm run push:cloud` copies this PC's database to `CLOUD_DATABASE_URL` and the mangrove pictures to `CLOUD_REDIS_URL` (both in `.env`); tested against a scratch database (66 s). Not available on Vercel: the intrusion / salinity / sea-level map images (they are read from the 7 GB of rasters on disk; their charts work), and the tile disk cache. `ocean_doc` is copied only with `--with-ocean`: the AMHK licence forbids publishing without written permission, and a public site serves the data to anyone.
- **Live charts + pop-out (`js/components/timeChart.js`):** every line chart over years (mangroves, erosion, ocean `line_trend`) is drawn bright up to `state.year` and faint after it, with a cursor, a dot per series and a value read-out; bar charts whose points carry `from` fade periods not begun. A corner button on every chart and ocean table opens it in a full-screen `<dialog>` closed by ✕, Esc or a click outside; the copy keeps following the timeline. Panels for connected layers have a "Show on the map" button; the timeline note says whether anything is following it. App files are served `Cache-Control: no-cache`.
- **Browser verification now works:** headless Chrome via `puppeteer-core` with `--enable-unsafe-swiftshader --use-angle=swiftshader` renders the map. With it, on 2026-10-04: mangrove tiles swap per year (1990→2050, scenario after 2030), erosion periods appear as the year advances, the ocean grid redraws per year and is clipped, charts follow the year, the pop-out opens at 1200×767 and closes; no page errors.
- **AMIB package integrated 2026-10-04 (maps + charts).** `server/load-amib.mjs` (2 s) registers the catalog in `amib_doc`: 520 map layers (185 year by year, 13,791 images), 5 vectors, chart series for 10 products; the rasters stay on disk (`AMIB_DIR`, default `Other Data/AMIB`, gitignored). `GET /api/amib/image/<id>/<step>` (`server/amib.mjs`) reads the layer's pre-coloured `_rgba.tif` (WebP-compressed COG, decoded per tile with `sharp` through a custom geotiff.js decoder), limits it to 2048 px, re-spaces rows by Mercator latitude and returns a PNG, cached in Redis (0.4–0.8 s first time, then cached). `GET /api/amib/<key>` serves `catalog`, `series/<product>`, `vector/<id>`.
  - Portal layers opt in with `layer.amib` (`js/amib/amibData.js`): Sea Level Rise ← D; Saltwater Intrusion ← C, B, GH; Salinity Index ← A, G, H; Mangroves ← F layers named "mangrove" and Coastal Erosion ← the other F layers, both `optional` (nothing drawn until chosen, beside the shapefile layers). `js/amib/amibPanel.js`: topic / group / layer selects (year-by-year group first), label badge (OBSERVED, MODELLED, PROXY, UNCERTAIN), legend from the catalog, then one chart per indicator in `timeseries.json`. Renderer `amib` runs alongside a layer's own renderer (`renderersOf`), swapping the image as the timeline moves. State: `amibView[layerId]`.
  - **Scenario charts (owner rule):** a chart always shows every scenario together. `timeChart` lists every series in its read-out from the start, draws the not-yet-reached part dashed at 42 % opacity, and uses fixed colours: low/good blue, medium/normal orange, high/worst red, observed near-white.
  - **Not done:** vertical cross-sections (product E, 60 layers) and the 5 vector layers are not shown; chart uncertainty bands (p17–p83) are not drawn; month-of-year climatology layers show only their first month; legends show first/last value only. Verified in headless Chrome: images load and line up (river salt follows the Indus channel), image changes with the year, no page errors.
- Original description of the package: `Other Data/AMIB/` (saltwater intrusion and salinity: `catalog.json` with 586 layers, 185 of them time series, ~7 GB of GeoTIFFs each with a pre-coloured `_rgba.tif`, legends and labels in the catalog; products A salty soils, B river salt, C fresh groundwater, D sea-level rise + subsidence, GH salt-water boundary, F mangroves + shoreline change (raster), G fresh-water signs at sea, H future ocean, E/sections vertical cross-sections). Too large for PostgreSQL: plan is catalog in the database, images converted from the `_rgba.tif` files on request and cached.

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
   **Disk cache (2026-10-04):** `serve.mjs` has `GET /tile-cache?u=<tile URL>`, which downloads a tile once into `.tilecache/` (gitignored) and serves it from disk afterwards; styles/tilejson and latest SST refresh once a day, and a stale copy is served when offline. Only the tile hosts listed in `serve.mjs` are fetched. `sw.js` sends its cache misses there and falls back to direct fetches on hosts without the route. Server side tested with all seven providers; the `sw.js` routing is **unverified in a browser**. `PORT` env var overrides 5173.
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
