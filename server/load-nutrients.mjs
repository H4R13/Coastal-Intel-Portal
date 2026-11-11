/**
 * Load the nutrients and plankton material (DMJM's "Indus Delta Observatory") into PostgreSQL (nutrients_doc in
 * schema.sql) and clear its cached answers.
 *
 *   node server/load-nutrients.mjs ["Other Data/DMJM/New/indus delta portal"]
 *
 * Read from the observatory's data/reference folder:
 *   plankton-history.json  monthly satellite chlorophyll (NOAA ERDDAP erdMH1chlamday_R2022SQ, about 4 km) at five fixed
 *                          water pixels, January 2020 to April 2026
 *   reference.json         the April 2026 chlorophyll map of the delta, and World Ocean Atlas 2023 surface nitrate,
 *                          phosphate (1965-2022 average, one-degree cells)
 * Stored documents:
 *   points       the five places: where they were asked for, the pixel actually used, and one value per calendar month
 *                (null where the satellite had no valid retrieval or returned no row: gaps stay gaps)
 *   chlorophyll  the April 2026 map: [lat, lon, value] of each valid pixel (clouds and land are left out)
 *   nitrate, phosphate   [lat, lon, value] of each one-degree cell with a value
 *   sources      providers, dataset ids, dates and the observatory's own limits on reading them
 * Nothing is interpolated or filled in. The observatory's field-sample workspace has no records, so nothing comes from it.
 */
import fs from "node:fs"; import path from "node:path";
try { process.loadEnvFile(path.join(process.cwd(), ".env")); } catch { /* settings may come from the environment */ }
const { pool, clearCache, redis } = await import("./db.mjs");

const dir = path.resolve(process.argv[2] ?? "Other Data/DMJM/New/indus delta portal"), ref = path.join(dir, "data", "reference");
const read = (name) => JSON.parse(fs.readFileSync(path.join(ref, name), "utf8"));
if (!fs.existsSync(path.join(ref, "plankton-history.json"))) { console.error(`data/reference/plankton-history.json not found in ${dir}`); process.exit(1); }

/** The observatory's place names, in the order they lie from the Karachi creeks out to sea, with the portal's ids. */
const PLACES = [
  ["Korangi–Phitti", "korangi", "Korangi–Phitti creeks"],
  ["Hajamro Creek", "hajamro", "Hajamro Creek"],
  ["Keti Bandar", "keti", "Keti Bandar"],
  ["all", "offshore-ref", "Offshore reference"],
  ["Offshore comparison", "offshore", "Offshore comparison"],
];
const round = (v, d = 4) => (v == null || !Number.isFinite(v) ? null : +v.toFixed(d));
const monthOf = (date) => date.slice(0, 7);

let docs;
try {
  const hist = read("plankton-history.json"), reference = read("reference.json");
  const rowsOf = (key) => hist.locations[key]?.rows ?? [];
  const all = PLACES.flatMap(([key]) => rowsOf(key).map((r) => monthOf(r.date))).sort();
  if (!all.length) throw new Error("plankton-history.json has no monthly rows");
  const months = []; // every calendar month from the first row to the last, also those the provider returned no row for
  for (let [y, m] = all[0].split("-").map(Number); `${y}-${String(m).padStart(2, "0")}` <= all.at(-1); m === 12 ? (y++, m = 1) : m++) months.push(`${y}-${String(m).padStart(2, "0")}`);
  const points = PLACES.map(([key, id, name]) => {
    const loc = hist.locations[key];
    if (!loc) throw new Error(`plankton-history.json has no location "${key}"`);
    const byMonth = new Map(loc.rows.map((r) => [monthOf(r.date), r]));
    const pixel = loc.rows[0];
    return {
      id, name, source_name: key === "all" ? "All locations (offshore reference)" : key,
      requested: { lat: loc.requested.latitude, lon: loc.requested.longitude },
      pixel: { lat: round(pixel.latitude, 5), lon: round(pixel.longitude, 5) },
      nearby: loc.selection_kind === "nearby_water_pixel",
      offset_km: round(loc.offset_km, 2), basis: loc.selection_basis ?? null,
      values: months.map((m) => round(byMonth.get(m)?.value)),
      rows_returned: loc.rows.length,
    };
  });
  const cells = (list) => list.filter((c) => c.value != null && Number.isFinite(c.value)).map((c) => [round(c.latitude, 5), round(c.longitude, 5), round(c.value)]);
  const chl = reference.chlorophyll;
  const woa = (k) => {
    const w = reference.woa[k];
    return { variable: w.variable, period: w.period, depth_m: w.depth_m, unit: w.unit, cell_deg: w.native_resolution_degrees, cells: cells(w.cells), cells_total: w.cells.length, provider: w.provider, source_url: w.source_url, note: w.note };
  };
  const version = (() => { try { return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).version; } catch { return null; } })();
  docs = {
    points: { months, unit: hist.unit, baseline_years: hist.baseline_years, points },
    chlorophyll: { date: monthOf(chl.date), unit: chl.unit, cell_deg: chl.display_sampling_degrees, cells: cells(chl.cells), cells_total: chl.cells.length },
    nitrate: woa("nitrate"),
    phosphate: woa("phosphate"),
    sources: {
      observatory: { name: "Indus Delta Observatory (DMJM)", version, prepared_on: reference.prepared_on },
      chlorophyll: { provider: chl.provider, dataset_id: chl.dataset_id, variable: chl.variable, resolution_km: chl.native_resolution_km, evidence: chl.evidence_type, source_url: chl.source_url, note: chl.note },
      points: { dataset_id: hist.dataset_id, resolution_km: hist.resolution_km, retrieved_at: hist.retrieved_at, evidence: hist.evidence },
      woa: { provider: reference.woa.nitrate.provider, period: reference.woa.nitrate.period },
    },
  };
} catch (e) { console.error(`Load failed, nothing was changed: ${e.message}`); process.exit(1); }

const db = await pool.connect();
try {
  await db.query(fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
  await db.query("begin");
  await db.query("truncate nutrients_doc");
  for (const [key, body] of Object.entries(docs)) await db.query("insert into nutrients_doc (key, body) values ($1, $2)", [key, JSON.stringify(body)]);
  await db.query("commit");
  const p = docs.points;
  console.log(`${p.points.length} places × ${p.months.length} months (${p.months[0]} to ${p.months.at(-1)}), valid months per place: ${p.points.map((x) => x.values.filter((v) => v != null).length).join(", ")}`);
  console.log(`Chlorophyll map ${docs.chlorophyll.date}: ${docs.chlorophyll.cells.length} of ${docs.chlorophyll.cells_total} pixels with a value; nitrate ${docs.nitrate.cells.length} cells, phosphate ${docs.phosphate.cells.length} cells`);
  console.log(`Cleared ${await clearCache("nutrients").catch(() => 0)} cached answers`);
} catch (e) {
  await db.query("rollback").catch(() => {});
  console.error(`Load failed, nothing was changed: ${e.message}`);
  process.exitCode = 1;
} finally {
  db.release(); await pool.end(); redis.disconnect();
}
