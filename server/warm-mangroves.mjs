/**
 * Draw every mangrove change picture once and keep it in the cache, so playing the timeline never waits for one.
 *
 *   node server/warm-mangroves.mjs
 *
 * Run it after loading the mangrove shapes (load-mangroves.mjs clears the old pictures). Takes a few minutes.
 */
import path from "node:path";
try { process.loadEnvFile(path.join(process.cwd(), ".env")); } catch { /* settings may come from the environment */ }
const { pool, query, redis, PREFIX } = await import("./db.mjs");
const { mangroveChangeImage, FRAMES } = await import("./mangrove-change.mjs");

const { rows } = await query("select distinct scenario, year from mangrove_extent order by year, scenario");
const base = rows.find((r) => r.scenario === "observed")?.year;
if (!base) { console.error("No mangrove shapes loaded: run load:mangroves first"); process.exit(1); }
let n = 0, bytes = 0;
const started = Date.now();
for (const { scenario, year } of rows) {
  for (const frame of Object.keys(FRAMES)) {
    const png = await mangroveChangeImage(frame, scenario, year, base);
    await redis.set(`${PREFIX}mangroves:change:${frame}:${scenario}:${year}`, png);
    n++; bytes += png.length;
  }
  process.stdout.write(`\r${scenario} ${year}   `);
}
console.log(`\n${n} pictures, ${(bytes / 1e6).toFixed(1)} MB, ${Math.round((Date.now() - started) / 1000)} s`);
await pool.end(); redis.disconnect();
