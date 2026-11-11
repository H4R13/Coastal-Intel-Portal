/**
 * Data that comes from the internet instead of from the team: fetched, checked, staged, and shown only after a person approves it.
 *   fetchSource(id)       download one source, check it, and stage it (ext_staging) when it differs from what is promoted
 *   approve(id) / reject(id)   a person's decision on a staged batch; approving promotes it into the portal's own table
 *   status()              what each source holds, when it was fetched, and what waits for a decision
 * Rules (CLAUDE.md): only documented public APIs, listed in SOURCES; nothing reaches a map or an answer without approval; the team's own
 * data (AMHK, DMJM, AMSK) is never touched here; every figure Hela gives from here is labelled "external", with its source and fetch date.
 * Run it with `npm run update:data` (see update-data.mjs).
 */
import crypto from "node:crypto";
import { pool, query, clearCache } from "./db.mjs";

/* ---------- the registry: one entry per source ---------- */
const USGS_BOX = { minlatitude: 21, maxlatitude: 27.5, minlongitude: 60, maxlongitude: 70 }; // the Pakistan coast, the Makran and the Gulf of Oman side
export const SOURCES = {
  "usgs-earthquakes": {
    name: "USGS earthquake catalogue",
    provider: "U.S. Geological Survey, ComCat (earthquake.usgs.gov/fdsnws/event/1)",
    licence: "US Government work, public domain; cite USGS",
    every_days: 7, table: "ext_quake", cache: "external",
    describe: "earthquakes of magnitude 4 or more since 1973 in a box around the Pakistan coast (lat 21-27.5, lon 60-70)",
    url: () => `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=1973-01-01&minmagnitude=4&orderby=time-asc&limit=20000&${new URLSearchParams(USGS_BOX)}`,
    /** → rows [id, time (ISO), lat, lon, depth_km, magnitude, place] */
    parse: (json) => (json.features ?? []).map((f) => [f.id, new Date(f.properties.time).toISOString(), f.geometry.coordinates[1], f.geometry.coordinates[0], f.geometry.coordinates[2], f.properties.mag, f.properties.place ?? ""]),
    /** Checks a batch must pass before it can be approved. */
    checks: (rows) => [
      ["has events", rows.length > 0, `${rows.length} events`],
      ["ids are unique", new Set(rows.map((r) => r[0])).size === rows.length, "no duplicates"],
      ["inside the box", rows.every((r) => r[2] >= USGS_BOX.minlatitude && r[2] <= USGS_BOX.maxlatitude && r[3] >= USGS_BOX.minlongitude && r[3] <= USGS_BOX.maxlongitude), "every epicentre"],
      ["magnitudes plausible", rows.every((r) => r[5] >= 3.9 && r[5] <= 9.9), "between 4 and 9.9"],
      ["depths plausible", rows.every((r) => r[4] == null || (r[4] >= -5 && r[4] <= 800)), "-5 to 800 km"],
    ],
    key: (r) => r[0],
    same: (a, b) => a[5] === b[5] && a[2] === b[2] && a[3] === b[3], // a revised magnitude or location is a change
    current: async () => (await query("select id, at, lat, lon, depth_km, magnitude, place from ext_quake")).rows.map((r) => [r.id, r.at.toISOString(), r.lat, r.lon, r.depth_km, r.magnitude, r.place ?? ""]),
    save: async (db, rows, batch) => {
      await db.query("delete from ext_quake");
      for (let i = 0; i < rows.length; i += 500) {
        const part = rows.slice(i, i + 500), args = [];
        const values = part.map((r, k) => { args.push(...r, batch); return `($${k * 8 + 1},$${k * 8 + 2},$${k * 8 + 3},$${k * 8 + 4},$${k * 8 + 5},$${k * 8 + 6},$${k * 8 + 7},$${k * 8 + 8})`; });
        await db.query(`insert into ext_quake (id, at, lat, lon, depth_km, magnitude, place, batch) values ${values.join(",")}`, args);
      }
    },
    held: async () => (await query("select count(*)::int as n, min(at) as first, max(at) as last from ext_quake")).rows[0],
  },
  "psmsl-karachi": {
    name: "PSMSL tide gauge, Karachi (station 204)",
    provider: "Permanent Service for Mean Sea Level, RLR monthly data (psmsl.org)",
    licence: "free for research use with acknowledgement: Holgate et al. (2013), PSMSL (2024)",
    every_days: 30, cache: "external",
    describe: "monthly mean sea level at the Karachi tide gauge, millimetres, Revised Local Reference (relative to the land, not corrected for land movement), 1916 to 2016, with gaps",
    url: () => "https://psmsl.org/data/obtaining/rlr.monthly.data/204.rlrdata",
    /** the file is text: "1916.0417; 7021; 0;000" = decimal year; height in mm (-99999 = no value); days missing; quality flag. → rows [month "YYYY-MM", mm, days missing] */
    parse: (text) => String(text).split(/\r?\n/).map((l) => l.split(";").map((x) => x.trim())).filter((p) => p.length >= 3 && /^\d{4}\.\d+$/.test(p[0]) && +p[1] > -99999).map((p) => { const y = Math.floor(+p[0]), m = Math.min(12, Math.floor((+p[0] - y) * 12) + 1); return [`${y}-${String(m).padStart(2, "0")}`, +p[1], +p[2]]; }),
    checks: (rows) => [
      ["has months", rows.length > 100, `${rows.length} months with a value`],
      ["months are unique", new Set(rows.map((r) => r[0])).size === rows.length, "no duplicates"],
      ["heights plausible", rows.every((r) => r[1] > 5000 && r[1] < 9000), "between 5000 and 9000 mm (RLR datum)"],
      ["months in order", rows.every((r, i) => !i || r[0] > rows[i - 1][0]), "increasing"],
    ],
    key: (r) => r[0],
    same: (a, b) => a[1] === b[1],
    current: async () => (await query("select month, mm, days_missing from ext_tide where station = 204 order by month")).rows.map((r) => [r.month, r.mm, r.days_missing]),
    save: async (db, rows, batch) => {
      await db.query("delete from ext_tide where station = 204");
      for (let i = 0; i < rows.length; i += 500) {
        const part = rows.slice(i, i + 500), args = [];
        const values = part.map((r, k) => { args.push(...r, batch); return `(204,$${k * 4 + 1},$${k * 4 + 2},$${k * 4 + 3},$${k * 4 + 4})`; });
        await db.query(`insert into ext_tide (station, month, mm, days_missing, batch) values ${values.join(",")}`, args);
      }
    },
    held: async () => (await query("select count(*)::int as n, min(month) as first, max(month) as last from ext_tide where station = 204")).rows[0],
  },
};

