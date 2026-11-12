# PCOP, Pakistan Coastal Observation & Projection: the coastal intelligence portal for Pakistan

A React (Vite) + Node portal for the coast of Pakistan: map layers (MapLibre), a year timeline, charts, a standby showcase,
and Hela, a chat and voice assistant. Data lives in PostgreSQL + PostGIS (Redis/Memurai optional).
`CLAUDE.md` holds the working notes and decisions already made; this file is the overview.

## Run it

1. Install Node.js, PostgreSQL 18 with PostGIS and (optionally) Redis/Memurai and Ollama.
2. Copy `.env.example` to `.env` and fill in the database settings.
3. `npm install`, then `npm start` (builds into `dist/` and serves http://localhost:5173).

Other scripts: `npm run serve` (no rebuild), `npm run dev` (starts PostgreSQL if it is not running, then rebuilds on every change in `src/`),
`npm run db:start|db:stop|db:status` (PostgreSQL under your own account, no admin rights; `.pg/pg_ctl.log` is its start-up log).
The API answers 503 "Database unavailable" while the database is down.

Never commit `.env`, `Other Data/` (raw team data), `data/` or the caches: they are set up per machine.

## Data

| Command | Loads |
|---|---|
| `npm run load:mangroves` (`-- --gain-loss` for the gain/loss chart only) | mangrove area and year layers |
| `npm run load:erosion` | coastal erosion |
| `npm run load:amib` / `load:dmjm` | the saltwater / Indus Delta packages |
| `npm run load:ocean` | the ocean monitoring package (also into `ocean_doc` for Hela) |
| `npm run load:nutrients` | Nutrients & Plankton (Indus Delta Observatory) into `nutrients_doc` |
| `npm run load:ndma -- "<package folder>"` | the NDMA coastal eutrophication package (DMJM): satellite chlorophyll and sea temperature 1998-2025, seasonal trends, 2050 model scenarios, the January 2025 relative-concern snapshot, as pictures and grids in `data/ndma/` (no database) |
| `npm run load:insitu` | field records from open databases (plankton species, measured nutrients, oxygen, salinity, temperature, chlorophyll) from the screened `Field_Data_Intake.csv` into `data/ndma/insitu.json` |
| `npm run fetch:seabass` | downloads NASA SeaBASS files for the coast (needs `EARTHDATA_TOKEN` in `.env`; raw files only, screened before loading) |
| `npm run load:inja` | the INJA erosion/accretion package (Landsat waterline, Jiwani to Sir Creek) into `data/inja/` |
| `npm run warm:amib`, `warm:mangroves` | pre-draw year pictures so the server never draws during the showcase |
| `npm run update:data` | stage external updates (USGS earthquakes, PSMSL Karachi tide); a person approves with `-- --approve=N` |
| `npm run watch:papers` | records new papers on 8 coastal topics and prints a 30-day digest |

The team's data is never fetched or overwritten by the automatic updates. The ocean monitoring package is licensed: do not copy,
share or change its numbers or texts, and keep it out of git.

## What is in the portal

- **Map layers**: coastal hazards (terrain exposure, sea level, saltwater intrusion, salinity, land lost, the coast eroding and
  building out), mangroves, erosion, plastics, Ocean and Fisheries (the ocean monitoring package), and Nutrients & Plankton.
- **Nutrients & Plankton** has its own tabs and controls:
  - *Algae and sea heat, 1998-2025*: monthly and yearly satellite chlorophyll and sea-surface temperature; click a pixel for its record.
  - *Trends and 2050 scenarios*: seasonal trends 1998-2025, three-model scenarios (SSP2-4.5 / SSP5-8.5, 20-year windows), the 2050
    change, and the January 2025 relative-concern snapshot. Chosen with buttons, never animated; projections are not forecasts.
  - *Seen and measured in the water*: plankton species records (presence, not amounts) and measured readings from ships, floats and
    laboratories (OBIS, GBIF, Argo, GLODAP, World Ocean Database, NASA SeaBASS, NCEI, PANGAEA), split by depth (0-10 m, 10-200 m,
    below 200 m). Units are kept as the source gives them; held records (unverified calibration, duplicates, conflicting licences)
    are not drawn.
  - The Indus Delta Observatory's five monitoring points (2020-2026) and the World Ocean Atlas nutrient averages.
  Everything satellite-based is "satellite-derived, not field-calibrated"; gaps stay gaps and are never filled.
- **Borders**: Pakistan as officially drawn, Jammu and Kashmir included, bold black (`public/boundaries/pakistan.geojson`, built by
  `node server/build-boundaries.mjs <file.shp>`). The coast is a hairline when zoomed in under 100 km.
- **Showcase** (standby mode): plays every layer by itself in a loop; `?showcase` or the turning button above the tour button.
- **Terminal**: ↑/↓ recall earlier commands; `hide <layer>` / `show <layer>|all` take a layer out of the dock and back.
- **Tour and intro**, timeline (one year per 700 ms), charts.

## What is where

| Folder | What it holds |
|---|---|
| `src/App.jsx`, `src/main.jsx` | the page and the start-up sequence |
| `src/components/` | map, sidebar, timeline, charts, terminal, assistant, showcase, intro, tour |
| `src/panels/` | the analysis panel and each layer's panel |
| `src/oceanMonitoring/`, `src/nutrients/` | the Ocean/Fisheries and Nutrients & Plankton screens and controllers |
| `src/map/renderers.js` | how each layer is drawn on the map |
| `src/state.js` | the shared state (`useStore`) |
| `server.mjs`, `server/` | the Node server, data API, loaders, external updates |
| `server/assistant/` | Hela (see below) |
| `public/` | files served as they are: boundaries, brand, media, the team's plastics pages |

The MapLibre map itself is not React: `MapView.jsx` creates it once and updates it whenever the state changes.

## Hela, the assistant (chat under the map)

The robot button opens a chat with Hela. Every figure she gives comes from the portal's own database, with its source, its year and
whether it is measured or projected. Anything not in the database (earthquake records, sea-floor depth change, raw Google Earth Engine
exports) is reported as not loaded.

**How a question is answered** (`server/assistant/`):

1. Greetings and "who are you" are answered at once (`smallTalk` in `chat.mjs`).
2. Questions the data can answer directly get a ready-made answer written from the database (`answers.mjs`): mangroves, erosion,
   plastics and seafood, the ocean topics, the Indus Delta series, the field data (measured nutrients, laboratory and sensor
   chlorophyll, plankton records, oxygen by depth: `field()`, read from `data/ndma/insitu.json`), the portal's own status, and a small glossary. No language model is
   involved, so these are instant, repeatable, and work even when the model is unreachable.
3. When a question's words match no topic ("are the trees along the coast disappearing?"), the language model is asked only which
   topic it is about (`route` in `chat.mjs`), and step 2 is tried again. This takes about two seconds.
4. Otherwise the documents are searched for the question's main word, and Hela says where it turns up, or that the portal has nothing
   on that.

Answers are short by default: the sentence that answers, and a second one for comparisons and lists. Asking "in detail" or "tell me
more" adds the context; "short" gives the answer alone. She reads English, Roman Urdu, and the main subject words in Urdu script.

Beyond the database, with the model boxed in so it never writes a figure:

- **Her views** (`opinion.mjs`): asked what she thinks, the figures come first, then "My view (not from the data):".
- **Investigations** (`research.mjs`): hypotheses from the model, checked against real papers from OpenAlex (`RESEARCH_ONLINE=0` turns it off).
  Only papers naming this region count; the verdict is counted by code and abstracts are not proof.
- **Date, news and free chat** (`converse.mjs`, `news.mjs`): headlines are listed verbatim with outlet, date and link.
- **External figures** (USGS earthquakes, PSMSL Karachi tide) are labelled as not the team's.

The local model writes none of the figures in the answers. Measured on `hermes3:8b`, it moved numbers between scenarios and added effects that
were not in the data whenever it rewrote facts, so every sentence is written by `answers.mjs` and the model only sorts questions.

**Talking to her (call mode).** The phone button in the chat starts a call: she listens, answers aloud, and listens again until
you press End; tapping "Speaking…" cuts in. Hearing you is the browser's own speech recognition (Edge or Chrome, needs the
internet, English or Urdu by the language button). Her voice is ElevenLabs when `ELEVENLABS_API_KEY` is in `.env`
(`ELEVENLABS_VOICE`, `ELEVENLABS_MODEL` optional) and the browser's built-in voice otherwise. The key never reaches the browser, and
the server only speaks answers Hela has given (`server/assistant/voice.mjs`). Spoken answers are the short form, with units in words.

