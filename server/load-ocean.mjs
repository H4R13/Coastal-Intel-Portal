/**
 * Load the ocean pH / warming / oxygen / fisheries package into PostgreSQL (ocean_doc in schema.sql) and clear
 * its cached answers.
 *
 *   node server/load-ocean.mjs ["Other Data/AMHK/ndma-ocean-portal-data-main"]
 *
 * The package's catalog.json lists every layer; this reads each layer's file and stores it under the key the API
 * serves. GeoTIFFs are decoded here into plain grids (values row by row from the north, null = no data), so the
 * server never needs the original files. Their licence forbids sharing them: keep them out of git and public folders.
 */
import fs from "node:fs"; import path from "node:path";
import { fromFile } from "geotiff";
try { process.loadEnvFile(path.join(process.cwd(), ".env")); } catch { /* settings may come from the environment */ }
const { pool, clearCache, redis } = await import("./db.mjs");

const dir = path.resolve(process.argv[2] ?? "Other Data/AMHK/ndma-ocean-portal-data-main");
if (!fs.existsSync(path.join(dir, "catalog.json"))) { console.error(`catalog.json not found in ${dir}`); process.exit(1); }
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(dir, rel), "utf8"));

async function readGrid(rel) {
  const img = await (await fromFile(path.join(dir, rel))).getImage();
  const [west, south, east, north] = img.getBoundingBox();
  const data = (await img.readRasters({ interleave: true }));
  const nodata = img.getGDALNoData();
  return { width: img.getWidth(), height: img.getHeight(), bounds: [west, south, east, north], values: Array.from(data, (v) => (Number.isFinite(v) && v !== nodata ? +v.toPrecision(7) : null)) };
}

const catalog = readJson("catalog.json");
const steps = Object.fromEntries([...fs.readFileSync(path.join(dir, "README.md"), "utf8").matchAll(/^### Step (\d+): (.+)$/gm)].map((m) => [m[1], m[2].trim()]));
const docs = [["catalog", { project: catalog.project, updated: catalog.updated, steps, layers: catalog.layers }]];
const counts = { raster: 0, data: 0, overlay: 0, vector: 0 };

for (const l of catalog.layers) {
  if (l.type === "raster") { docs.push([`raster/${l.id}`, await readGrid(l.path)]); counts.raster++; }
  if (l.type === "raster_series") for (const y of l.years) { docs.push([`raster/${l.id}/${y}`, await readGrid(l.path.replace("{year}", y))]); counts.raster++; }
  if (l.type === "vector") { docs.push([`vector/${l.id}`, readJson(l.path)]); counts.vector++; }
  if (l.type === "timeseries" || l.type === "table") { docs.push([`data/${l.id}`, readJson(l.path.replace(/\.csv$/, ".json"))]); counts.data++; }
  if (l.overlay) { docs.push([`overlay/${l.id}`, readJson(l.overlay.path)]); counts.overlay++; }
}
if (fs.existsSync(path.join(dir, "chart_style.json"))) docs.push(["chart_style", readJson("chart_style.json")]);
if (fs.existsSync(path.join(dir, "findings/findings.json"))) docs.push(["findings", readJson("findings/findings.json")]);

const db = await pool.connect();
try {
  await db.query(fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
  await db.query("begin");
  await db.query("truncate ocean_doc");
  for (const [key, body] of docs) await db.query("insert into ocean_doc (key, body) values ($1, $2)", [key, JSON.stringify(body)]);
  await db.query("commit");
  console.log(`${catalog.layers.length} layers: ${counts.raster} grids, ${counts.data} chart/table files, ${counts.overlay} dot overlays, ${counts.vector} boundaries`);
  console.log(`Cleared ${await clearCache("ocean").catch(() => 0)} cached answers`);
} catch (e) {
  await db.query("rollback").catch(() => {});
  console.error(`Load failed, nothing was changed: ${e.message}`);
  process.exitCode = 1;
} finally {
  db.release(); await pool.end(); redis.disconnect();
}