let ready;
export const ensure = () => (ready ??= (async () => {
  await query(`create table if not exists ext_source (id text primary key, last_checked timestamptz, last_fetched timestamptz, last_hash text, last_error text);
    create table if not exists ext_staging (id serial primary key, source text not null, fetched timestamptz not null default now(), hash text not null, rows jsonb not null,
      diff jsonb not null, checks jsonb not null, status text not null default 'pending', decided timestamptz);
    create table if not exists ext_quake (id text primary key, at timestamptz not null, lat double precision not null, lon double precision not null, depth_km double precision, magnitude real not null, place text, batch int);
    create index if not exists ext_quake_at on ext_quake (at);
    create table if not exists ext_tide (station int not null, month text not null, mm int not null, days_missing int, batch int, primary key (station, month));`);
})());

function compare(src, now, before) {
  const had = new Map(before.map((r) => [src.key(r), r])), has = new Map(now.map((r) => [src.key(r), r]));
  const added = now.filter((r) => !had.has(src.key(r))), removed = before.filter((r) => !has.has(src.key(r)));
  const changed = now.filter((r) => had.has(src.key(r)) && !src.same(r, had.get(src.key(r))));
  return { before: before.length, after: now.length, added: added.length, removed: removed.length, changed: changed.length, sample_added: added.slice(-5) };
}

