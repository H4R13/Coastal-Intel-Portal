/**
 * Health report for the portal's terminal (js/components/terminal.js): is the database up, is the cache up, is every
 * layer's data loaded, is the cache warm, and how loaded is this machine.
 *   GET /api/diagnostics   → { checks: [{ group, name, status: "ok" | "warn" | "fail", detail }], system: {...} }
 * Never cached. It reports counts and sizes only: no host name, paths, user names or settings.
 */
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { query, redis, PREFIX } from "./db.mjs";
import { FRAMES, FIRST_YEAR } from "./mangrove-change.mjs";

const ms = (t) => Math.round(performance.now() - t);
const mb = (bytes) => Math.round(bytes / 1048576);
const timed = async (fn) => { const t = performance.now(); try { return { value: await fn(), ms: ms(t) }; } catch (e) { return { error: e.message, ms: ms(t) }; } };
const one = async (sql, params) => (await query(sql, params)).rows[0];

/** Share of processor time in use, measured over a short moment (Windows has no load average). */
async function cpuUse(wait = 250) {
  const snap = () => os.cpus().reduce((a, c) => { const t = Object.values(c.times).reduce((x, y) => x + y, 0); return { idle: a.idle + c.times.idle, total: a.total + t }; }, { idle: 0, total: 0 });
  const a = snap(); await new Promise((r) => setTimeout(r, wait)); const b = snap();
  return b.total === a.total ? 0 : Math.round(100 * (1 - (b.idle - a.idle) / (b.total - a.total)));
}

function folder(dir) {
  let files = 0, bytes = 0;
  try { for (const e of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) if (e.isFile()) { files++; bytes += fs.statSync(path.join(e.parentPath ?? e.path, e.name)).size; } } catch { return null; }
  return { files, bytes };
}

