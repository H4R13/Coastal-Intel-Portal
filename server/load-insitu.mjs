/**
 * Build the portal's "measured in the water" data from the accepted rows of the field-data intake table
 * (delivered by DMJM's agent through the room: Field_Data_Intake.csv, 24 columns + evidence_type).
 *
 *   node server/load-insitu.mjs [path/to/Field_Data_Intake.csv]      (npm run load:insitu)
 *
 * Default input: <room folder>/files/Field_Data_Intake.csv, else the NDMA package's Data/07_Field_Data/Field_Data_Intake.csv.
 * Writes data/ndma/insitu.json (nothing goes into PostgreSQL), served at /api/ndma/insitu:
 *   variables   per variable: rows, stations, units found, years, rows per decade, evidence types
 *   plankton    presence records (variable plankton_taxon_presence) gathered into 0.25-degree cells: records, taxa, years.
 *               Presence only: no abundance is ever made from it.
 *   measured    every other in-situ row with a value (nitrate, phosphate, oxygen ...) as a point; original value and unit kept
 *   sources     rows per source_id
 * Rows with an empty value are kept only for plankton presence; for every other variable an empty value is not a measurement and is skipped
 * (counted in `skipped`). Nothing is converted, interpolated or filled in.
 */
import fs from "node:fs"; import path from "node:path"; import zlib from "node:zlib";
const home = process.env.USERPROFILE ?? process.cwd();
const candidates = [process.argv[2], path.join(home, "Documents", "Codex", "NDMA_shared_mailbox", "files", "Field_Data_Intake.csv"),
  path.join(home, "Desktop", "NDMA_Coastal_Eutrophication", "NDMA_Coastal_Eutrophication", "Data", "07_Field_Data", "Field_Data_Intake.csv")].filter(Boolean);
const file = candidates.find((f) => fs.existsSync(f));
if (!file) { console.error(`Field_Data_Intake.csv not found. Looked in:\n  ${candidates.join("\n  ")}`); process.exit(1); }

/** A CSV parser that understands quotes, doubled quotes and line breaks inside quotes. */
function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); cell = ""; if (row.length > 1 || row[0] !== "") rows.push(row); row = []; }
    else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
/** Calls onRow(cells) for every record of a CSV file, read in chunks (the intake passed 200 MB with the NASEER profiles; a whole-file parse ran out of memory). */
async function eachRow(f, onRow) {
  let row = [], cell = "", q = false, first = true;
  for await (const chunk of fs.createReadStream(f, { encoding: "utf8", highWaterMark: 1 << 20 })) {
    let s = chunk; if (first) { s = s.replace(/^﻿/, ""); first = false; }
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q === "end?") { q = false; if (c === '"') { cell += '"'; q = true; continue; } } // a quote that ended the last chunk: doubled ("") or closing
      if (q) { if (c === '"') { if (i + 1 === s.length) q = "end?"; else if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
      if (c === '"') q = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") { if (cell !== "" || row.length) { row.push(cell); if (row.length > 1 || row[0] !== "") onRow(row); } row = []; cell = ""; }
      else cell += c;
    }
  }
  if (cell !== "" || row.length) { row.push(cell); onRow(row); }
}
let head = null; const body = { length: 0 };
const need = ["longitude", "latitude", "variable", "value", "unit", "sample_datetime", "depth_m", "taxon", "source_id", "evidence_type"];
let col = null;
/* the registry (same folder) says which rows lie within 100 km of the Pakistan shore; the licence table names the datasets */
const readTable = (name) => { const f = path.join(path.dirname(file), name); if (!fs.existsSync(f)) return null; const [h, ...r] = parseCsv(fs.readFileSync(f, "utf8").replace(/^﻿/, "")); return r.map((x) => Object.fromEntries(h.map((k, i) => [k, x[i]]))); };
const regFile = path.join(path.dirname(file), "Source_Record_Registry.csv"), registry = fs.existsSync(regFile), coastal = new Map();
if (registry) { let rh = null; await eachRow(regFile, (r) => { if (!rh) { rh = Object.fromEntries(r.map((h, i) => [h, i])); return; } if (r[rh.status] === "accepted") coastal.set(r[rh.sample_id], /^(true|1)$/i.test(r[rh.coastal_100km] ?? "")); }); }
const licences = new Map((readTable("OBIS_dataset_licences.csv") ?? []).map((r) => [r.dataset_id, r]));
/* The same unit spelt differently is one unit (no number changes): µmol/kg written four ways, psu in two cases, and µ garbled by a
   Windows code page ("Î¼"). ‰ stays apart from psu, mg/l apart from µmol/kg: those are different quantities. The source text is kept as unit_src. */
