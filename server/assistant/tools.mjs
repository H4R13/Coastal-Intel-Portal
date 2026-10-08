/**
 * Tools the portal assistant may call. Each one reads the portal's own database (read only) and returns the rows as they
 * are stored, so every number in an answer comes from a dataset and not from the model's memory.
 *   list_datasets      what the portal holds, and the keys of its documents
 *   get_dataset        one document (ocean / amib / dmjm), optionally one branch of it, shrunk to fit
 *   search_text        find documents that mention a word or phrase (literature, findings, catalogue, stations)
 *   plastics_stations  the plastic-debris sampling stations, all or those at one place
 *   ocean_summary      headline numbers and written findings for one ocean topic (heatwaves, pH, oxygen, fisheries ...)
 *   delta_series       the saltwater / sea-level package's series at key years (saltwater, groundwater, sea level ...)
 *   mangrove_area      mangrove area per year, observed and the team's scenarios
 *   erosion_summary    eroded land per mapped period and the projection
 *   system_health      the same report the portal's terminal shows (services, layer data, cache, load)
 *   access_summary     what the API served recently: routes, errors, slow answers (image loads for the timeline)
 */
import { query, cached } from "../db.mjs";
import { diagnostics } from "../diagnostics.mjs";
import { subject } from "./understand.mjs";

