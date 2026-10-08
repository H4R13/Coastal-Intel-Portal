/**
 * Draw every hazard map of the saltwater intrusion package ahead (js/amib/hazards.js): each variant under each
 * emissions scenario, for every year the timeline can show (1990–2050). The images go to .amibcache/, so
 * switching a hazard, a scenario key or playing the timeline never waits for a drawing.
 *
 *   node server/warm-amib.mjs            the main measure of each hazard (about 1,000 images, a few minutes)
 *   node server/warm-amib.mjs --all      every measure as well (groundwater type and chance maps)
 *
 * Images already cached are skipped, so it can be stopped and run again. Run it after load:amib.
 */
import path from "node:path";
try { process.loadEnvFile(path.join(process.cwd(), ".env")); } catch { /* settings may come from the environment */ }
const { pool, query, redis } = await import("./db.mjs");
const { amibImage, amibImageReady, hexToRgb, closeAmibPool } = await import("./amib.mjs");
const { HAZARDS, SSPS } = await import("../js/amib/hazards.js");
const { resolveHazard, hiddenStops, clearsBackground } = await import("../js/amib/amibData.js");

const all = process.argv.includes("--all");
const catalog = (await query("select body from amib_doc where key = 'catalog'")).rows[0]?.body;
if (!catalog) { console.error("The package is not loaded: run npm run load:amib first"); process.exit(1); }

// every image a hazard can show between 1990 and 2050, whatever is chosen in the panel
const wanted = new Map();
const portal = { amib: { hazards: "all" } };
for (const h of HAZARDS) for (const [variant] of h.variants.entries()) for (const m of all ? h.measures ?? [null] : [h.measures?.[0] ?? null]) for (const s of SSPS) {
  for (let year = 1990; year <= 2050; year++) {
    const r = resolveHazard(catalog, portal, { hazard: h.id, variant, measure: m?.id }, s.id, year);
    if (r?.L) wanted.set(`${r.L.id}/${r.step}`, { L: r.L, step: r.step });
  }
}
console.log(`${wanted.size} hazard images to check`);

let drawn = 0, skipped = 0, missing = 0, done = 0;
const started = Date.now();
const todo = [...wanted.values()];
async function worker() {
  for (let job = todo.shift(); job; job = todo.shift()) {
    const { L, step } = job;
    const opts = { clearBackground: clearsBackground(L), hideColors: hiddenStops(L).map((c) => hexToRgb(c.color.replace("#", "").toLowerCase())) }; // as the map asks for it (imageUrl in js/amib/amibData.js)
    if (amibImageReady(L.id, step, opts)) skipped++;
    else if (await amibImage(L.id, step, opts)) drawn++;
    else missing++;
    if (++done % 20 === 0 || !todo.length) process.stdout.write(`\r${done}/${wanted.size} · drawn ${drawn} · already cached ${skipped}   `);
  }
}
await Promise.all(Array.from({ length: 6 }, worker)); // a few more than the pool, so it never waits for work
console.log(`\n${drawn} drawn, ${skipped} already cached${missing ? `, ${missing} without a file` : ""} · ${Math.round((Date.now() - started) / 1000)} s`);
await closeAmibPool(); await pool.end(); redis.disconnect();
