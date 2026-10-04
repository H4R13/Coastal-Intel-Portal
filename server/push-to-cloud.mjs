/**
 * Copy this PC's portal database to the hosted one (for the Vercel deployment), and the ready-made mangrove pictures
 * to the hosted cache.
 *
 *   node server/push-to-cloud.mjs [--with-ocean]
 *
 * Reads from the local database (PG* settings in .env) and writes to CLOUD_DATABASE_URL; CLOUD_REDIS_URL is optional.
 * Both go in .env, which is never committed. The hosted tables are emptied and refilled, so it is safe to run again.
 *
 * The ocean package (ocean_doc: Ocean and Fisheries layers) is NOT copied unless --with-ocean is given. Its licence
 * forbids publishing or distributing the files without written permission from the copyright holders, and a public
 * website serves them to anyone. Get that permission first.
 */
import fs from "node:fs"; import path from "node:path";
import pg from "pg"; import Redis from "ioredis";
try { process.loadEnvFile(path.join(process.cwd(), ".env")); } catch { /* settings may come from the environment */ }

const url = process.env.CLOUD_DATABASE_URL;
if (!url) { console.error("CLOUD_DATABASE_URL is not set in .env (the hosted database's connection string)"); process.exit(1); }
const withOcean = process.argv.includes("--with-ocean");
const local = new pg.Pool({ max: 2 });
const cloud = new pg.Pool({ connectionString: url, ssl: /@(localhost|127\.0\.0\.1)[:/]/.test(url) ? false : { rejectUnauthorized: false }, max: 2 }); // hosted databases need TLS

// table → columns; geometry travels as text (EWKB hex) and is cast back on arrival
const TABLES = {
  layer_info: ["layer", "info::text", "loaded_at"],
  mangrove_area: ["scenario", "year", "area_km2"],
  amib_doc: ["key", "body::text"],
  dmjm_doc: ["key", "body::text"],
  ...(withOcean ? { ocean_doc: ["key", "body::text"] } : {}),
  erosion_area: ["kind", "start_yr", "end_yr", "geom::text"],
  mangrove_extent: ["scenario", "year", "geom::text"],
};
const BATCH = 1500;

try {
  await cloud.query(fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
  for (const [table, cols] of Object.entries(TABLES)) {
    const names = cols.map((c) => c.split("::")[0]);
    const total = +(await local.query(`select count(*) n from ${table}`)).rows[0].n;
    await cloud.query(`truncate ${table}`);
    for (let offset = 0; offset < total; offset += BATCH) {
      const { rows } = await local.query({ text: `select ${cols.join(", ")} from ${table} order by ${names.includes("geom") ? "id" : "1, 2"} limit ${BATCH} offset ${offset}`, rowMode: "array" });
      const values = rows.flat(), w = names.length;
      const tuples = rows.map((_, r) => `(${names.map((_, c) => `$${r * w + c + 1}`).join(", ")})`).join(", ");
      await cloud.query(`insert into ${table} (${names.join(", ")}) values ${tuples}`, values);
      process.stdout.write(`\r${table}: ${Math.min(offset + BATCH, total)} / ${total}   `);
    }
    console.log(`\r${table}: ${total} rows copied        `);
  }
  if (!withOcean) { await cloud.query("truncate ocean_doc"); console.log("ocean_doc: left empty (licence; see the note at the top of this file)"); }
  await cloud.query("analyze");

  if (process.env.CLOUD_REDIS_URL) {
    const from = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379"), to = new Redis(process.env.CLOUD_REDIS_URL);
    const stale = await to.keys("pakcoast:*"); // answers cached from an older copy of the data
    if (stale.length) await to.del(...stale);
    const keys = await from.keys("pakcoast:mangroves:change:*");
    for (const k of keys) await to.set(k, await from.getBuffer(k));
    console.log(`cache: ${stale.length} old answers cleared, ${keys.length} mangrove pictures copied`);
    from.disconnect(); to.disconnect();
  } else console.log("cache: CLOUD_REDIS_URL not set, skipped");
} catch (e) {
  console.error(`\nCopy failed: ${e.message}`);
  process.exitCode = 1;
} finally {
  await local.end(); await cloud.end();
}
