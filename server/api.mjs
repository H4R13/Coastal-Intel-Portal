/**
 * Data API, mounted by serve.mjs under /api/. Every answer is cached in Redis until its layer is reloaded (package map
 * images are cached on disk instead).
 *   GET /api/health
 *   GET /api/diagnostics                services, layer data, cache and machine load (server/diagnostics.mjs)
 *   GET /api/layers/<layer>             which years, periods and scenarios exist, source, units
 *   GET /api/layers/<layer>/<chart>     chart data shaped for js/components/chart.js
 *   GET /api/tiles/mangroves/<scenario>/<year>/<z>/<x>/<y>.mvt   mangrove extent for one year
 *   GET /api/tiles/erosion/<z>/<x>/<y>.mvt                       eroded areas, each with its period
 *   GET /api/ocean/<key>                ocean package documents: catalog, raster/<id>[/<year>], data/<id>,
 *                                       overlay/<id>, vector/<id>, chart_style, findings (see server/load-ocean.mjs)
 *   GET /api/amib/<key>                 saltwater intrusion / salinity package: catalog, series/<product>, vector/<id>
 *   GET /api/amib/image/<id>/<step>     PNG of one of its map layers at a time step (see server/amib.mjs; drawn in worker threads and kept on disk);
 *                                       ?bg=clear makes the picture's most common colour see-through,
 *                                       ?hide=rrggbb,... makes those class colours see-through,
 *                                       ?tint=rrggbb:pct[:rrggbb],... draws those class colours only pct % opaque (in the
 *                                       second colour when given), feathered, or outlined with ?crisp=1,
 *                                       ?ramp=<name> draws the raw values in that ramp of src/amib/hazards.js RAMPS
 *   GET /api/dmjm/<key>                 plastic debris material: stations, species, hazards, literature (see server/load-dmjm.mjs)
 *   GET /api/nutrients/<key>            nutrients and plankton: points, chlorophyll, nitrate, phosphate, sources (see server/load-nutrients.mjs)
 *   GET /api/ndma/manifest, /api/ndma/<set>/<YYYY[-MM]>.png, /api/ndma/pixel/<set>?lat=&lon=   NDMA satellite chlorophyll / SST
 *                                       1998-2025 (see server/ndma.mjs, loaded by server/load-ndma.mjs)
 *   GET /api/mangroves/change/<frame>/<scenario>/<year>.png   that year's extent against the first mapped year
 *                                       (kept / gained / lost; see server/mangrove-change.mjs)
 *   POST /api/assistant/chat, /feedback; GET /api/assistant/status   the portal assistant (server/assistant/chat.mjs)
 *   GET /api/assistant/voice; POST /api/assistant/speak              its voice (server/assistant/voice.mjs)
 *   GET /api/terminal; POST /api/terminal/history, /hidden           the terminal's command history and hidden layers (server/terminal.mjs)
 * Every request except tiles, health and the assistant is written to access_log (route, status, time).
 */
import { query, cached, redis } from "./db.mjs";
import { amibImage, hexToRgb, rampStops } from "./amib.mjs";
import { injaStamp, injaSeries, withInjaCatalog } from "./inja.mjs";
import { mangroveChangeImage, FRAMES, FIRST_YEAR } from "./mangrove-change.mjs";
import { diagnostics } from "./diagnostics.mjs";
import { chat, feedback, allowed, assistantStatus, logAccess, spokenAnswer } from "./assistant/chat.mjs";
import { speak, voiceStatus } from "./assistant/voice.mjs";
import { terminalState, addCommand, setHidden } from "./terminal.mjs";
import { ndmaRoute } from "./ndma.mjs";

