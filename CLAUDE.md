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
- `server/assistant/`: Hela, the assistant. `chat.mjs` (the order of answering, small talk, the topic router, providers, storage, limits), `answers.mjs` (ready-made answers written from the database), `understand.mjs` (reading the question: spelling slips, Roman Urdu, follow-ups), `tools.mjs` (read-only data tools for Claude and for the text-search fallback), `eval.mjs` + `eval-cases.mjs` (the scored test), `review.mjs` (what to teach next).
- `server/diagnostics.mjs`: the health report (terminal and the assistant's `system_health` tool).

## The assistant: decisions already made (do not re-litigate)
- It is called **Hela** (`NAME` in `chat.mjs`; the UI text is in `Assistant.jsx`). "Hey Hela, ..." addresses it: the name is stripped from the question first.
- **The local model does not write figures.** Measured on hermes3:8b (2026-10-07/08): given correct facts in three different forms it still moved numbers between flow scenarios, blended two statements into one, and listed effects (livestock, fish catch) that are not in the data. So the order in `chat()` is: small talk → `answerDirect()` in `answers.mjs` (sentences written from the database, shown as they are, no model call) → `route()` (the model only names the topic of a question whose words matched nothing, in a fixed JSON format, about 2 s) and `answerDirect()` again → text search, where the model explains the hits or "nothing on that" is said without it.
- To teach Hela a new kind of question: add the sentence to the topic's function in `answers.mjs`, add a case to `eval-cases.mjs`, run `npm run hela:eval -- --direct` (no server, seconds) and then the full `npm run hela:eval` against the running portal. `npm run hela:review` lists thumbs-down answers and the questions that still went to the model.
- Each topic function returns `{ say, also }`: `say` answers what was asked (most direct first), `also` is context shown only while the answer is brief. Where the data runs out, the sentence says so (a place with no station, a year before the record, causes that are not held).
- **Two mangrove datasets disagree** and Hela says so: the mangrove layer's table (`mangrove_area`: 406 km² in 1988 → 848 km² in 2025, rising) and the saltwater package's GMW v3 extents by zone (`amib:series/F`: zones total 1,119 km² in 1996 → 864 km² in 2020, falling). Nobody has reconciled them; do not pick one silently.
- Follow-ups: `subject()` in `understand.mjs` carries the earlier questions' topic when the new one names none and points back ("why is that?", "and by 2050?", "make it shorter"); a new unrelated question does not inherit it.
- Never put regex backslashes through a shell heredoc or `node -e` when patching these files: they were silently stripped several times (`\b` became a backspace character). Use the Edit tool, or write a script file with the Write tool.
- The office PC has no graphics card (Intel UHD only): hermes3:8b writes about 8.5 tokens a second whatever the thread count; more threads only speed up reading the prompt (`OLLAMA_THREADS`). A model-written answer takes 20-80 s, which is the other reason answers come from `answers.mjs`.
- It is NOT a trained/fine-tuned model. Feedback (👍/👎) is stored in `assistant_feedback` and used to improve the sentences and the look-ups, not weights.
- Default provider is a local open model through Ollama (no API key, no per-question cost). Claude via `ANTHROPIC_API_KEY` is an optional upgrade and skips `answers.mjs` (it calls the tools itself).
- Not in the database, so it must say "not loaded": earthquake/seismic records, continental-shelf depth change, raw Google Earth Engine exports. Adding them is future work (USGS catalogue, bathymetry, GEE exports).
- General science (e.g. plankton and oxygen) needs a small cited reference library; not built yet. The glossary in `answers.mjs` defines only the portal's own terms (psu, MAF, EEZ, SSP, aragonite ...).

## Machines
- Laptop: 7.8 GB RAM, 2 GB GPU: runs the portal, PostgreSQL and the data. Only ~1.7B-4B models fit, slowly.
- Office PC: 16 GB RAM, i7 H-series, Intel UHD graphics: runs `hermes3:8b` through Ollama at 172.18.59.80:11434 (address from the router, can change); the laptop's `.env` points at it with `OLLAMA_URL`. Nothing of the project lives there.
- Database backups made by hand are in `X:\Coastal-Intel-Backups\` (`pg_dump -Fc`). README "Moving Hela to another computer" has the restore steps.
- The server at 76.13.x.x was a guess from a mistyped IP and is NOT confirmed to be the senior's VPS. Do not probe it further; ask the user for the real hostname.

## Open work, in order
1. Timeline "rack": preload a window of ~6-10 years as hidden layers, advance only when the next year is ready, retry failures, mark missing years. Playback currently ignores whether the year's image has arrived (Timeline.jsx) and `frame()` in renderers.js turns failed fetches into silent nulls. Pre-rendering frames to static files would remove the server's drawing-pool bottleneck.
2. Reconcile the two mangrove datasets (see above) with the team: which one the mangrove layer should show.
3. Add earthquake / bathymetry / Earth Engine datasets and the science reference library.
4. Hela: stream model-written answers (only the text-search fallback still waits 20-60 s); compare `qwen3:4b` as the router model (it only has to sort questions now, so a smaller, faster model may do).
5. `public/plastics/*.html` still duplicates `PlasticsPanel.jsx`; finish the move to React or keep it deliberately.

## Working agreements
- Prefer small, verified changes; run `npx vite build` after UI edits and test server code against the real database.
- Do not scan or probe third-party hosts. Do not put secrets in files that get committed.
