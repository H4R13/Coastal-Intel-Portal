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

## The assistant (chat under the map)

The robot button opens a chat that answers from the portal's own database, not from the model's memory. The server first looks up
the facts the question needs (mangrove area, erosion, ocean / saltwater-intrusion / plastics documents, the health report, the API
access log; `server/assistant/tools.mjs`), then the model explains them and must say where each figure came from. Anything not in the
database (earthquake records, shelf depth change, raw Google Earth Engine exports) is reported as not loaded.

**No API key needed.** By default it runs an open model on this machine through Ollama (https://ollama.com): install Ollama, then
`ollama pull qwen3:4b` and restart the portal. Nothing leaves your computer and there is no per-question cost. Bigger models answer
better (`OLLAMA_MODEL=qwen3:8b` needs about 8 GB free RAM; a server or VPS with more RAM and no other load is ideal). `OLLAMA_URL` points
it at Ollama on another machine. Optionally, with `ANTHROPIC_API_KEY` in .env it uses Claude instead (stronger, paid per question;
force either with `ASSISTANT_PROVIDER=ollama|anthropic`). Questions are limited to 8 per minute per visitor. Chats and ratings are
stored in `assistant_chat` / `assistant_feedback` (queries in `server/schema.sql`).