const JSON_TYPE = "application/json; charset=utf-8";
const send = (res, status, type, body, extra = {}) => { res.writeHead(status, { "Content-Type": type, ...extra }); res.end(body); };
const sendJson = (res, status, obj) => send(res, status, JSON_TYPE, JSON.stringify(obj));
const title = (s) => s[0].toUpperCase() + s.slice(1);
const info = async (layer) => (await query("select info, loaded_at from layer_info where layer = $1", [layer])).rows[0] ?? null;
const day = (d) => d.toISOString().slice(0, 10);
// below zoom 10 outlines are thinned to one tile-grid unit, which keeps wide-area tiles small
const tileArgs = (z, x, y) => [z, x, y, 40075016.686 / (4096 * 2 ** z)];
const MVT_GEOM = "ST_AsMVTGeom(case when $1::int < 10 then ST_Simplify(geom, $4::float8, true) else geom end, ST_TileEnvelope($1::int, $2::int, $3::int), 4096, 64, true)";

/* ---------- mangroves ---------- */
async function mangroveManifest() {
  const meta = await info("mangroves");
  if (!meta) return null;
  const { rows } = await query("select distinct scenario, year from mangrove_extent where year >= $1 order by year", [FIRST_YEAR]); // nothing before the timeline's first year
  const observed = rows.filter((r) => r.scenario === "observed").map((r) => r.year);
  const projected = rows.filter((r) => r.scenario !== "observed").map((r) => ({ scenario: r.scenario, year: r.year }));
  const projYears = [...new Set(projected.map((p) => p.year))];
  return {
    id: "mangroves", units: "km²", observed, projected, note: meta.info.note,
    // change pictures compare each year with the first mapped one, in these frames
    change: { baseline: observed[0], frames: Object.entries(FRAMES).map(([id, f]) => ({ id, bounds: f.bounds })) },
    scenarios: meta.info.scenarios.map((s) => (typeof s === "string" ? { id: s, label: title(s) } : s)),
    meta: {
      source: meta.info.source,
      temporal: `${observed[0]}–${observed.at(-1)} mapped (${observed.length} years)${projYears.length ? `; ${projYears.join(", ")} projected` : ""}`,
      spatial: "Pakistan coast", updated: day(meta.loaded_at),
    },
  };
}

async function mangroveSeries() {
  const { rows } = await query("select scenario, year, area_km2 from mangrove_area where year >= $1 order by scenario, year", [FIRST_YEAR]);
  const by = new Map();
  for (const r of rows) (by.get(r.scenario) ?? by.set(r.scenario, []).get(r.scenario)).push({ x: r.year, y: r.area_km2 });
  const order = ["observed", ...[...by.keys()].filter((k) => k !== "observed")];
  return { unit: "km²", series: order.filter((k) => by.has(k)).map((k) => ({ name: title(k), points: by.get(k) })) };
}

/** Gross gain and loss per year (mangrove_by_year_1985_2050.csv): mapped years, then each scenario's projection. */
async function mangroveGainLoss() {
  const { rows } = await query("select scenario, year, gain_km2, loss_km2, net_km2 from mangrove_gainloss where year >= $1 order by scenario, year", [FIRST_YEAR]);
  if (!rows.length) return null;
  const by = new Map();
  for (const r of rows) (by.get(r.scenario) ?? by.set(r.scenario, []).get(r.scenario)).push({ x: r.year, gain: r.gain_km2, loss: r.loss_km2, net: r.net_km2 });
  const order = ["observed", ...[...by.keys()].filter((k) => k !== "observed")];
  return { unit: "km²", series: order.filter((k) => by.has(k)).map((k) => ({ name: title(k), scenario: k, points: by.get(k) })) };
}

async function mangroveTile(scenario, year, z, x, y) {
  const { rows } = await query(
    `select ST_AsMVT(t, 'mangroves', 4096, 'geom') as mvt from (
       select ${MVT_GEOM} as geom from mangrove_extent
       where scenario = $5 and year = $6::int and geom && ST_TileEnvelope($1::int, $2::int, $3::int)
     ) t where geom is not null`, [...tileArgs(z, x, y), scenario, year]);
  return rows[0].mvt ?? Buffer.alloc(0);
}

/* ---------- erosion ---------- */
// area of the delivered polygons, per period; computed from the shapes on the ellipsoid
const erosionPeriods = async () => (await query(
  `select kind, start_yr, end_yr, sum(ST_Area(ST_Transform(geom, 4326)::geography)) / 1e6 as km2
   from erosion_area group by kind, start_yr, end_yr order by start_yr`)).rows;

