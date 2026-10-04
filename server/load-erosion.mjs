/**
 * Load the team's coastal-erosion layers into PostgreSQL (erosion_area in schema.sql) and clear their cached answers.
 *
 *   node server/load-erosion.mjs ["Other Data/AMSK/Erosion with transition/Erosion 01"]
 *
 * Reads, from that folder:
 *   Erosion_Pakistan_Cleaned_<from>_<to>.shp   land lost in each mapped period
 *   Erosion_Projected_2050.shp                 the same periods plus yearly projected steps to 2050 (CA-Markov);
 *                                              only its projected steps are taken, the mapped periods come from the files above.
 *                                              The 2025/2035/2045 files are subsets of it and are not needed.
 * Each polygon carries start_yr and end_yr. A reload replaces the previous contents.
 */
import fs from "node:fs"; import path from "node:path";
import * as shp from "shapefile";
try { process.loadEnvFile(path.join(process.cwd(), ".env")); } catch { /* settings may come from the environment */ }
const { pool, clearCache, redis } = await import("./db.mjs");
const shapefile = shp.default ?? shp;

const dir = path.resolve(process.argv[2] ?? "Other Data/AMSK/Erosion with transition/Erosion 01");
if (!fs.existsSync(dir)) { console.error(`Folder not found: ${dir}`); process.exit(1); }

const INSERT = `
  insert into erosion_area (kind, start_yr, end_yr, geom)
  select $1::text, r.s, r.e, d.geom
  from unnest($2::int[], $3::int[], $4::text[]) as r(s, e, j)
  cross join lateral ST_Subdivide(ST_Transform(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(r.j), 4326)), 3), 3857), 256) as piece
  cross join lateral ST_Dump(piece) as d
  where GeometryType(d.geom) = 'POLYGON'`;

async function loadShapes(db, file, kind, keep) {
  const src = await shapefile.open(file);
  if (Math.abs(src.bbox[0]) > 180) throw new Error(`${path.basename(file)} is not in longitude/latitude (EPSG:4326) as expected`);
  let s = [], e = [], j = [], pieces = 0;
  const flush = async () => { if (j.length) { pieces += (await db.query(INSERT, [kind, s, e, j])).rowCount; s = []; e = []; j = []; } };
  for (let r = await src.read(); !r.done; r = await src.read()) {
    const p = r.value.properties;
    if (!r.value.geometry || !keep(p)) continue;
    s.push(+p.start_yr); e.push(+p.end_yr); j.push(JSON.stringify(r.value.geometry));
    if (j.length >= 500) await flush();
  }
  await flush();
  console.log(`  ${kind.padEnd(9)} ${path.basename(file).padEnd(42)} ${String(pieces).padStart(6)} pieces`);
}

const db = await pool.connect();
try {
  await db.query(fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
  await db.query("begin");
  await db.query("truncate erosion_area");

  const observed = fs.readdirSync(dir).filter((f) => /^Erosion_Pakistan_Cleaned_\d{4}_\d{4}\.shp$/.test(f)).sort();
  for (const f of observed) await loadShapes(db, path.join(dir, f), "observed", () => true);
  const lastObserved = (await db.query("select max(end_yr) as y from erosion_area")).rows[0].y;
  await loadShapes(db, path.join(dir, "Erosion_Projected_2050.shp"), "projected", (p) => +p.start_yr >= lastObserved);

  const info = {
    source: "Eroded-area polygons by period supplied by the project team",
    method: "Steps after the last mapped period were projected by the team with a Cellular Automata-Markov model.",
  };
  await db.query("insert into layer_info (layer, info) values ('erosion', $1) on conflict (layer) do update set info = excluded.info, loaded_at = now()", [info]);
  await db.query("commit");
  await db.query("analyze erosion_area");
  console.log(`Cleared ${await clearCache("erosion").catch(() => 0)} cached answers`);
} catch (e) {
  await db.query("rollback").catch(() => {});
  console.error(`Load failed, nothing was changed: ${e.message}`);
  process.exitCode = 1;
} finally {
  db.release(); await pool.end(); redis.disconnect();
}
