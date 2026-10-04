/**
 * Register the saltwater intrusion / salinity package (AMIB) in PostgreSQL (amib_doc in schema.sql) and clear its
 * cached answers.
 *
 *   node server/load-amib.mjs ["Other Data/AMIB"]        (or set AMIB_DIR in .env)
 *
 * The package's catalog.json lists every layer. Its rasters are too large for the database, so only their
 * description goes in: the catalog (with each map's bounds read from the image header), the image file behind every
 * time step, the chart series and the small vector files. server/amib.mjs turns the pre-coloured images into PNGs
 * on request.
 */
import fs from "node:fs"; import path from "node:path";
import { fromFile } from "geotiff";
try { process.loadEnvFile(path.join(process.cwd(), ".env")); } catch { /* settings may come from the environment */ }
const { pool, clearCache, redis } = await import("./db.mjs");

const dir = path.resolve(process.argv[2] ?? process.env.AMIB_DIR ?? "Other Data/AMIB");
if (!fs.existsSync(path.join(dir, "catalog.json"))) { console.error(`catalog.json not found in ${dir}`); process.exit(1); }
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(dir, rel), "utf8"));
const catalog = readJson("catalog.json");

const docs = [], layers = [], missing = [];
for (const l of catalog.layers) {
  const isMap = l.type === "raster" || l.type === "raster-timeseries";
  const entry = { id: l.id, product: l.product, type: l.type, group: l.group, subgroup: l.subgroup, name: l.name ?? l.title, what: l.what, units: l.units, kind: l.kind, classes: l.classes, legend: l.legend, label: l.label, scenario: l.scenario, year: l.year, note: l.display_resampled ?? l.note ?? null, time_step: l.time_step };
  if (isMap) {
    const steps = l.steps ?? [{ styled: l.styled }];
    const first = path.join(dir, steps[0].styled ?? "");
    if (!steps[0].styled || !fs.existsSync(first)) { missing.push(l.id); continue; }
    const img = await (await fromFile(first)).getImage();
    entry.bounds = img.getBoundingBox().map((v) => +v.toFixed(6));
    if (l.steps) entry.steps = l.steps.map((s) => ({ t: s.year ?? s.month ?? s.date ?? s.step ?? null, kind: s.kind }));
    docs.push([`files/${l.id}`, steps.map((s) => s.styled)]);
  }
  if (l.type === "vector") { if (!fs.existsSync(path.join(dir, l.file))) { missing.push(l.id); continue; } docs.push([`vector/${l.id}`, readJson(l.file)]); entry.geometry = l.geometry; }
  if (l.type.startsWith("section")) continue; // vertical cross-sections are not map layers; not used by the portal yet
  if (l.type === "table") continue;
  layers.push(entry);
}
docs.push(["catalog", { labels: catalog.labels, layers }]);
const series = readJson("timeseries/timeseries.json");
for (const [product, indicators] of Object.entries(series)) docs.push([`series/${product}`, indicators]);

const db = await pool.connect();
try {
  await db.query(fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
  await db.query("begin");
  await db.query("truncate amib_doc");
  for (const [key, body] of docs) await db.query("insert into amib_doc (key, body) values ($1, $2)", [key, JSON.stringify(body)]);
  await db.query("commit");
  const maps = layers.filter((l) => l.bounds);
  console.log(`${layers.length} layers registered: ${maps.length} maps (${maps.filter((l) => l.steps).length} year by year, ${maps.reduce((n, l) => n + (l.steps?.length ?? 1), 0)} images), ${layers.length - maps.length} vectors; chart series for ${Object.keys(series).length} products`);
  if (missing.length) console.log(`Skipped ${missing.length} layers whose files are missing: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? " ..." : ""}`);
  console.log(`Cleared ${await clearCache("amib").catch(() => 0)} cached answers`);
} catch (e) {
  await db.query("rollback").catch(() => {});
  console.error(`Load failed, nothing was changed: ${e.message}`);
  process.exitCode = 1;
} finally {
  db.release(); await pool.end(); redis.disconnect();
}
