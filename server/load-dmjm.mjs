/**
 * Load the plastic debris material (DMJM) into PostgreSQL (dmjm_doc in schema.sql) and clear its cached answers.
 *
 *   node server/load-dmjm.mjs ["Other Data/DMJM"]
 *
 * Stored documents:
 *   surveys     rows of the beach survey CSV (a demo dataset: its source references are not recorded in the file)
 *   projection  projection_2050.json, the scenario simulation made from those surveys by simulate-2050.mjs
 * The two simulation pages in the folder (plastic debris outlook, biomagnification outlook) hold no data, only
 * formulas with assumed inputs; those formulas are re-implemented in js/plastics/plastics.js.
 */
import fs from "node:fs"; import path from "node:path";
try { process.loadEnvFile(path.join(process.cwd(), ".env")); } catch { /* settings may come from the environment */ }
const { pool, clearCache, redis } = await import("./db.mjs");

const dir = path.resolve(process.argv[2] ?? "Other Data/DMJM");
const csvName = fs.existsSync(dir) && fs.readdirSync(dir).find((f) => /Plastic_Debris.*\.csv$/i.test(f));
if (!csvName || !fs.existsSync(path.join(dir, "projection_2050.json"))) { console.error(`Survey CSV or projection_2050.json not found in ${dir}`); process.exit(1); }

const [head, ...lines] = fs.readFileSync(path.join(dir, csvName), "utf8").trim().split(/\r?\n/);
const cols = head.split(",");
const surveys = lines.map((line) => Object.fromEntries(line.split(",").map((v, i) => [cols[i], v !== "" && !Number.isNaN(+v) ? +v : v])));
const projection = JSON.parse(fs.readFileSync(path.join(dir, "projection_2050.json"), "utf8"));

const db = await pool.connect();
try {
  await db.query(fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
  await db.query("begin");
  await db.query("truncate dmjm_doc");
  for (const [key, body] of [["surveys", { file: csvName, rows: surveys }], ["projection", projection]]) await db.query("insert into dmjm_doc (key, body) values ($1, $2)", [key, JSON.stringify(body)]);
  await db.query("commit");
  console.log(`${surveys.length} surveys at ${new Set(surveys.map((r) => r.coastal_site)).size} sites; projection for ${Object.keys(projection.sites).length} sites, ${projection.scenarios.length} scenarios, ${projection.years[0]}-${projection.years.at(-1)}`);
  console.log(`Cleared ${await clearCache("dmjm").catch(() => 0)} cached answers`);
} catch (e) {
  await db.query("rollback").catch(() => {});
  console.error(`Load failed, nothing was changed: ${e.message}`);
  process.exitCode = 1;
} finally {
  db.release(); await pool.end(); redis.disconnect();
}
