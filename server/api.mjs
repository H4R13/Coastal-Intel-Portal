/**
 * Data API, mounted by serve.mjs under /api/. Every answer is cached in Redis until its layer is reloaded.
 *   GET /api/health
 *   GET /api/diagnostics                services, layer data, cache and machine load (server/diagnostics.mjs)
 *   GET /api/layers/<layer>             which years, periods and scenarios exist, source, units
 *   GET /api/layers/<layer>/<chart>     chart data shaped for js/components/chart.js
 *   GET /api/tiles/mangroves/<scenario>/<year>/<z>/<x>/<y>.mvt   mangrove extent for one year
 *   GET /api/tiles/erosion/<z>/<x>/<y>.mvt                       eroded areas, each with its period
 *   GET /api/ocean/<key>                ocean package documents: catalog, raster/<id>[/<year>], data/<id>,
 *                                       overlay/<id>, vector/<id>, chart_style, findings (see server/load-ocean.mjs)
 *   GET /api/amib/<key>                 saltwater intrusion / salinity package: catalog, series/<product>, vector/<id>
 *   GET /api/amib/image/<id>/<step>     PNG of one of its map layers at a time step (see server/amib.mjs);
 *                                       ?bg=clear makes the picture's most common colour see-through,
 *                                       ?hide=rrggbb,... makes those class colours see-through
 *   GET /api/dmjm/<key>                 plastic debris material: surveys, projection (see server/load-dmjm.mjs)
 *   GET /api/mangroves/change/<frame>/<scenario>/<year>.png   that year's extent against the first mapped year
 *                                       (kept / gained / lost; see server/mangrove-change.mjs)
 */
import { query, cached, redis } from "./db.mjs";
import { amibImage } from "./amib.mjs";
import { mangroveChangeImage, FRAMES, FIRST_YEAR } from "./mangrove-change.mjs";
import { diagnostics } from "./diagnostics.mjs";

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

export async function handleApi(req, res) {
  const path = new URL(req.url, "http://localhost").pathname;
  try {
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
      const { body, cache } = await cached(`amib:img:${id}:${image[2]}${clear ? ":clear" : ""}${hide.length ? `:hide-${hide.join("-")}` : ""}`,
        async () => (await amibImage(id, +image[2], { clearBackground: clear, hideColors: hide.map((h) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))) })) ?? Buffer.alloc(0));
      return body.length ? send(res, 200, "image/png", body, { "X-Cache": cache, "Cache-Control": "public, max-age=86400" }) : sendJson(res, 404, { error: "No such layer image" });
    }
    const change = path.match(/^\/api\/mangroves\/change\/([a-z]+)\/([a-z]+)\/(\d{4})\.png$/);
    if (change) {
      const [, frame, scenario, year] = change, base = (await mangroveManifest())?.observed[0];
      const { body, cache } = await cached(`mangroves:change:${base}:${frame}:${scenario}:${year}`, async () => (base && (await mangroveChangeImage(frame, scenario, +year, base))) || Buffer.alloc(0));
      return body.length ? send(res, 200, "image/png", body, { "X-Cache": cache, "Cache-Control": "public, max-age=86400" }) : sendJson(res, 404, { error: "No such picture" });
    }
    const doc = path.match(/^\/api\/(ocean|amib|dmjm)\/(.+)$/);
    if (doc && !doc[2].startsWith("files/")) { // files/<id> lists server paths and is not served
      const key = decodeURIComponent(doc[2]);
      const { body, cache } = await cached(`${doc[1]}:${key}`, async () => Buffer.from((await query(`select body::text as body from ${doc[1]}_doc where key = $1`, [key])).rows[0]?.body ?? "null"));
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