async function erosionManifest() {
  const meta = await info("erosion");
  if (!meta) return null;
  const periods = (await erosionPeriods()).map((p) => ({ kind: p.kind, from: p.start_yr, to: p.end_yr }));
  const obs = periods.filter((p) => p.kind === "observed"), proj = periods.filter((p) => p.kind === "projected");
  return {
    id: "erosion", units: "km²", periods, note: meta.info.method,
    meta: {
      source: meta.info.source,
      temporal: `${obs[0].from}–${obs.at(-1).to} mapped in ${obs.length} periods${proj.length ? `; yearly to ${proj.at(-1).to} projected` : ""}`,
      spatial: "Pakistan coast", updated: day(meta.loaded_at),
    },
  };
}

/** Eroded area added up period by period. The projected line starts where the mapped one ends. */
async function erosionSeries() {
  const periods = await erosionPeriods();
  let total = 0;
  const observed = [], projected = [];
  for (const p of periods) {
    if (p.kind === "projected" && !projected.length) projected.push({ x: p.start_yr, y: +total.toFixed(2) });
    total += p.km2;
    (p.kind === "observed" ? observed : projected).push({ x: p.end_yr, y: +total.toFixed(2) });
  }
  return { unit: "km²", series: [{ name: "Mapped", points: observed }, { name: "Projected", points: projected }] };
}

async function erosionByPeriod() {
  const periods = (await erosionPeriods()).filter((p) => p.kind === "observed");
  return { unit: "km²", series: [{ name: "Mapped", points: periods.map((p) => ({ x: `${p.start_yr}–${String(p.end_yr).slice(2)}`, y: +p.km2.toFixed(2), from: p.start_yr })) }] };
}

async function erosionTile(z, x, y) {
  const { rows } = await query(
    `select ST_AsMVT(t, 'erosion', 4096, 'geom') as mvt from (
       select kind, start_yr, end_yr, ${MVT_GEOM} as geom from erosion_area
       where geom && ST_TileEnvelope($1::int, $2::int, $3::int)
     ) t where geom is not null`, tileArgs(z, x, y));
  return rows[0].mvt ?? Buffer.alloc(0);
}

/* ---------- routing ---------- */
const JSON_ROUTES = {
  "/api/layers/mangroves": ["mangroves:manifest:v3", mangroveManifest],
  "/api/layers/mangroves/series": ["mangroves:series:v3", mangroveSeries],
  "/api/layers/mangroves/gainloss": ["mangroves:gainloss", mangroveGainLoss],
  "/api/layers/erosion": ["erosion:manifest", erosionManifest],
  "/api/layers/erosion/series": ["erosion:series", erosionSeries],
  "/api/layers/erosion/periods": ["erosion:periods", erosionByPeriod],
};
const MANGROVE_TILE = /^\/api\/tiles\/mangroves\/([a-z]+)\/(\d{4})\/(\d{1,2})\/(\d+)\/(\d+)\.mvt$/;
const EROSION_TILE = /^\/api\/tiles\/erosion\/(\d{1,2})\/(\d+)\/(\d+)\.mvt$/;
const inRange = (z, x, y) => z <= 16 && x < 2 ** z && y < 2 ** z;

async function sendTile(res, key, z, x, y, load) {
  if (!inRange(z, x, y)) return sendJson(res, 400, { error: "Tile out of range" });
  const { body, cache } = await cached(`${key}:${z}:${x}:${y}`, load);
  return send(res, body.length ? 200 : 204, "application/vnd.mapbox-vector-tile", body, { "X-Cache": cache, "Cache-Control": "public, max-age=300" });
}

const readJson = (req, max = 32768) => new Promise((resolve, reject) => {
  let size = 0; const parts = [];
  req.on("data", (c) => { size += c.length; if (size > max) { reject(new Error("too large")); req.destroy(); } else parts.push(c); });
  req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(parts).toString() || "{}")); } catch (e) { reject(e); } });
  req.on("error", reject);
});

