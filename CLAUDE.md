# Coastal Hazards 2: project notes for Claude

React (Vite) + Node portal for the coast of Pakistan: map layers (MapLibre), a year timeline, charts, and a chat assistant.
Same server, API and database as the original portal. Read README.md first; this file is what is not obvious from the code.

## Run it
- `npm install`, then `npm start` (builds into dist/ and serves http://localhost:5173). `npm run dev` rebuilds on change.
- Needs PostgreSQL + PostGIS and (optionally) Redis/Memurai; settings in `.env` (see `.env.example`).
- Data loaders: `npm run load:mangroves|erosion|ocean|amib|dmjm`. `npm run build` after any change in `src/`; the server serves dist/.
- Never commit `.env`, `Other Data/` (raw team data, ~65k files), `data/` or the caches. They are set up per machine.

## Layout that matters
- `src/map/renderers.js`: how each layer draws on the map; year-by-year saltwater/salinity maps are images drawn on demand by the server (`server/amib.mjs`).
- `src/components/Timeline.jsx`: advances the year on a fixed 700 ms timer.
- `src/components/Assistant.jsx`: the robot button and chat panel (`Chat`), plus the start-up warnings (`announce`).
- `server/api.mjs`: data API + routing; logs every non-tile request to `access_log`.
- `server/assistant/`: the assistant. `tools.mjs` (read-only data tools + `retrieve()` look-up-first for small models), `chat.mjs` (providers, loop, storage, limits).
- `server/diagnostics.mjs`: the health report (terminal and the assistant's `system_health` tool).

## The assistant: decisions already made (do not re-litigate)
- It is called **Hela** (`NAME` in `chat.mjs`; the UI text is in `Assistant.jsx`). "Hey Hela, ..." addresses it: the name is stripped from the question before the look-up. Greetings, thanks and "who are you" are answered at once by `smallTalk()` without calling the model.
- When `retrieve()` finds facts, the tool definitions are not sent to the local model (shorter prompt, one pass). The facts share `FACTS_CHARS` so they fit the model's context. Topic look-ups: `plastics_stations`, `ocean_summary`, `delta_series`, `mangrove_area`, `erosion_summary`; anything unrecognised falls back to a text search on the question's most specific word.
- hermes3:8b cannot be trusted to rewrite figures: it moved numbers between flow scenarios and invented effects. So `delta_series` returns ready `statements` (whole sentences, each figure with its scenario), a `gist` and a `driver`, and `factsFirst()` in `chat.mjs` shows them as they are with no model call (instant). Other tools still go through the model; move a tool to statements when its answers keep coming out wrong. Do not put regex backslashes through shell heredocs when patching these files (they were silently stripped once); use the Edit tool.
- Follow-ups: `retrieve(question, max, earlier)` reuses the earlier questions' topic when the new one names none ("why is that?", "make it shorter").
- The office PC has no graphics card (Intel UHD only): hermes3:8b writes about 8.5 tokens a second whatever the thread count; more threads only speed up reading the prompt (`OLLAMA_THREADS`).
- It is NOT a trained/fine-tuned model. A trained model blurs exact numbers; the assistant looks facts up in the database and cites them. Feedback (👍/👎) is stored in `assistant_feedback` and used to improve prompts/tools, not weights.
- Default provider is a local open model through Ollama (no API key, no per-question cost). Claude via `ANTHROPIC_API_KEY` is an optional upgrade.
- Small local models are unreliable at choosing tools, so `retrieve()` runs the matching tools from the question's keywords first and the model only explains the facts.
- Not in the database, so it must say "not loaded": earthquake/seismic records, continental-shelf depth change, raw Google Earth Engine exports. Adding them is future work (USGS catalogue, bathymetry, GEE exports).
- General science (e.g. plankton and oxygen) needs a small cited reference library; not built yet.

## Machines
- Laptop: 7.8 GB RAM, 2 GB GPU: only ~1.7B-4B models, slow. Has Ollama with qwen3:1.7b (qwen3:4b was downloading).
- Office PC: 16 GB RAM, i7 H-series: planned to run `hermes3:8b` via Ollama; the laptop portal points at it with `OLLAMA_URL`. Open port 11434 to the laptop's IP only (Ollama has no password).
- The server at 76.13.x.x was a guess from a mistyped IP and is NOT confirmed to be the senior's VPS. Do not probe it further; ask the user for the real hostname.

## Open work, in order
1. Test hermes3:3b / qwen3:4b / hermes3:8b on the same five questions (mangrove trend since 1990, are layers working, why a year map failed to load, plastics at Karachi stations, earthquakes and the shelf) and keep the best.
2. Timeline "rack": preload a window of ~6-10 years as hidden layers, advance only when the next year is ready, retry failures, mark missing years. Playback currently ignores whether the year's image has arrived (Timeline.jsx) and `frame()` in renderers.js turns failed fetches into silent nulls. Pre-rendering frames to static files would remove the server's drawing-pool bottleneck.
3. Add earthquake / bathymetry / Earth Engine datasets and the science reference library.
4. `public/plastics/*.html` still duplicates `PlasticsPanel.jsx`; finish the move to React or keep it deliberately.

## Working agreements
- Prefer small, verified changes; run `npx vite build` after UI edits and test server code against the real database.
- Do not scan or probe third-party hosts. Do not put secrets in files that get committed.