export async function diagnostics() {
  const checks = [], add = (group, name, status, detail) => checks.push({ group, name, status, detail });

  /* ---- services ---- */
  const db = await timed(() => one("select current_setting('server_version') v, postgis_lib_version() g, pg_database_size(current_database()) size, (select count(*) from pg_stat_activity where datname = current_database()) conns"));
  if (db.error) add("Services", "PostgreSQL", "fail", `not reachable: ${db.error}`);
  else add("Services", "PostgreSQL", db.ms > 500 ? "warn" : "ok", `running · v${db.value.v.split(" ")[0]} · PostGIS ${db.value.g} · ${mb(db.value.size)} MB · ${db.value.conns} connections · answered in ${db.ms} ms`);
  const rd = await timed(async () => { await redis.ping(); const info = await redis.info(); const get = (k) => info.match(new RegExp(`^${k}:(.*)$`, "m"))?.[1]?.trim(); return { v: get("redis_version"), used: +get("used_memory"), max: +get("maxmemory"), keys: await redis.dbsize(), hits: +get("keyspace_hits"), misses: +get("keyspace_misses") }; });
  if (rd.error) add("Services", "Redis cache (Memurai)", "fail", `not reachable: ${rd.error}; answers come straight from the database`);
  else add("Services", "Redis cache (Memurai)", "ok", `running · v${rd.value.v} · ${mb(rd.value.used)} MB used${rd.value.max ? ` of ${mb(rd.value.max)} MB` : ""} · ${rd.value.keys} keys · answered in ${rd.ms} ms`);

  /* ---- data for each layer ---- */
  if (db.error) add("Layer data", "All layers", "fail", "cannot be checked without the database");
  else {
    const n = await one(`select (select count(*) from mangrove_extent) mg, (select count(*) from (select 1 from mangrove_extent where year >= $1 group by scenario, year) x) mgsets,
      (select count(*) from erosion_area) er, (select count(distinct (start_yr, end_yr)) from erosion_area) erp, (select count(*) from ocean_doc) oc,
      (select count(*) from ocean_doc where key like 'raster/%') ocr, (select count(*) from amib_doc where key like 'files/%') am,
      (select jsonb_array_length(body->'rows') from dmjm_doc where key = 'surveys') dm`, [FIRST_YEAR]);
    const products = Object.fromEntries((await query("select l->>'product' p, count(*) n from amib_doc, jsonb_array_elements(body->'layers') l where key = 'catalog' and l ? 'bounds' group by 1")).rows.map((r) => [r.p, +r.n]));
    const rasters = fs.existsSync(path.resolve(process.env.AMIB_DIR ?? "Other Data/AMIB"));
    const amib = (name, list) => { const maps = list.reduce((a, p) => a + (products[p] ?? 0), 0); add("Layer data", name, !maps ? "fail" : rasters ? "ok" : "warn", !maps ? "not loaded (npm run load:amib)" : `${maps} maps loaded${rasters ? "" : " · raster folder not found on this machine, so the maps cannot be drawn"}`); };
    let flood = null; try { flood = JSON.parse(fs.readFileSync("data/sealevel/index.json", "utf8")).levels; } catch { /* not built on this machine */ }
    amib("Sea Level Rise", ["D"]);
    add("Layer data", "Sea Level Rise · terrain exposure", flood?.length ? "ok" : "warn", flood?.length ? `${flood.length} water levels (${flood.map((l) => `+${l.level_m} m`).join(", ")})` : "no exposure tiles in data/sealevel");
    amib("Saltwater Intrusion", ["C", "B", "GH"]);
    amib("Salinity Index", ["A", "G", "H"]);
    add("Layer data", "Mangroves", +n.mg ? "ok" : "fail", +n.mg ? `${n.mgsets} yearly extents from ${FIRST_YEAR} · ${(+n.mg).toLocaleString("en")} shapes` : "not loaded (npm run load:mangroves)");
    add("Layer data", "Coastal Erosion", +n.er ? "ok" : "fail", +n.er ? `${n.erp} periods · ${(+n.er).toLocaleString("en")} shapes` : "not loaded (npm run load:erosion)");
    add("Layer data", "Plastics", +n.dm ? "ok" : "fail", +n.dm ? `${n.dm} beach surveys and their scenarios to 2050` : "not loaded (npm run load:dmjm)");
    add("Layer data", "Fisheries", +n.oc ? "ok" : "fail", +n.oc ? "national indicators loaded" : "not loaded (npm run load:ocean)");
    add("Layer data", "Ocean", +n.ocr ? "ok" : "fail", +n.ocr ? `${n.ocr} grids · ${n.oc} documents` : "not loaded (npm run load:ocean)");

    /* ---- cache ---- */
    if (!rd.error) {
      const count = async (pattern) => { let c = 0; for await (const keys of redis.scanStream({ match: `${PREFIX}${pattern}`, count: 1000 })) c += keys.length; return c; };
      const [pictures, images, tiles] = await Promise.all([count("mangroves:change:[0-9]*:*"), count("amib:img:*"), count("*:mvt:*")]);
      const expected = +n.mgsets * Object.keys(FRAMES).length;
      add("Cache", "Mangrove change pictures", pictures >= expected ? "ok" : "warn", `${pictures} of ${expected} ready${pictures >= expected ? "" : " · the rest are drawn on first use (npm run warm:mangroves draws them all)"}`);
      add("Cache", "Map pictures and tiles", "ok", `${images} package map pictures · ${tiles} vector tiles kept${rd.value.hits + rd.value.misses ? ` · ${Math.round((100 * rd.value.hits) / (rd.value.hits + rd.value.misses))} % of lookups answered from cache` : ""}`);
    }
  }
  const disk = folder(".tilecache");
  add("Cache", "Basemap tiles on disk", disk?.files ? "ok" : "warn", disk?.files ? `${disk.files.toLocaleString("en")} tiles · ${mb(disk.bytes)} MB` : "empty: basemap tiles are fetched from the providers as you move the map");

  /* ---- this machine ---- */
  const total = os.totalmem(), free = os.freemem(), used = total - free, mem = process.memoryUsage(), cpu = await cpuUse();
  add("System", "Memory", free / total < 0.08 ? "warn" : "ok", `${(used / 2 ** 30).toFixed(1)} GB used · ${(free / 2 ** 30).toFixed(1)} GB free · ${(total / 2 ** 30).toFixed(1)} GB total (${Math.round((100 * used) / total)} % in use)`);
  add("System", "Processor", cpu > 90 ? "warn" : "ok", `${cpu} % busy · ${os.cpus().length} cores`);
  add("System", "Portal server", "ok", `${mb(mem.rss)} MB of memory · up ${Math.round(process.uptime() / 60)} min · Node ${process.version}`);
  return { checks, system: { memory: { total, free, used }, cpu, server: { rss: mem.rss, uptime: process.uptime() } }, at: new Date().toISOString() };
}