**The model.** No API key is needed: an open model runs through Ollama (https://ollama.com), on this machine or on another one named
by `OLLAMA_URL` (`OLLAMA_MODEL`, default the best one installed; `OLLAMA_THREADS` for the processor threads it may use). With
`ANTHROPIC_API_KEY` in `.env` Claude is used instead and calls the tools in `tools.mjs` itself (`ASSISTANT_PROVIDER=ollama|anthropic`
forces either). Questions are limited to 8 per minute per visitor (`ASSISTANT_PER_MINUTE`). Chats and ratings are stored in
`assistant_chat` / `assistant_feedback`.

**Checking and teaching her.**

- `npm run hela:eval` asks Hela the questions in `eval-cases.mjs` against the running portal and reports how many she got right (each
  case lists the figures that must appear; a model-written answer also fails on any figure that is not in the looked-up facts).
  `-- --direct` checks only the ready-made answers, with no server and no model; `-- --only=id,id` runs some cases.
- `npm run hela:review` lists the answers people marked unhelpful and the questions that had to go to the model: the ones worth a
  sentence in `answers.mjs`. Add the sentence, add a case to `eval-cases.mjs`, run the evaluation.
- Words the look-up should understand (spelling slips, Roman Urdu question words) live in `understand.mjs`; worked examples for the
  topic sorter are `ROUTE_EXAMPLES` in `chat.mjs`.

**Moving Hela to another computer.** She is this project plus the database; the model is a stock download.

The quick way (the owner's helper scripts, kept on the working machine and not in git): `pack-for-pc.ps1 -To E:\` copies everything (project, `.env`, data, caches) and a fresh database backup to a drive;
on the new machine install Node.js, PostgreSQL 18 with PostGIS, Ollama (and Memurai if wanted), then run `setup-pc.ps1` in the copied
folder (`powershell -ExecutionPolicy Bypass -File setup-pc.ps1`). It restores the database, fits `.env` to that machine and builds.
By hand:

1. On the new machine install Node.js, PostgreSQL with PostGIS, and Ollama (Memurai / Redis is optional).
2. Copy or clone this project there and run `npm install`.
3. Restore the database from a backup made on the old machine:
   `pg_dump -Fc -f pakcoast.dump` (old) → `createdb pakcoast` then `pg_restore -d pakcoast pakcoast.dump` (new).
   The settings are read from `.env` (`PGHOST`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`).
4. Copy `.env` by hand (it is not in git). If the model runs on the same machine, remove the `OLLAMA_URL` line.
5. `ollama pull hermes3:8b`, then `npm start`.

The raw team data (`Other Data/`) is needed only to reload a dataset with the `load:*` scripts, not to run the portal. Copy `data/`
too (or rerun `load:ndma`, `load:insitu`, `load:inja`): the Nutrients & Plankton pictures, grids and field data live there.