const UNIT = { "micromole/kg": "µmol/kg", "µmol kg-1": "µmol/kg", "umol/kg": "µmol/kg", "µmol/kg": "µmol/kg", "psu": "psu", "PSU": "psu", "PSS-78": "psu", "degreesC": "°C", "degC": "°C", "mg/m^3": "mg/m3", "mg m-3": "mg/m3", "ug/l": "mg/m3", "µg/l": "mg/m3", "ug/L": "mg/m3", "µg/L": "mg/m3", "(n/a)": "unitless" }; // 1 µg/l = 1 mg/m³ exactly; pH has no unit
const normUnit = (u) => { const f = u.replace(/Î¼|Âµ/g, "µ").replace(/μ/g, "µ").trim(); return UNIT[f] ?? f; };
const HOLD = ["CALIBRATION_NOT_VERIFIED"];
/** A readable name for a source_id, for summaries (the ids themselves stay in the rows). */
const srcName = (id) => [[/^Argo/i, "Argo floats"], [/^10\.25921\//, "GLODAP ship bottles"], [/^NCEI|naseer/i, "NASEER ship casts (NCEI)"], [/SeaBASS/i, "NASA SeaBASS"], [/PANGAEA/i, "PANGAEA tables"], [/zenodo\.18987632/, "Kalmat study (Zenodo)"], [/^WOD|ocldb/i, "World Ocean Database"], [/obis/i, "OBIS"], [/gbif/i, "GBIF"]].find(([re]) => re.test(id))?.[1] ?? id;
const cellDeg = 0.25, decadeOf = (y) => `${Math.floor(y / 10) * 10}s`;
const out = { built_at: new Date().toISOString(), source_file: file, rows: 0, skipped: { no_coordinates: 0, outside_box: 0, empty_value_not_plankton: 0, bad_value: 0 },
  variables: {}, plankton: { cell_deg: cellDeg, records: 0, coastal_records: 0, cells: [], taxa: 0 }, measured: [], sources: {}, datasets: [], registry };
const cells = new Map(), taxa = new Set(), decades = {}, taxaCount = {}, statAcc = {}; // statAcc: every accepted reading per variable|unit|depth band, before any thinning (for Hela)
await eachRow(file, (r) => {
  if (!head) {
    head = r; const miss = need.filter((n) => !head.includes(n));
    if (miss.length) { console.error(`The intake lacks the columns: ${miss.join(", ")}`); process.exit(1); }
    col = Object.fromEntries(head.map((h, i) => [h, i])); return;
  }
  body.length++; out.rows++;
  row(r);
});
function row(r) {
  const g = (k) => (r[col[k]] ?? "").trim();
  const lon = parseFloat(g("longitude")), lat = parseFloat(g("latitude")), v = g("variable"), val = g("value"), src = g("source_id") || "unknown";
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) { out.skipped.no_coordinates++; return; }
  if (lon < 60 || lon > 70 || lat < 20 || lat > 27) { out.skipped.outside_box++; return; }
  const year = parseInt(g("sample_datetime").slice(0, 4), 10), ok = Number.isFinite(year);
  const plank = v === "plankton_taxon_presence";
  if (!plank && val === "") { out.skipped.empty_value_not_plankton++; return; }
  /* MAIN's holds (2026-11-10): sensor values whose calibration the source does not establish (NASEER CTD oxygen, up to 8.8 ml/L at the surface) */
  if (HOLD.some((h) => g("quality_flag").includes(h))) { out.skipped.held_by_main = (out.skipped.held_by_main ?? 0) + 1; return; }
  /* MAIN's hold (2026-11-11): float chlorophyll as processed in the World Ocean Database. The same profiles are in the Argo data
     centre's adjusted files (already accepted) and WOD's values are about two-thirds of those (median ratio 0.67 over 2,851
     same-day, same-place, same-depth pairs): one float, two calibrations. The Argo data centre's adjusted values are kept. */
  if (v === "chlorophyll_a_insitu" && g("instrument") === "WOD PFL") { out.skipped.held_wod_float_chl = (out.skipped.held_wod_float_chl ?? 0) + 1; return; }
  if (!plank && !Number.isFinite(parseFloat(val))) { out.skipped.bad_value++; return; }
  const V = (out.variables[v] ??= { rows: 0, stations: new Set(), units: new Set(), years: [9999, 0], decades: {}, evidence: {} });
  V.rows++; V.stations.add(`${lat.toFixed(3)},${lon.toFixed(3)}`); if (g("unit")) V.units.add(normUnit(g("unit")));
  if (ok) { V.years = [Math.min(V.years[0], year), Math.max(V.years[1], year)]; V.decades[decadeOf(year)] = (V.decades[decadeOf(year)] ?? 0) + 1; }
  V.evidence[g("evidence_type") || "unlabelled"] = (V.evidence[g("evidence_type") || "unlabelled"] ?? 0) + 1;
  out.sources[src] = (out.sources[src] ?? 0) + 1;
  if (plank) {
    const key = `${Math.floor(lat / cellDeg)},${Math.floor(lon / cellDeg)}`, c = cells.get(key) ?? { lat: (Math.floor(lat / cellDeg) + 0.5) * cellDeg, lon: (Math.floor(lon / cellDeg) + 0.5) * cellDeg, n: 0, coastal: 0, taxa: {}, years: [9999, 0], decades: {} };
    c.n++; taxaCount[g("taxon") || "unnamed"] = (taxaCount[g("taxon") || "unnamed"] ?? 0) + 1; if (coastal.get(g("sample_id"))) { c.coastal++; out.plankton.coastal_records++; } const t = g("taxon") || "unnamed"; c.taxa[t] = (c.taxa[t] ?? 0) + 1; taxa.add(t);
    if (ok) { c.years = [Math.min(c.years[0], year), Math.max(c.years[1], year)]; c.decades[decadeOf(year)] = (c.decades[decadeOf(year)] ?? 0) + 1; }
    cells.set(key, c); out.plankton.records++; if (ok) decades[decadeOf(year)] = (decades[decadeOf(year)] ?? 0) + 1;
  } else {
    const dep = g("depth_m") === "" ? null : parseFloat(g("depth_m")), band = dep == null || dep <= 10 ? "surface" : dep <= 200 ? "upper" : "deep", isCoast = coastal.get(g("sample_id")) === true;
    const A = (statAcc[`${v}|${normUnit(g("unit"))}|${band}`] ??= { values: [], years: [9999, 0], coastal: 0, sources: new Set() });
    A.values.push(parseFloat(val)); if (ok) A.years = [Math.min(A.years[0], year), Math.max(A.years[1], year)]; if (isCoast) A.coastal++; A.sources.add(srcName(src));
    out.measured.push({ lon: +lon.toFixed(5), lat: +lat.toFixed(5), v, value: parseFloat(val), unit: normUnit(g("unit")), coast: isCoast || undefined, unit_src: g("unit") !== normUnit(g("unit")) ? g("unit") : undefined, date: g("sample_datetime") || null, depth: g("depth_m") === "" ? null : parseFloat(g("depth_m")), src, evidence: g("evidence_type") || null, qualifier: g("qualifier") || null, cast: g("station_id") || null, sensor: /CTD|PFL|UOR|float|argo|SBE|profil/i.test(g("instrument") + " " + src) || undefined });
  }
}
/* Instrument profiles (CTD casts binned every 2 dbar, float and towed-sensor profiles; bottles are never thinned) are drawn at the standard depths of the World Ocean
   Atlas below 10 m: per cast and variable, the one actual reading nearest each standard depth (within 5 % of it, at least 2 m). Values are
   never averaged or interpolated; the readings in between stay in the intake and are counted in `thinned`. The top 10 m are all kept. */
const STD = [20, 30, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 600, 700, 800, 900, 1000, 1200, 1500, 2000, 2500, 3000, 3500];
{
  const groups = new Map();
  out.measured.forEach((m, i) => { if (m.cast && m.sensor && m.depth != null && m.depth > 10) { const k = `${m.cast}|${m.v}`; (groups.get(k) ?? groups.set(k, []).get(k)).push(i); } });
  const drop = new Set(); let thinned = 0;
  for (const idx of groups.values()) {
    if (idx.length <= 10) continue; // only instrument profiles (CTD, floats, towed sensors) are grouped here: bottle casts are never thinned
    const keep = new Set();
    for (const d of STD) { let best = -1, bd = Infinity; for (const i of idx) { const e = Math.abs(out.measured[i].depth - d); if (e < bd) { bd = e; best = i; } } if (best >= 0 && bd <= Math.max(2, 0.05 * d)) keep.add(best); }
    for (const i of idx) if (!keep.has(i)) { drop.add(i); thinned++; }
  }
  out.measured = out.measured.filter((_, i) => !drop.has(i));
  out.thinned = { rows: thinned, rule: "dense profiles drawn at standard depths below 10 m (nearest actual reading within 5 %, at least 2 m)", levels_m: STD };
}
out.measured.forEach((m) => { delete m.cast; delete m.sensor; if (m.evidence === "in_situ") delete m.evidence; if (m.qualifier == null) delete m.qualifier; });
/* Summary per variable, unit and depth band over ALL accepted readings (surface = 0-10 m or no depth given, upper = 10-200 m, deep = below 200 m) */
out.stats = Object.entries(statAcc).map(([k, A]) => {
  const [v, unit, band] = k.split("|"), s = A.values.sort((a, b) => a - b), q = (f) => s[Math.min(s.length - 1, Math.floor(f * s.length))];
  return { v, unit, band, n: s.length, min: s[0], median: q(0.5), max: s.at(-1), years: A.years[0] === 9999 ? null : A.years, coastal: A.coastal, sources: [...A.sources] };
});
for (const V of Object.values(out.variables)) { V.stations = V.stations.size; V.units = [...V.units]; if (V.years[0] === 9999) V.years = null; }
out.plankton.cells = [...cells.values()].map((c) => ({ ...c, lat: +c.lat.toFixed(3), lon: +c.lon.toFixed(3), years: c.years[0] === 9999 ? null : c.years, taxa: Object.fromEntries(Object.entries(c.taxa).sort((a, b) => b[1] - a[1]).slice(0, 8)) }));
out.plankton.taxa = taxa.size; out.plankton.top_taxa = Object.entries(taxaCount).sort((a, b) => b[1] - a[1]).slice(0, 12); out.plankton.decades = decades;
out.datasets = Object.entries(out.sources).map(([id, rows]) => ({ id, rows, title: licences.get(id)?.title ?? null, license: licences.get(id)?.license ?? null })).sort((a, b) => b.rows - a.rows);
fs.mkdirSync(path.resolve("data", "ndma"), { recursive: true });
{ const body = JSON.stringify(out); fs.writeFileSync(path.resolve("data", "ndma", "insitu.json"), body); fs.writeFileSync(path.resolve("data", "ndma", "insitu.json.gz"), zlib.gzipSync(body, { level: 9 })); } // the server sends the gzipped copy
console.log(`Read ${out.rows} rows from ${file}`);
console.log(`Plankton presence: ${out.plankton.records} records in ${out.plankton.cells.length} cells, ${out.plankton.taxa} taxa; measured points: ${out.measured.length}`);
for (const [k, v] of Object.entries(out.variables)) console.log(`  ${k}: ${v.rows} rows, ${v.stations} places, ${v.years?.join("-") ?? "no dates"}, units ${v.units.join("/") || "-"}`);
console.log(`Skipped: ${JSON.stringify(out.skipped)}`);