export async function handleApi(req, res) {
  const path = new URL(req.url, "http://localhost").pathname;
  if (!path.startsWith("/api/tiles/") && path !== "/api/health" && !path.startsWith("/api/assistant/")) { // map tiles are too many to log
    const t0 = performance.now();
    res.on("close", () => logAccess(path, res.writableEnded ? res.statusCode : 499, performance.now() - t0)); // 499: the page gave up waiting
  }
  try {
    if (path === "/api/assistant/status") return sendJson(res, 200, await assistantStatus());
    if (path === "/api/assistant/voice") return sendJson(res, 200, voiceStatus());
    if (path === "/api/assistant/speak") { // the audio of one stored answer, for the call mode
      if (req.method !== "POST") return sendJson(res, 405, { error: "POST only" });
      if (!allowed(`voice:${req.socket.remoteAddress ?? "unknown"}`)) return sendJson(res, 429, { ok: false, error: "Too many at once. Wait a moment." });
      const body = await readJson(req).catch(() => null), text = body && (await spokenAnswer(body.id));
      if (!text) return sendJson(res, 404, { ok: false, error: "No such answer." });
      const out = await speak(text);
      return out.status === 200 ? send(res, 200, out.type, out.body, { "Cache-Control": "no-store" }) : sendJson(res, out.status, { ok: false, error: out.error });
    }
    if (path === "/api/assistant/chat" || path === "/api/assistant/feedback") {
      if (req.method !== "POST") return sendJson(res, 405, { error: "POST only" });
      const who = req.socket.remoteAddress ?? "unknown";
      if (!allowed(who)) return sendJson(res, 429, { ok: false, error: "Too many questions at once. Wait a moment and try again." });
      const body = await readJson(req).catch(() => null);
      if (!body) return sendJson(res, 400, { ok: false, error: "Bad request" });
      const { status, body: out } = path.endsWith("/chat") ? await chat(body.messages, { voice: body.voice === true }) : await feedback(body);
      return sendJson(res, status, out);
    }
    if (path === "/api/terminal") return send(res, 200, JSON_TYPE, JSON.stringify(await terminalState()), { "Cache-Control": "no-store" });
    if (path === "/api/terminal/history" || path === "/api/terminal/hidden") {
      if (req.method !== "POST") return sendJson(res, 405, { error: "POST only" });
      const body = await readJson(req).catch(() => null);
      const ok = body && (path.endsWith("/history") ? addCommand(body.command) : await setHidden(body.hidden));
      return sendJson(res, ok ? 200 : 400, ok ? { ok: true } : { ok: false, error: "Bad request" });
    }
    if (path === "/api/health") {
      const [db, cache] = await Promise.all([query("select 1").then(() => true, () => false), redis.ping().then(() => true, () => false)]);
      return sendJson(res, 200, { database: db, cache });
    }
    if (path === "/api/diagnostics") return send(res, 200, JSON_TYPE, JSON.stringify(await diagnostics()), { "Cache-Control": "no-store" });
    if (JSON_ROUTES[path]) {
      const [key, load] = JSON_ROUTES[path];
      const { body, cache } = await cached(key, async () => Buffer.from(JSON.stringify(await load())));
      return send(res, body.toString() === "null" ? 404 : 200, JSON_TYPE, body, { "X-Cache": cache, "Cache-Control": "no-cache" });
    }
    const image = path.match(/^\/api\/amib\/image\/([^/]+)\/(\d{1,4})$/);
    if (image) {
      const id = decodeURIComponent(image[1]);
      const params = new URL(req.url, "http://localhost").searchParams;
      const clear = params.get("bg") === "clear"; // ?bg=clear: hide the even background colour
      const hide = (params.get("hide") ?? "").split(",").filter((h) => /^[0-9a-f]{6}$/i.test(h)).slice(0, 8).map((h) => h.toLowerCase()); // ?hide=rrggbb,...: hide these class colours
      const clipSea = params.get("clip") === "sea"; // ?clip=sea: only what lies inside Pakistan's EEZ (sea maps)
      const softEdges = params.get("edge") === "soft"; // ?edge=soft: a rectangular pilot area fades out along a wavy rim
      const tints = (params.get("tint") ?? "").split(",").filter((t) => /^[0-9a-f]{6}:\d{1,3}(:[0-9a-f]{6})?$/i.test(t)).slice(0, 12)
        .map((t) => { const [h, p, shown] = t.toLowerCase().split(":"); return [...hexToRgb(h), Math.min(100, +p) / 100, ...(shown ? [hexToRgb(shown)] : [])]; }); // ?tint=rrggbb:pct[:rrggbb],...: class colours drawn part see-through, optionally in another colour
      const crisp = params.get("crisp") === "1"; // ?crisp=1: no smoothing of the tinted classes, an outline instead
      const ramp = rampStops(params.get("ramp")); // ?ramp=<name>: drawn from the raw values in that ramp of src/amib/hazards.js
      const gone = new AbortController(); // the page stopped waiting (it moved on to another map): a drawing not yet started is dropped
      res.on("close", () => res.writableEnded || gone.abort());
      const drawn = await amibImage(id, +image[2], { clearBackground: clear, hideColors: hide.map(hexToRgb), clipSea, softEdges, tints, crisp, ramp }, gone.signal).catch((e) => { if (e.dropped) return "dropped"; throw e; }); // kept on disk, not in Redis (server/amib.mjs)
      if (drawn === "dropped") return;
      const { body, cache } = drawn ?? { body: Buffer.alloc(0) };
      return body.length ? send(res, 200, "image/png", body, { "X-Cache": cache, "Cache-Control": "public, max-age=86400" }) : sendJson(res, 404, { error: "No such layer image" });
    }
    const change = path.match(/^\/api\/mangroves\/change\/([a-z]+)\/([a-z]+)\/(\d{4})\.png$/);
    if (change) {
      const [, frame, scenario, year] = change, base = (await mangroveManifest())?.observed[0];
      const { body, cache } = await cached(`mangroves:change:${base}:${frame}:${scenario}:${year}`, async () => (base && (await mangroveChangeImage(frame, scenario, +year, base))) || Buffer.alloc(0));
      return body.length ? send(res, 200, "image/png", body, { "X-Cache": cache, "Cache-Control": "public, max-age=86400" }) : sendJson(res, 404, { error: "No such picture" });
    }
    const ndma = await ndmaRoute(path, new URL(req.url, "http://localhost").searchParams);
    if (ndma) return send(res, ndma.status, ndma.type, ndma.body, ndma.headers);
    const doc = path.match(/^\/api\/(ocean|amib|dmjm|nutrients)\/(.+)$/);
    if (doc && !doc[2].startsWith("files/")) { // files/<id> lists server paths and is not served
      const key = decodeURIComponent(doc[2]);
      const inja = doc[1] === "amib" && (key === "catalog" || key === "series/J"); // the INJA erosion package is added to the AMIB answers (server/inja.mjs)
      const { body, cache } = await cached(`${doc[1]}:${key}${inja ? `:${injaStamp()}` : ""}`, async () => {
        if (inja && key === "series/J") return Buffer.from(JSON.stringify(injaSeries()));
        const text = (await query(`select body::text as body from ${doc[1]}_doc where key = $1`, [key])).rows[0]?.body ?? "null";
        return Buffer.from(inja ? withInjaCatalog(text) : text);
      });
      return send(res, body.toString() === "null" ? 404 : 200, JSON_TYPE, body, { "X-Cache": cache, "Cache-Control": "no-cache" });
    }
    let t = path.match(MANGROVE_TILE);
    if (t) { const [sc, yr, z, x, y] = [t[1], +t[2], +t[3], +t[4], +t[5]]; return sendTile(res, `mangroves:mvt:${sc}:${yr}`, z, x, y, () => mangroveTile(sc, yr, z, x, y)); }
    t = path.match(EROSION_TILE);
    if (t) { const [z, x, y] = [+t[1], +t[2], +t[3]]; return sendTile(res, "erosion:mvt", z, x, y, () => erosionTile(z, x, y)); }
    return sendJson(res, 404, { error: "Unknown API route" });
  } catch (e) {
    console.warn(`API ${path}: ${e.message}`);
    return sendJson(res, 503, { error: "Database unavailable" });
  }
}
