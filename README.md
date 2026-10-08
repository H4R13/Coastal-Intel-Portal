# Coastal Hazards 2: the portal in React + Node

The same portal as the folder above, rebuilt with React (built by Vite) on the same Node server.
Same address (http://localhost:5173), same data API, same database, same caches. Only one of the two can run at a time.

## Run it

1. Stop the original portal if it is running (Ctrl+C in its terminal).
2. In this folder: `npm install` (first time only), then `npm start`.
3. Open http://localhost:5173.

`npm start` builds the app into `dist/` and starts the server. `npm run serve` starts the server without rebuilding.
`npm run dev` rebuilds whenever a file in `src/` changes (reload the page to see it).

## Where the data comes from

Nothing large is copied. `root.mjs` points the server at the folder above for `.env`, `data/`, `Other Data/`,
`.tilecache/` and `.amibcache/`. To make this folder stand alone later, move those into it (or set
`PORTAL_DATA_ROOT` to wherever they are); a `.env` or `data/` folder here is used automatically.

The data scripts work the same way: `npm run load:amib`, `npm run warm:amib`, `npm run load:ocean` and so on.

## What is where

| Folder | What it holds |
|---|---|
| `src/App.jsx`, `src/main.jsx` | the page and the start-up sequence |
| `src/components/` | map, sidebar, timeline, charts, terminal, assistant, intro, tour |
| `src/panels/` | the analysis panel and each layer's panel (hazards, ocean, plastics, SSP keys, figure cards) |
| `src/state.js` | the shared state (`useStore` in components) |
| `src/config/`, `src/amib/`, `src/ocean/`, `src/plastics/`, `src/map/` | layer settings, data access and map drawing: plain JavaScript, copied from the original |
| `src/styles.css` | the original stylesheet, unchanged apart from one line |
| `server.mjs`, `server/` | the Node server and data API, copied from the original |
| `public/` | files served as they are: tile-cache worker, logo, the team's plastics pages |

The map drawing (`src/map/renderers.js`) and the MapLibre map itself are not React: `src/components/MapView.jsx`
creates the map once and updates it whenever the state changes.

## Not carried over

- `tools/` (terrain and sea-level tile building) stays in the original folder; its output in `data/` is shared.
- Vercel hosting is not set up here (`api/index.mjs` is copied, but there is no `vercel.json` for the built app).
- `server/` and `public/plastics/` are copies: a later change to the originals has to be copied again.

## Hela, the assistant (chat under the map)

The robot button opens a chat with Hela. Every figure she gives comes from the portal's own database, with its source, its year and
whether it is measured or projected. Anything not in the database (earthquake records, sea-floor depth change, raw Google Earth Engine
exports) is reported as not loaded.

**How a question is answered** (`server/assistant/`):

1. Greetings and "who are you" are answered at once (`smallTalk` in `chat.mjs`).
2. Questions the data can answer directly get a ready-made answer written from the database (`answers.mjs`): mangroves, erosion,
   plastics and seafood, the ocean topics, the Indus Delta series, the portal's own status, and a small glossary. No language model is
   involved, so these are instant, repeatable, and work even when the model is unreachable.
3. When a question's words match no topic ("are the trees along the coast disappearing?"), the language model is asked only which
   topic it is about (`route` in `chat.mjs`), and step 2 is tried again. This takes about two seconds.
4. Otherwise the documents are searched for the question's main word; the model explains what was found, or Hela says the portal has
   nothing on that.

The model does not write figures. Measured on `hermes3:8b`, it moved numbers between scenarios and added effects that were not in the
data whenever it rewrote facts, so the sentences that carry figures are written by `answers.mjs`.

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

1. On the new machine install Node.js, PostgreSQL with PostGIS, and Ollama (Memurai / Redis is optional).
2. Copy or clone this project there and run `npm install`.
3. Restore the database from a backup made on the old machine:
   `pg_dump -Fc -f pakcoast.dump` (old) → `createdb pakcoast` then `pg_restore -d pakcoast pakcoast.dump` (new).
   The settings are read from `.env` (`PGHOST`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`).
4. Copy `.env` by hand (it is not in git). If the model runs on the same machine, remove the `OLLAMA_URL` line.
5. `ollama pull hermes3:8b`, then `npm start`.

The raw team data (`Other Data/`) is needed only to reload a dataset with the `load:*` scripts, not to run the portal.
