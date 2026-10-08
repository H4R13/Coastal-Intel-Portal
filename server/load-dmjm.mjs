/**
 * Load the plastic debris material (DMJM) into PostgreSQL (dmjm_doc in schema.sql) and clear its cached answers.
 *
 *   node server/load-dmjm.mjs ["Other Data/DMJM"]
 *
 * The data is read out of the team's page, index.html ("Indus Delta Disaster Portal"), where it is written into the
 * script as constants. Stored documents:
 *   stations    sitesData: the sampling stations of the Indus Delta creeks (plastic density, sediment metals, ...)
 *   species     speciesData: microplastics and heavy metals in eight food-web species, by trophic level
 *   hazards     hazardData: the seven hazard pathways and their severity scores
 *   literature  LIT: published microplastic measurements (seawater and sediment sites, fish and crab records) and
 *               the papers they come from
 * The two simulation pages in the folder (plastic debris outlook, biomagnification outlook) hold no data, only
 * formulas with assumed inputs; those formulas are re-implemented in js/plastics/plastics.js.
 */
import fs from "node:fs"; import path from "node:path"; import vm from "node:vm";
try { process.loadEnvFile(path.join(process.cwd(), ".env")); } catch { /* settings may come from the environment */ }
const { pool, clearCache, redis } = await import("./db.mjs");

const dir = path.resolve(process.argv[2] ?? "Other Data/DMJM"), file = path.join(dir, "index.html");
if (!fs.existsSync(file)) { console.error(`index.html not found in ${dir}`); process.exit(1); }
const page = fs.readFileSync(file, "utf8");

/** The value of `const <name> = [...]` or `{...}` in the page's script (a JavaScript literal, not always JSON). */
function constant(name) {
  const start = page.indexOf(`const ${name} = `);
  if (start < 0) throw new Error(`index.html has no "const ${name}"`);
  const from = start + `const ${name} = `.length, close = page[from] === "[" ? "]" : "}";
  for (let end = page.indexOf(`${close};`, from); end >= 0; end = page.indexOf(`${close};`, end + 1)) {
    try { return vm.runInNewContext(`(${page.slice(from, end + 1)})`, {}, { timeout: 2000 }); } catch { /* that was not the end of the literal: try the next one */ }
  }
  throw new Error(`could not read "const ${name}" from index.html`);
}

let docs;
try {
  const lit = constant("LIT"), source = (k) => lit.ref[k]?.t ?? k;
  docs = {
    stations: { rows: constant("sitesData") },
    species: { rows: constant("speciesData") },
    hazards: { rows: constant("hazardData").map((h) => ({ hazard: h.title, category: h.category, severity: parseFloat(h.severity_score), severity_label: h.severity_label, receptor: h.receptor, metric: h.metric, synopsis: h.synopsis })) },
    literature: {
      references: Object.values(lit.ref).map((r) => ({ reference: r.t, link: r.u })),
      sites: lit.abio.map((s) => ({ site: s.n, province: s.p, lat: s.lat, lon: s.lon, seawater_particles_per_l: s.w, sediment_particles_per_kg: s.s, source: source("A21") })), // the page credits every one of these sites to A21
      biota: lit.biota.flatMap((b) => b.r.map((r) => ({ area: b.n, lat: b.lat, lon: b.lon, species: r.sp, common_name: r.cn, trophic_level: r.tl, tissue: r.ti, value: r.v, unit: r.u, source: source(r.ref) }))),
    },
  };
} catch (e) { console.error(`Load failed, nothing was changed: ${e.message}`); process.exit(1); }

const db = await pool.connect();
try {
  await db.query(fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
  await db.query("begin");
  await db.query("truncate dmjm_doc");
  for (const [key, body] of Object.entries(docs)) await db.query("insert into dmjm_doc (key, body) values ($1, $2)", [key, JSON.stringify(body)]);
  await db.query("commit");
  console.log(`${docs.stations.rows.length} stations, ${docs.species.rows.length} species, ${docs.hazards.rows.length} hazards; literature: ${docs.literature.sites.length} sites, ${docs.literature.biota.length} fish and crab records, ${docs.literature.references.length} papers`);
  console.log(`Cleared ${await clearCache("dmjm").catch(() => 0)} cached answers`);
} catch (e) {
  await db.query("rollback").catch(() => {});
  console.error(`Load failed, nothing was changed: ${e.message}`);
  process.exitCode = 1;
} finally {
  db.release(); await pool.end(); redis.disconnect();
}
