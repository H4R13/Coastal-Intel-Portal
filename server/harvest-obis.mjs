/**
 * Harvest plankton occurrence records from OBIS (https://api.obis.org/v3, public, no key) for the NDMA study rectangle
 * 60-70 E, 20-27 N from 1950, one raw JSON file per taxonomic group, saved unedited, plus a screening summary.
 *
 *   node server/harvest-obis.mjs      -> data/ndma-field/obis/<group>.json and summary.json
 *
 * Occurrences are PRESENCE records, not abundance or concentration. Nothing is deleted: OBIS quality flags are counted,
 * not used to drop rows. The rectangle includes waters outside Pakistan.
 */
import fs from "node:fs"; import path from "node:path";
const OUT = path.resolve("data", "ndma-field", "obis"); fs.mkdirSync(OUT, { recursive: true });
const GEOM = "POLYGON ((60 20,70 20,70 27,60 27,60 20))";
const GROUPS = ["Bacillariophyceae", "Dinophyceae", "Cyanobacteria", "Prymnesiophyceae", "Raphidophyceae", "Dictyochophyceae", "Copepoda", "Noctilucales", "Chaetocerotales", "Zooplankton"];

async function get(url, tries = 3) {
  for (let k = 0; k < tries; k++) {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(60000) }); if (r.ok) return r.json(); throw new Error(`HTTP ${r.status}`); }
    catch (e) { if (k === tries - 1) throw e; await new Promise((s) => setTimeout(s, 2000 * (k + 1))); }
  }
}
const summary = { retrieved_at: new Date().toISOString(), geometry: GEOM, startdate: "1950-01-01", groups: {} };
for (const name of GROUPS) {
  const rows = []; let after = null, total = null, status = "ok";
  try {
    for (;;) {
      const q = new URLSearchParams({ geometry: GEOM, startdate: "1950-01-01", scientificname: name, size: "5000" }); if (after) q.set("after", after);
      const j = await get(`https://api.obis.org/v3/occurrence?${q}`);
      total ??= j.total; rows.push(...j.results);
      if (!j.results.length || rows.length >= total) break;
      after = j.results.at(-1).id;
    }
  } catch (e) { status = `failed: ${e.message}`; }
  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify({ query: { geometry: GEOM, startdate: "1950-01-01", scientificname: name }, retrieved_at: summary.retrieved_at, api_total: total, results: rows }));
  const flags = {}; let yearOnly = 0, noCoord = 0; const datasets = new Set(), years = [];
  for (const r of rows) {
    (r.flags ?? []).forEach((f) => { flags[f] = (flags[f] ?? 0) + 1; });
    if (r.dataset_id) datasets.add(r.dataset_id);
    if (r.date_year ?? r.year) years.push(+(r.date_year ?? r.year));
    if (r.eventDate && /^\d{4}$/.test(String(r.eventDate))) yearOnly++;
    if (r.decimalLatitude == null || r.decimalLongitude == null) noCoord++;
  }
  summary.groups[name] = { status, api_total: total, downloaded: rows.length, flags, year_only_dates: yearOnly, no_coordinates: noCoord, datasets: datasets.size, years: years.length ? [Math.min(...years), Math.max(...years)] : null };
  console.log(name, JSON.stringify(summary.groups[name]));
}
fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 1));