/** Download a source and stage it. Returns { staged: id } or { skipped: reason }. Nothing in the portal changes. */
export async function fetchSource(id) {
  const src = SOURCES[id];
  if (!src) throw new Error(`unknown source "${id}"; known: ${Object.keys(SOURCES).join(", ")}`);
  await ensure();
  await query("insert into ext_source (id) values ($1) on conflict do nothing", [id]);
  try {
    const r = await fetch(src.url(), { signal: AbortSignal.timeout(60000), headers: { "User-Agent": "NereusSentinel-DataUpdate/1.0 (coastal research portal)" } });
    if (!r.ok) throw new Error(`${src.provider} answered ${r.status}`);
    const rows = src.parse(src.url().endsWith(".rlrdata") ? await r.text() : await r.json()), hash = crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex");
    await query("update ext_source set last_checked = now(), last_error = null where id = $1", [id]);
    const last = (await query("select last_hash from ext_source where id = $1", [id])).rows[0]?.last_hash;
    if (last === hash) return { skipped: "nothing has changed since the last approved batch" };
    const pending = (await query("select id from ext_staging where source = $1 and status = 'pending' and hash = $2", [id, hash])).rows[0];
    if (pending) return { skipped: `this batch is already staged (#${pending.id}) and waits for a decision` };
    const diff = compare(src, rows, await src.current());
    const checks = src.checks(rows).map(([name, ok, detail]) => ({ name, ok, detail }));
    if (diff.before && diff.after < diff.before * 0.95) checks.push({ name: "did not shrink", ok: false, detail: `${diff.before} → ${diff.after} events (more than 5 % fewer)` });
    const status = checks.every((c) => c.ok) ? "pending" : "failed";
    const staged = (await query("insert into ext_staging (source, hash, rows, diff, checks, status) values ($1, $2, $3, $4, $5, $6) returning id", [id, hash, JSON.stringify(rows), JSON.stringify(diff), JSON.stringify(checks), status])).rows[0].id;
    return { staged, status, diff, checks };
  } catch (e) {
    await query("update ext_source set last_checked = now(), last_error = $2 where id = $1", [id, e.message]);
    throw e;
  }
}

/** A person's yes: promote the staged batch into the portal's table, in one transaction, then forget the cached answers. */
export async function approve(batch, { force = false } = {}) {
  await ensure();
  const b = (await query("select * from ext_staging where id = $1", [batch])).rows[0];
  if (!b) throw new Error(`no staged batch #${batch}`);
  if (b.status === "approved" || b.status === "rejected") throw new Error(`batch #${batch} was already ${b.status}`);
  if (b.status === "failed" && !force) throw new Error(`batch #${batch} failed its checks (${b.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`).join("; ")}); use --force only after looking at it`);
  const src = SOURCES[b.source], db = await pool.connect();
  try {
    await db.query("begin");
    await src.save(db, b.rows, batch);
    await db.query("update ext_staging set status = 'approved', decided = now() where id = $1", [batch]);
    await db.query("update ext_source set last_fetched = $2, last_hash = $3 where id = $1", [b.source, b.fetched, b.hash]);
    await db.query("commit");
  } catch (e) { await db.query("rollback").catch(() => {}); throw e; } finally { db.release(); }
  return { batch, rows: b.rows.length, cleared: await clearCache(src.cache).catch(() => 0) };
}

export async function reject(batch) {
  await ensure();
  const r = await query("update ext_staging set status = 'rejected', decided = now() where id = $1 and status in ('pending','failed') returning id", [batch]);
  if (!r.rowCount) throw new Error(`no open batch #${batch}`);
  return { batch };
}

/** What each source holds and what waits. */
export async function status() {
  await ensure();
  const out = [];
  for (const [id, src] of Object.entries(SOURCES)) {
    const s = (await query("select * from ext_source where id = $1", [id])).rows[0] ?? {};
    const waiting = (await query("select id, fetched, status, diff from ext_staging where source = $1 and status in ('pending','failed') order by id", [id])).rows;
    const held = await src.held();
    out.push({ id, name: src.name, provider: src.provider, licence: src.licence, covers: src.describe, every_days: src.every_days, last_checked: s.last_checked ?? null, last_fetched: s.last_fetched ?? null, last_error: s.last_error ?? null, held, waiting });
  }
  return out;
}

/** Due when never fetched, or older than its interval. */
export async function due() {
  await ensure();
  const rows = (await query("select id, last_checked from ext_source")).rows, seen = new Map(rows.map((r) => [r.id, r.last_checked]));
  return Object.entries(SOURCES).filter(([id, s]) => !seen.get(id) || Date.now() - seen.get(id).getTime() > s.every_days * 86400000).map(([id]) => id);
}