const MAX_CHARS = 14000; // one tool answer never exceeds this, so a big document cannot swamp the conversation
const FACTS_CHARS = 9200; // retrieve(): all the facts handed to a small local model together
const STOP = new Set("about there their which where would could should please portal coast coastal pakistan data dataset datasets information between because these those whats happening going doing today right think know tell show give much many".split(" "));
const NOT_LOADED = ["earthquake / seismic catalogues (and tsunami records)", "continental-shelf bathymetry (depth) change", "raw Google Earth Engine exports"];
const DOCS = { ocean: "ocean_doc", amib: "amib_doc", dmjm: "dmjm_doc" };
const HIDDEN = /^(files|raster)\//; // server paths and decoded grids: not for answering questions
const like = (s) => `%${String(s).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** Cut long arrays down (first and last items kept, the gap counted) and long strings, until the JSON fits. */
function shrink(value, limit) {
  if (Array.isArray(value)) {
    if (value.length <= limit) return value.map((x) => shrink(x, limit));
    const half = Math.max(1, Math.floor(limit / 2));
    return [...value.slice(0, half).map((x) => shrink(x, limit)), `… ${value.length - 2 * half} of ${value.length} items left out …`, ...value.slice(-half).map((x) => shrink(x, limit))];
  }
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shrink(v, limit)]));
  if (typeof value === "string" && value.length > 600) return `${value.slice(0, 600)}…`;
  return value;
}
export function fit(value, max = MAX_CHARS) {
  for (const limit of [400, 200, 100, 50, 25, 12, 6]) {
    const text = JSON.stringify(shrink(value, limit));
    if (text.length <= max || limit === 6) return text.length <= max ? text : `${text.slice(0, max)}… (cut)`;
  }
}
const dig = (obj, path) => (path ? path.split(".").filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), obj) : obj);
const round = (n, d = 2) => (n == null ? null : +Number(n).toFixed(d));

/* Where each ocean topic's headline numbers live, and which written findings go with it. */
const eez = (r) => !r.region || r.region === "Whole EEZ";
const OCEAN_TOPICS = {
  heatwave: { keys: ["data/mhw_summary"], keep: (r) => eez(r) && r.definition === "fixed", theme: /heat|warm/i, note: "Marine heatwave days per year, whole EEZ, fixed 1991-2020 baseline. Observed (satellite sea-surface temperature)." },
  temperature: { keys: ["data/sst_summary"], keep: eez, theme: /warm/i, note: "Sea-surface temperature, whole EEZ. Observed. Trends are °C per decade." },
  ph: { keys: ["data/ph_summary_regions", "data/outlook_thresholds"], keep: eez, theme: /acid/i, note: "Surface pH, whole EEZ. The summary is a reconstruction from observations; outlook_thresholds are projections to 2050 per scenario." },
  aragonite: { keys: ["data/omega_summary_regions", "data/outlook_thresholds"], keep: eez, theme: /acid|shell/i, note: "Aragonite saturation state (omega), whole EEZ. Below 3 is stressful for shell-builders, below 1 shells dissolve." },
  oxygen: { keys: ["data/o2_trends"], keep: (r) => eez(r) && r.product === "GOBAI-O2 v2.3" && /^o2_(0m|0_100|100_600)$/.test(r.metric), theme: /oxygen/i,
    note: "Dissolved oxygen, whole EEZ, 2004-2024. Observation-based (Argo floats and ship data), not a projection. 'mean' is in µmol/kg and 'trend' is in µmol/kg per decade (NOT percent); a positive trend means more oxygen. Metrics: o2_0m = surface, o2_0_100 = top 100 m, o2_100_600 = 100 to 600 m. The catalogue marks these trends 'not robust'. Lead with the written findings." },
  fisheries: { keys: ["data/stock_status_indicator"], theme: /fish/i, note: "Fish stock status for 2023: the share of assessed stocks, and of the catch, that is overexploited or collapsed. A catch-based estimate, not an official stock assessment." },
  exposure: { keys: ["data/exposure_summary", "data/national_index"], keep: eez, theme: /exposure|warm|acid/i, note: "Climate exposure index (0-1) from heat and acidification pressure, whole EEZ." },
};
const DELTA_TOPICS = { saltwater: ["B"], groundwater: ["C", "E"], interface: ["GH"], sea_level: ["D", "GH"], salt_land: ["A"], shelf: ["G"], river_flow: ["drivers"], climate_models: ["H"] };
const DELTA_TITLES = { saltwater: "Salt water in the river", groundwater: "Fresh groundwater", interface: "Fresh / salt groundwater boundary", sea_level: "Sea level", salt_land: "Salt-affected land", shelf: "Salinity at sea (shelf)", river_flow: "River flow reaching the delta", climate_models: "Climate model outlook" };
const DELTA_NOTES = {
  saltwater: "The flow scenarios differ only in how much Indus water reaches the delta: 'accord flow' = the release promised by the water accord, 'current flow' = as today, 'degraded flow' = less than today. Comparing them shows what river flow does to salt intrusion; the slow rise within one scenario is the sea-level part.",
  groundwater: "'current' and 'accord' are the same river-flow assumptions as for salt intrusion. The usable fresh lens is the fresh groundwater people can pump.",
  river_flow: "Flow below Kotri barrage is the river water that actually reaches the delta; MAF = million acre-feet a year.",
  salt_land: "Mapped from satellite each year, for two coastal areas.", shelf: "Shelf sea-surface salinity is measured (observed); the turbidity index is a weak proxy for the river plume.",
};
/*
 * One series as one sentence: its condition, what it measures, and the values at a few years. A figure never leaves the
 * words that say what it is, so nothing can be swapped between scenarios. Each label is the start of the sentence, ending
 * where the values go ("... 64.2 km in 2025 and 65.4 km in 2050"); {place} is filled where the series is per place.
 */
const LABELS = [
  [/intrusion length L1/, "in the dry season slightly salty water (1 psu) reaches up the Indus as far as"],
  [/intrusion length L5/, "in the dry season salty water (5 psu) reaches up the Indus as far as"],
  [/days with L1 > 60/, "salt water reaches more than 60 km up the Indus on"],
  [/usable fresh-lens area/, "the usable fresh groundwater under the delta (the fresh lens people can pump) covers"],
  [/usable lens thickness/, "the usable fresh groundwater lens is on average as thick as"],
  [/mixed \/ uncertain lens/, "groundwater that is mixed or uncertain covers"],
  [/saline, probable marine/, "groundwater made saline by the sea covers"],
  [/relative sea-level rise/, "sea level relative to the land at {place} (climate rise plus the land sinking) is above its 1995–2014 level by"],
  [/climate sea-level rise only/, "sea level from climate alone at {place} is above its 1995–2014 level by"],
  [/tide gauge/, "mean sea level at the Karachi tide gauge, against its 2007–2014 mean, is"],
  [/Kotri \(annual\)/, "the Indus carried past Kotri barrage to the delta"],
  [/Kotri \(Rabi/, "in the dry half of the year (October to March) the Indus carried past Kotri barrage"],
  [/salt-affected area/, "salt-affected land at {place} covers"],
  [/salt-affected share/, "the salt-affected share of inland land at {place} is"],
  [/tidal flat/, "tidal flats at {place} cover"],
  [/shelf sea-surface salinity/, "sea-surface salinity on the Indus shelf is"],
  [/turbidity/, "the river-plume turbidity index at the Indus mouth (a weak proxy) is"],
  [/land newly below MSL/, "land at {place} that has dropped below mean sea level since 2020 and is open to the sea covers"],
  [/GH interface < 10 m/, "the area at {place} where the boundary between fresh and salt groundwater lies less than 10 m down covers"],
  [/median GH interface depth/, "the boundary between fresh and salt groundwater at {place} lies at a median depth of"],
];
/* unit as stored → [as written, decimals worth showing, a note added once after the sentence] */
const UNITS = { "km from mouth": ["km", 1], "km inland": ["km", 1], km2: ["km²", 1], "days/yr": ["days a year", 0], MAF: ["MAF", 1, "(MAF = million acre-feet.)"], psu: ["psu", 2], fraction: ["", 3], "log ratio (weak proxy)": ["", 2] };
const unitOf = (unit) => UNITS[unit] ?? (/^m vs 2007/.test(unit ?? "") ? ["m", 3, "(The years 1993–2006 are missing and a break in the gauge's reference level is suspected, so the long-term rise from this gauge is uncertain.)"] : /^m\b/.test(unit ?? "") ? ["m", 3] : [unit ?? "", 2]);
const PLACES = { indus_delta: "the Indus Delta", karachi: "Karachi", bela_sonmiani: "Bela–Sonmiani", ketibandar_coast: "the Keti Bandar coast", sujawal: "Sujawal" };
const listed = (items) => (items.length < 3 ? items.join(" and ") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);
function seriesLine(metric, k, unit, asked = []) {
  const sc = String(k.scenario ?? ""), ssp = sc.match(/ssp\d+/i)?.[0], kind = String(k.kind ?? "");
  const flow = /accord/i.test(sc) ? "If the water accord's promised river flow is delivered" : /degraded/i.test(sc) ? "If river flow drops below today's" : /current/i.test(sc) ? "If the river keeps flowing as it does today" : null;
  const lead = flow ? `${flow} (projected${ssp ? `, ${ssp}` : ""})` : /observ/i.test(kind) ? "Measured" : /reconstruct/i.test(kind) ? "Reconstructed from observations" : /project/i.test(kind) ? `Projected${ssp ? ` (${ssp})` : ""}` : kind || "Modelled";
  const [u, d, note] = unitOf(unit), place = PLACES[k.zone] ?? String(k.zone ?? "").replace(/_/g, " ");
  const have = Object.keys(k.at), mine = asked.map(String).filter((y) => have.includes(y));
  const record = !/project/i.test(kind) && !/accord|current|degraded/i.test(sc);
  const ys = have.filter((y, i, a) => (mine.length ? i === 0 || mine.includes(y) || (record && i === a.length - 1) : i === 0 || i === a.length - 1 || y === "2030" || y === "2050")); // a year that was asked about is shown beside the first one; otherwise the usual milestones
  const value = (y) => { // the likely range once the projection is far enough out to need it: 2050 and the last year
    const v = k.at[y], wide = typeof v === "object" && (y === "2050" || y === ys.at(-1));
    return `${round(v?.p50 ?? v, d)}${u ? ` ${u}` : ""} in ${y}${wide ? ` (likely ${round(v.low, d)} to ${round(v.high, d)})` : ""}`;
  };
  const stem = (LABELS.find(([re]) => re.test(metric))?.[1] ?? `${metric}${place ? ` at {place}` : ""} is`).replace("{place}", place);
  const a = k.at[ys[0]]?.p50 ?? k.at[ys[0]], b = k.at[ys.at(-1)]?.p50 ?? k.at[ys.at(-1)], pct = a > 0 && ys.length > 1 && ["km", "km²", "MAF", "days a year"].includes(u) ? ((b - a) / a) * 100 : 0;
  const moved = Math.abs(pct) >= 5 ? `, ${round(Math.abs(pct), 1)}% ${pct < 0 ? "lower" : "higher"} than in ${ys[0]}` : ""; // "by what percentage has it fallen?"
  return `${lead}, ${stem} ${listed(ys.map(value))}${moved}.${note ? ` ${note}` : ""}`;
}
/** A summary row without its test statistics (p-values, standard errors), with numbers rounded: what a reader needs. */
const plain = (row) => Object.fromEntries(Object.entries(row).filter(([k]) => !/(_p|_se|^sigma.*|^neff|^ci.*|^mk_p|^ts)$/.test(k)).map(([k, v]) => [k, typeof v === "number" ? round(v, 3) : v]));
/** One series of the saltwater package as its values at a few key years. */
function keyYears(s, asked = []) {
  const years = s.year ?? [], now = new Date().getFullYear(), at = {};
  for (const y of [years[0], 2000, 2020, now, 2030, 2040, 2050, years.at(-1), ...asked.map(Number)].sort((a, b) => a - b)) {
    const i = years.indexOf(y);
    if (i < 0 || s.p50?.[i] == null) continue;
    at[y] = s.p17?.[i] != null && s.p83?.[i] != null ? { p50: round(s.p50[i], 3), low: round(s.p17[i], 3), high: round(s.p83[i], 3) } : round(s.p50[i], 3);
  }
  const ys = Object.keys(at), v = (y) => at[y]?.p50 ?? at[y], a = v(ys[0]), b = v(ys.at(-1));
  const change = ys.length > 1 ? `${b > a ? "rises" : b < a ? "falls" : "stays the same"} from ${a} in ${ys[0]} to ${b} in ${ys.at(-1)}` : undefined; // a ready phrase: small models call a rise a fall
  return { zone: s.zone, scenario: s.scenario, kind: s.kind ?? s.label, change, at };
}

export const TOOLS = [
  {
    name: "list_datasets",
    description: "List what the portal's database holds: the portal layers, and the keys of the documents in each package (ocean, amib, dmjm). Call this first when you do not know where an answer would live. ocean:catalog and amib:catalog describe every dataset in their package.",
    input_schema: { type: "object", properties: { package: { type: "string", enum: ["ocean", "amib", "dmjm"], description: "Only this package's keys. Omit for an overview." } } },
    run: async ({ package: pkg }) => {
      const out = {
        layers: {
          mangroves: "Global Mangrove Watch yearly extent (observed 1988–2025) and the team's good / normal / worst scenarios to 2050. Use mangrove_area.",
          erosion: "Eroded land per mapped period, plus a yearly projection to 2050. Use erosion_summary.",
          ocean: "Ocean pH, aragonite saturation, oxygen, sea-surface temperature, marine heatwaves, fisheries / stock status, exposure (documents under 'ocean').",
          amib: "Saltwater intrusion, salinity index, sea-level rise at the Indus Delta, coastal hazard maps and series (documents under 'amib').",
          dmjm: "Plastic debris: sampling stations, species, hazards, literature (documents under 'dmjm').",
        },
        not_in_the_database: NOT_LOADED,
      };
      for (const [name, table] of Object.entries(DOCS)) {
        if (pkg && pkg !== name) continue;
        const rows = (await query(`select key, length(body::text) as chars from ${table} order by key`)).rows.filter((r) => !HIDDEN.test(r.key));
        out[`${name}_keys`] = rows.map((r) => `${r.key} (${r.chars} chars)`);
      }
      return out;
    },
  },
  {
    name: "get_dataset",
    description: "Read one document from the database. Large documents are shrunk (long lists keep their first and last items and say how many were left out), so use `path` to drill into one branch (dot path, e.g. 'series.0.points') for the full detail of just that part.",
    input_schema: {
      type: "object",
      properties: {
        package: { type: "string", enum: ["ocean", "amib", "dmjm"] },
        key: { type: "string", description: "Document key, e.g. 'data/ph_summary_regions', 'series/D', 'literature', 'findings'." },
        path: { type: "string", description: "Optional dot path inside the document." },
      },
      required: ["package", "key"],
    },
    run: async ({ package: pkg, key, path }) => {
      const table = DOCS[pkg];
      if (!table) return { error: "package must be ocean, amib or dmjm" };
      if (HIDDEN.test(key)) return { error: "that document is not available" };
      const row = (await query(`select body from ${table} where key = $1`, [key])).rows[0];
      if (!row) return { error: `no document '${key}' in ${pkg}; call list_datasets for the keys` };
      const part = dig(row.body, path);
      if (part === undefined) return { error: `nothing at path '${path}'`, top_level_keys: Object.keys(row.body ?? {}).slice(0, 40) };
      return { source: `${pkg}:${key}${path ? ` → ${path}` : ""}`, data: JSON.parse(fit(part)) };
    },
  },
  {
    name: "search_text",
    description: "Find documents whose text mentions a word or phrase, with a snippet around the match. Use it for questions about a species, a place, a pollutant, a finding or a reference.",
    input_schema: { type: "object", properties: { text: { type: "string", description: "Word or phrase, at least 3 characters." } }, required: ["text"] },
    run: async ({ text }) => {
      if (!text || text.trim().length < 3) return { error: "give at least 3 characters" };
      const hits = [];
      for (const [name, table] of Object.entries(DOCS)) {
        const rows = (await query(
          `select key, substr(body::text, greatest(position(lower($1) in lower(body::text)) - 200, 1), 500) as snippet
           from ${table} where body::text ilike $2 and key !~ '^(files|raster)/' order by key limit 8`, [text.trim(), like(text.trim())])).rows;
        for (const r of rows) hits.push({ source: `${name}:${r.key}`, snippet: r.snippet });
      }
      return hits.length ? { matches: hits } : { matches: [], note: "No document mentions that. It is not in the portal's data." };
    },
  },
  {
    name: "mangrove_area",
    description: "Mangrove area (km²) per year for the Pakistan coast. 'observed' is mapped (Global Mangrove Watch); good / normal / worst are the team's projections to 2050. Returns the yearly values and the change between first and last year.",
    input_schema: {
      type: "object",
      properties: {
        scenario: { type: "string", enum: ["observed", "good", "normal", "worst"], description: "Default observed." },
        from_year: { type: "integer" }, to_year: { type: "integer" },
      },
    },
    run: async ({ scenario = "observed", from_year = 1900, to_year = 2100 }) => {
      const rows = (await query("select year, area_km2 from mangrove_area where scenario = $1 and year between $2 and $3 order by year", [scenario, from_year, to_year])).rows;
      if (!rows.length) return { error: "no data for that scenario and range" };
      const first = rows[0], last = rows.at(-1), peak = rows.reduce((a, r) => (r.area_km2 > a.area_km2 ? r : a)), low = rows.reduce((a, r) => (r.area_km2 < a.area_km2 ? r : a));
      const observed = scenario === "observed", diff = last.area_km2 - first.area_km2, have = new Set(rows.map((r) => r.year)), gaps = [];
      for (let y = first.year; y < last.year; y++) if (!have.has(y)) gaps.push(y);
      return {
        // a ready sentence: a small model copies it instead of mixing up observed and projected
        summary: `${observed ? "Mapped (observed, measured from satellite)" : `Projected (the team's "${scenario}" scenario, not a measurement)`} mangrove area: ${round(first.area_km2)} km² in ${first.year}, ${round(last.area_km2)} km² in ${last.year}; ${diff >= 0 ? "a rise" : "a fall"} of ${round(Math.abs(diff))} km² (${round((diff / first.area_km2) * 100, 1)}%).`,
        ...(observed && gaps.length ? { years_with_no_map: gaps } : {}),
        source: "mangrove_area (Global Mangrove Watch extracts supplied by the project team)", scenario, unit: "km²", kind: observed ? "observed" : "projected",
        first: { year: first.year, km2: round(first.area_km2) }, last: { year: last.year, km2: round(last.area_km2) },
        change_km2: round(last.area_km2 - first.area_km2), change_percent: round(((last.area_km2 - first.area_km2) / first.area_km2) * 100, 1),
        peak: { year: peak.year, km2: round(peak.area_km2) }, lowest: { year: low.year, km2: round(low.area_km2) },
        yearly: rows.map((r) => [r.year, round(r.area_km2)]),
      };
    },
  },
  {
    name: "plastics_stations",
    description: "The plastic-debris sampling stations (Karachi creeks and the Indus Delta): plastic count per m², main polymer, heavy metals (Cd, Pb, Cr in ppm), risk level, alert level, sampling date and the indicator species at each. Use it for any question about plastics or heavy metals at a place or station.",
    input_schema: { type: "object", properties: { place: { type: "string", description: "Optional: a district, creek or site name, e.g. 'Karachi', 'Thatta', 'Korangi'. Omit for all stations." } } },
    run: async ({ place }) => {
      const all = (await query("select body from dmjm_doc where key = 'stations'")).rows[0]?.body?.rows ?? [];
      if (!all.length) return { error: "plastics stations are not loaded" };
      const p = String(place ?? "").trim().toLowerCase();
      const rows = p ? all.filter((r) => [r.Site_Name, r.District, r.Tehsil_Taluka, r.Province, r.Site_ID].some((v) => String(v ?? "").toLowerCase().includes(p))) : all;
      const counts = all.map((r) => r.Plastic_Count_per_m2).filter((v) => v != null);
      const stat = (field) => { // worked out here: a small model gets averages wrong
        const have = rows.filter((r) => r[field] != null).sort((a, b) => a[field] - b[field]);
        return have.length < 2 ? undefined : { lowest: `${have[0][field]} at ${have[0].Site_Name}`, highest: `${have.at(-1)[field]} at ${have.at(-1).Site_Name}`, average: round(have.reduce((a, r) => a + r[field], 0) / have.length) };
      };
      return {
        source: "dmjm:stations (plastic-debris sampling stations supplied by the project team)", kind: "observed (field sampling)",
        units: "plastic = pieces of plastic debris counted per square metre (a count, not a weight); metals = ppm (parts per million) in sediment",
        ...(rows.length > 1 ? { across_these_stations: { plastic_pieces_per_m2: stat("Plastic_Count_per_m2"), cadmium_ppm: stat("Cd_ppm"), lead_ppm: stat("Pb_ppm"), chromium_ppm: stat("Cr_ppm"), risk_levels: rows.map((r) => r.Risk_Level).join(", ") } } : {}),
        ...(p ? { asked_for: place, matched: rows.length, of_all_stations: all.length } : { stations: all.length }),
        ...(p && !rows.length ? { note: `No station matches '${place}'. Districts sampled: ${[...new Set(all.map((r) => r.District))].join("; ")}.` } : {}),
        all_stations_plastic_range_pieces_per_m2: [Math.min(...counts), Math.max(...counts)],
        rows: rows.map((r) => ({
          site: `${r.Site_ID} ${r.Site_Name}`, district: r.District, sampled: r.Sampling_Date, plastic_pieces_per_m2: r.Plastic_Count_per_m2, main_polymer: r.Primary_Polymer,
          cadmium_ppm: r.Cd_ppm, lead_ppm: r.Pb_ppm, chromium_ppm: r.Cr_ppm, risk_level: r.Risk_Level, alert_level: r.Emergency_Alert_Level,
          indicator_species: r.Key_Bioindicator_Species, microplastics_per_animal_avg: r.Species_Avg_MP_Ingested, fisherfolk_exposed: r.Exposed_Fisherfolk_Pop, action: r.Action_Mandate,
        })),
      };
    },
  },
  {
    name: "ocean_summary",
    description: "Headline numbers for one ocean topic in Pakistan's Exclusive Economic Zone, with the written findings on it. Topics: heatwave (marine heatwave days), temperature (sea-surface temperature trend), ph (acidification), aragonite (saturation state, shells), oxygen, fisheries (stock status), exposure (climate exposure index).",
    input_schema: { type: "object", properties: { topic: { type: "string", enum: Object.keys(OCEAN_TOPICS) } }, required: ["topic"] },
    run: async ({ topic }) => {
      const t = OCEAN_TOPICS[topic];
      if (!t) return { error: `topic must be one of ${Object.keys(OCEAN_TOPICS).join(", ")}` };
      const out = { source: t.keys.map((k) => `ocean:${k}`).join(", "), topic, note: t.note };
      for (const key of t.keys) {
        const body = (await query("select body from ocean_doc where key = $1", [key])).rows[0]?.body;
        if (body) out[key.replace("data/", "")] = (Array.isArray(body) ? body.filter(t.keep ?? (() => true)) : [body]).map(plain);
      }
      const found = (await query("select body from ocean_doc where key = 'findings'")).rows[0]?.body?.findings ?? [];
      out.findings = found.filter((f) => t.theme.test(f.theme ?? "")).slice(0, 4) // in reading order, as plain statements
        .map((f) => ({ finding: f.headline, figure: f.number ? `${f.number.value} ${f.number.caption}` : undefined, details: f.sub_numbers, what_it_means: f.so_what, how_sure: f.confidence, reference: f.reference }));
      return out;
    },
  },
  {
    name: "delta_series",
    description: "Year-by-year series for the Indus Delta and coast from the saltwater / sea-level package, as values at key years (first, 2000, 2020, now, 2030, 2040, 2050, last). Topics: saltwater (how far salt reaches up the river and underground), groundwater (fresh groundwater lens), sea_level (tide gauge and relative sea-level rise), salt_land (salt-affected land, tidal flats), shelf (shelf salinity and river plume), river_flow (Indus flow below Kotri), climate_models (CMIP6 anomalies). Each series says observed, modelled or projected.",
    input_schema: { type: "object", properties: { topic: { type: "string", enum: Object.keys(DELTA_TOPICS) }, scenario: { type: "string", description: "Emissions scenario for projections: ssp126, ssp245 (default, medium) or ssp585." } }, required: ["topic"] },
    run: async ({ topic, scenario = "ssp245", place, measure, years = [] }) => { // measure: part of a metric's name to lead with; years: years asked about, shown beside the first one
      const keys = DELTA_TOPICS[topic];
      if (!keys) return { error: `topic must be one of ${Object.keys(DELTA_TOPICS).join(", ")}` };
      const want = String(scenario).toLowerCase().replace(/[^a-z0-9]/g, ""), where = String(place ?? "indus").toLowerCase().replace(/[^a-z]/g, ""), lines = [];
      const first = /usable fresh-lens area|intrusion length L1|relative sea-level|\(annual\)|salt-affected area|shelf sea-surface salinity/; // the measure people mean by the topic
      for (const key of keys) {
        const body = (await query("select body from amib_doc where key = $1", [`series/${key}`])).rows[0]?.body ?? {};
        for (const [metric, m] of Object.entries(body)) {
          const fits = (s) => /observ|present/i.test(`${s.kind} ${s.scenario}`) || String(s.scenario ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").includes(want);
          const series = (m.series ?? []).filter(fits);
          for (const x of series.length ? series : m.series ?? []) {
            const tag = `${x.scenario} ${x.kind}`.toLowerCase(), zone = String(x.zone ?? "").toLowerCase().replace(/[^a-z]/g, "");
            // most relevant first: the topic's main measure, the place asked about, today's river flow before the alternatives, projections before reconstructions
            const asked = !!measure && metric.toLowerCase().includes(String(measure).toLowerCase());
            const rank = (asked ? -30 : first.test(metric) ? 0 : 20) + (zone.includes(where) ? 0 : 6) + (/current/.test(tag) ? 0 : /accord/.test(tag) ? 1 : /degraded/.test(tag) ? 2 : /reconstruct/.test(tag) ? 4 : /present state/.test(tag) ? 3 : 0);
            const k = keyYears(x, years);
            lines.push({ rank, k, metric, tag, asked, text: seriesLine(metric, k, m.unit, years) }); // one whole sentence per series: a figure never leaves its scenario
          }
        }
      }
      lines.sort((a, b) => a.rank - b.rank);
      /* why salt reaches where it does, as far as this data can say: the same year under two river flows */
      const top = lines[0], v0 = (l) => { const y = Object.keys(l.k.at)[0], v = l.k.at[y]; return { y, v: round(v?.p50 ?? v, 1) }; };
      const now = lines.find((l) => /intrusion length L1/.test(l.metric) && /current/.test(l.tag)), accord = lines.find((l) => /intrusion length L1/.test(l.metric) && /accord/.test(l.tag));
      const driver = now && accord ? `River flow is the main driver in this data: in ${v0(now).y}, salt water reaches ${v0(now).v} km up the river with today's flow but ${v0(accord).v} km if the water accord's flow is delivered. Sea-level rise adds the slow increase after that.` : undefined;
      return { source: keys.map((k) => `amib:series/${k}`).join(", "), topic, title: DELTA_TITLES[topic], note: DELTA_NOTES[topic], driver, matched: lines.some((l) => l.asked), core: lines.filter((l) => l.rank < (top?.rank ?? 0) + 5).length, statements: lines.slice(0, 8).map((l) => l.text) }; // core: how many lines are on the main measure at the place asked about
    },
  },
  {
    name: "erosion_summary",
    description: "Eroded land (km²) on the Pakistan coast: area lost in each mapped period, the running total, and the team's yearly projection to 2050.",
    input_schema: { type: "object", properties: {} },
    run: async () => {
      const { body } = await cached("erosion:periods:raw:v1", async () => Buffer.from(JSON.stringify((await query(
        `select kind, start_yr, end_yr, sum(ST_Area(ST_Transform(geom, 4326)::geography)) / 1e6 as km2 from erosion_area group by kind, start_yr, end_yr order by start_yr`)).rows)));
      const rows = JSON.parse(body.toString());
      if (!rows.length) return { error: "erosion data is not loaded" };
      let total = 0;
      const periods = rows.map((r) => ({ kind: r.kind, from: r.start_yr, to: r.end_yr, lost_km2: round(r.km2), running_total_km2: round((total += +r.km2)) }));
      const seen = periods.filter((p) => p.kind === "observed"), ahead = periods.filter((p) => p.kind !== "observed"), lastSeen = seen.at(-1), by = (y) => ahead.find((p) => p.to === y);
      return {
        // ready sentences, with observed and projected kept apart
        summary: [
          lastSeen ? `Observed (mapped): ${lastSeen.running_total_km2} km² of land lost to the sea from ${seen[0].from} to ${lastSeen.to}.` : null,
          ahead.length && lastSeen ? `Projected (model, not a measurement): a further ${[2030, 2040, 2050].filter(by).map((y) => `${round(by(y).running_total_km2 - lastSeen.running_total_km2)} km² by ${y}`).join(", ")}, about ${round(ahead.reduce((a, p) => a + p.lost_km2, 0) / ahead.length)} km² a year.` : null,
        ].filter(Boolean),
        source: "erosion_area (eroded-area polygons by period supplied by the project team; projection = CA-Markov run)", unit: "km²",
        observed_periods: seen, projected_running_total_km2: Object.fromEntries([2030, 2040, 2050].filter(by).map((y) => [y, by(y).running_total_km2])),
      };
    },
  },
  {
    name: "system_health",
    description: "Health report of the portal itself: PostgreSQL, Redis cache, whether each layer's data is loaded, cache warmth and machine load. Each check is ok / warn / fail with a detail. Use it for 'is layer X working' questions.",
    input_schema: { type: "object", properties: {} },
    run: async () => diagnostics(),
  },
  {
    name: "access_summary",
    description: "What the data API served recently, from the access log: requests per route group with error counts and average / slowest time. Image requests ('/api/amib/image') are the timeline's year-by-year maps, so failures or slow answers there explain a map that did not load. Tile requests are not logged.",
    input_schema: { type: "object", properties: { hours: { type: "integer", description: "Look back this many hours (1–168, default 24)." } } },
    run: async ({ hours = 24 }) => {
      const h = Math.min(Math.max(+hours || 24, 1), 168);
      const rows = (await query(
        `select regexp_replace(route, '/[0-9]+$', '/<n>') as route, count(*)::int as requests,
                count(*) filter (where status >= 400)::int as errors, round(avg(ms))::int as avg_ms, max(ms)::int as slowest_ms,
                max(ts) filter (where status >= 400) as last_error
         from access_log where ts > now() - make_interval(hours => $1) group by 1 order by errors desc, requests desc limit 40`, [h])).rows;
      return rows.length ? { hours: h, how_to_read: "A year map on the timeline is one '/api/amib/image' request. It fails to appear when that request returns an error (errors > 0: the map for that year or layer does not exist, or drawing it failed) or is slow (slowest_ms in the thousands: maps are drawn on demand by a small pool, so many years asked for at once wait in a queue, and playback moves on before the picture arrives). Zero errors and low times mean the maps are being served properly.", routes: rows } :{ hours: h, note: "Nothing logged in that window (the log starts when the server first handled a request after this feature was added)." };
    },
  },
];

/**
 * Look-up before answering, for models too small to choose tools reliably: from the words of the question, run the
 * matching tools here and return what they found, so the model only has to read the facts and put them clearly.
 * Returns [{ name, input, result }]; empty when nothing obvious matches (the model then falls back to calling tools itself).
 */
export async function retrieve(question, max = 5000, earlier = []) {
  const { s } = subject(question, earlier), plan = []; // tidied, and with the earlier questions when this one is a follow-up
  const year = s.match(/\b(19[89]\d|20[0-4]\d)\b/)?.[1];
  const has = (re) => re.test(s);
  if (has(/mangrove/)) {
    plan.push(["mangrove_area", { scenario: "observed", ...(year && +year < 2025 ? { from_year: +year } : {}) }]); // the whole record unless a year was asked for
    if (has(/project|forecast|future|scenario|2030|2040|2050|worst|good|normal|decline|next/)) for (const sc of ["good", "normal", "worst"]) plan.push(["mangrove_area", { scenario: sc }]);
  }
  if (has(/erosion|erod|land (lost|loss)|shoreline|retreat/)) plan.push(["erosion_summary", {}]);
  if (has(/\b(work|working|health|healthy|status|broken|fail|failed|down|online|running|ok)\b|load|slow|error|logs?\b|access|uptime/) || has(/\b(portal|site|server|system|layers?)\b.*\b(doing|up|fine|alright|okay|problems?|issues?)\b/)) {
    plan.push(["system_health", {}]);
    if (has(/fail|load|slow|error|log|access|map|image|year|timeline|week|today|recent/)) plan.push(["access_summary", { hours: 24 }]);
  }
  /* plastics: the stations themselves (for the place asked about), and the species / hazard tables when the question is about those */
  const plastics = has(/plastic|polymer|debris|litter|heavy metal|cadmium|\blead\b|chromium|station|sampling/), food = has(/biomagnif|food web|species|bivalve|oyster|crab|shrimp|seafood|\beat(en|ing)?\b/), harm = has(/hazard|health|human|toxic|risk to people|danger|\bsafe/);
  if (plastics) {
    const place = s.match(/karachi|korangi|malir|thatta|sujawal|badin|gharo|phitti|kadiro|hajamro|khobar|shah bandar|keti bandar|indus delta/)?.[0];
    plan.push(["plastics_stations", place && place !== "indus delta" ? { place } : {}]);
  }
  if (food) plan.push(["get_dataset", { package: "dmjm", key: "species" }]);
  if ((plastics || food) && harm) plan.push(["get_dataset", { package: "dmjm", key: "hazards" }]);
  /* ocean and delta topics: the headline numbers, not a text search */
  const scenario = s.match(/ssp ?-?(1-?2\.?6|2-?4\.?5|5-?8\.?5)/)?.[1]?.replace(/\D/g, "");
  const ocean = [[/heat ?wave/, "heatwave"], [/temperature|warming|warmer|\bsst\b|\bhot(ter)?\b/, "temperature"], [/acidif|\bph\b|acid/, "ph"], [/aragonite|omega|shell/, "aragonite"], [/oxygen|plankton|hypoxi|dead zone/, "oxygen"], [/stock|fisher|catch|overfish|\bfish\b/, "fisheries"], [/exposure|vulnerab/, "exposure"]];
  const delta = [[/saltwater|salt water|intrusion|salt wedge/, "saltwater"], [/groundwater|aquifer|fresh ?water|\blens\b|tube ?wells?/, "groundwater"], [/sea.?level|tide gauge|inundat|subsid|sinking|flood/, "sea_level"], [/salt.affected|saline (soil|land)|tidal flat|soil salinity/, "salt_land"], [/shelf salinity|plume|turbid/, "shelf"], [/kotri|river flow|indus flow|discharge|barrage/, "river_flow"]];
  const want = new Set(delta.filter(([re]) => has(re)).map(([, topic]) => topic)), salty = has(/salinity|saline|\bsalt(y|ier|iness)?\b/);
  if (salty && !want.has("salt_land")) { want.add("saltwater"); want.add("shelf"); } // "salinity" alone: how far salt reaches up the river (projected) and the measured shelf salinity
  if (salty || want.has("saltwater")) {
    if (has(/\bwhy\b|reason|cause|driver|due to|because|behind/)) want.add("river_flow"); // the flow scenarios are the data's own explanation
    if (has(/effect|impact|consequence|exposure|exposed|affect|harm|damage|threat|risk/)) { want.delete("shelf"); want.add("groundwater"); want.add("salt_land"); } // what salt does on land: the fresh groundwater people pump, and salt-affected soil
  }
  const zone = s.match(/karachi|keti ?bandar|sujawal|bela|sonmiani/)?.[0]?.replace(" ", ""); // the series are per zone; the Indus Delta is the default
  for (const topic of want) if (plan.length < 4) plan.push(["delta_series", { topic, ...(scenario ? { scenario: `ssp${scenario}` } : {}), ...(zone ? { place: zone } : {}) }]);
  for (const [re, topic] of ocean) if (has(re) && plan.length < 4 && !(topic === "exposure" && want.size)) plan.push(["ocean_summary", { topic }]);
  if (has(/earthquake|seismic|tsunami|shelf depth|continental shelf|bathymetr|earth engine|\bgee\b/)) plan.push(["not_loaded", {}]);
  const asksEffects = want.size && has(/effect|impact|consequence|exposure|exposed|affect|harm|damage|threat/);
  if (!plan.length) { // nothing recognised: search the documents for the question's most specific word, so "not in the data" is a finding and not a guess
    const word = s.replace(/[^a-z ]/g, " ").split(/\s+/).filter((w) => w.length > 4 && !STOP.has(w)).sort((a, b) => b.length - a.length)[0];
    plan.push(word ? ["search_text", { text: word.replace(/s$/, "") }] : ["list_datasets", {}]);
  }
  const out = [], each = Math.min(max, Math.floor(FACTS_CHARS / Math.min(plan.length, 4))); // share the model's small context between the look-ups
  for (const [name, input] of plan.slice(0, 4)) {
    if (name === "not_loaded") { out.push({ name: "list_datasets", input: {}, result: JSON.stringify({ not_in_the_database: NOT_LOADED, note: "The portal has no data on these. Say so plainly for each one that was asked about; do not give figures for them." }) }); continue; }
    out.push({ name, input, result: await runTool(name, input, name === "delta_series" ? max : each) }); // ready statements are shown as they are, not squeezed into the model's context
  }
  // a small model fills "what are the effects?" from memory: say what the data covers, and what it does not
  if (asksEffects) out.push({ name: "delta_series", input: { scope: "effects" }, result: JSON.stringify({ not_loaded: "the effects of salt on crops, livestock, fish catch, drinking water, health and incomes, and how many people are exposed. The portal's data covers two effects only: fresh groundwater and salt-affected land.", statements: [] }) });
  return out;
}

export const toolDefs = TOOLS.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
const byName = new Map(TOOLS.map((t) => [t.name, t]));

/** Run one tool call. Never throws: a failure comes back as { error } so the model can say so. */
export async function runTool(name, input, max = MAX_CHARS) {
  const tool = byName.get(name);
  if (!tool) return JSON.stringify({ error: `unknown tool ${name}` });
  try {
    const result = await tool.run(input ?? {});
    return fit(result, max);
  } catch (e) {
    return JSON.stringify({ error: `${name} failed: ${e.message}` });
  }
}
