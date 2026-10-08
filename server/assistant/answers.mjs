/**
 * Ready-made answers: for the questions the portal's data can answer directly, the sentences are written here, from the
 * database, and shown as they are. A small local model swaps figures between scenarios and adds effects that are not in
 * the data when it rewrites facts (measured on hermes3:8b), so it is not asked to. It still answers what is not covered
 * here (see chat.mjs).
 *   answerDirect(question, earlier, { short }) → { answer, tools } | null   (null = not a question this file knows)
 * Each topic below returns a section: { title, tool, say, also, source, extra?, missing? }.
 *   say   whole sentences that answer what was asked, the most direct first
 *   also  a line or two of context, shown only when the answer itself is brief
 * A figure never leaves the words that say what it is. To teach Hela a new kind of question, add the sentence here.
 */
import { query } from "../db.mjs";
import { diagnostics } from "../diagnostics.mjs";
import { runTool } from "./tools.mjs";
import { subject } from "./understand.mjs";

const n = (v, d = 2) => (+Number(v).toFixed(d)).toLocaleString("en", { maximumFractionDigits: d });
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const list = (items) => (items.length < 3 ? items.join(" and ") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);
const doc = async (table, key) => (await query(`select body from ${table} where key = $1`, [key])).rows[0]?.body;
const yearsIn = (text) => [...text.matchAll(/\b(19[89]\d|20\d\d|2100)\b/g)].map((m) => +m[1]);
const FUTURE = /project|forecast|future|scenario|outlook|expect|\bwill\b|going to|\bnext\b|by 20[3-9]\d|in 20[3-9]\d/;
/** Runs of years as text: [1995, 1997, 1998, 1999] → "1995 and 1997–1999". */
function ranges(years) {
  const out = [];
  for (const y of years) { const last = out.at(-1); if (last && y === last[1] + 1) last[1] = y; else out.push([y, y]); }
  return list(out.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)));
}
/** "2026-03-15", "2026-03-19" → "15–19 March 2026"; one date, or dates in different months, are written out. */
function dates(all) {
  const ds = [...new Set(all)].sort(), a = new Date(ds[0]), b = new Date(ds.at(-1)), month = (d) => d.toLocaleString("en", { month: "long", timeZone: "UTC" });
  if (ds.length === 1) return `${a.getUTCDate()} ${month(a)} ${a.getUTCFullYear()}`;
  return a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear() ? `${a.getUTCDate()}–${b.getUTCDate()} ${month(b)} ${b.getUTCFullYear()}` : `${ds[0]} to ${ds.at(-1)}`;
}

/* ---------- mangroves ---------- */
async function mangroves({ s, ask, years }) {
  if (!/mangrove/.test(s)) return null;
  const rows = (await query("select scenario, year, area_km2 from mangrove_area order by year")).rows, seen = rows.filter((r) => r.scenario === "observed");
  if (!seen.length) return null;
  const first = seen[0], last = seen.at(-1), at = (y) => seen.find((r) => r.year === y), say = [], also = [];
  const gaps = []; for (let y = first.year; y < last.year; y++) if (!at(y)) gaps.push(y);
  const change = (a, b, lead, now) => `${lead} ${b.area_km2 >= a.area_km2 ? (now ? "rises" : "rose") : now ? "falls" : "fell"} from ${n(a.area_km2)} km² in ${a.year} to ${n(b.area_km2)} km² in ${b.year}: ${b.area_km2 >= a.area_km2 ? "up" : "down"} ${n(Math.abs(b.area_km2 - a.area_km2))} km² (${n(Math.abs((b.area_km2 - a.area_km2) / a.area_km2) * 100, 1)}%).`;
  const measured = "Measured from satellite (Global Mangrove Watch).", whole = `${change(first, last, "Mapped mangrove area")} ${measured}`;
  const since = ask(/since|\bfrom\b|after|over the (last|past)|between/);
  for (const y of years.filter((v) => v <= last.year)) {
    const row = at(y);
    if (row && since && y < last.year) say.push(`${change(row, last, "Mapped mangrove area")} ${measured}`);
    else if (row) say.push(`In ${y} the mapped mangrove area was ${n(row.area_km2)} km² (measured from satellite, Global Mangrove Watch).`);
    else {
      const before = seen.filter((r) => r.year < y).at(-1), after = seen.find((r) => r.year > y);
      say.push(`There is no mangrove map for ${y}. The nearest ${before && after ? `are ${before.year} (${n(before.area_km2)} km²) and ${after.year} (${n(after.area_km2)} km²)` : `is ${(before ?? after).year} (${n((before ?? after).area_km2)} km²)`}.`);
    }
  }
  if (!years.length && ask(/\bnow\b|current|today|latest|at present|these days|right now/)) say.push(`The latest map (${last.year}) shows ${n(last.area_km2)} km² of mangroves (measured from satellite, Global Mangrove Watch).`);
  if (ask(/earliest|first|oldest|start|began|begin/)) say.push(`The earliest mangrove map is from ${first.year}: ${n(first.area_km2)} km².`);
  if (ask(/no map|missing|gaps?\b|which years|not mapped|without a map|have no/)) say.push(gaps.length ? `There is no mangrove map for ${ranges(gaps)}. Maps exist for ${seen.length} years between ${first.year} and ${last.year}.` : `Every year from ${first.year} to ${last.year} has a mangrove map.`);
  if (ask(/peak|highest|largest|biggest|maximum|lowest|smallest|minimum/)) {
    const top = seen.reduce((a, r) => (r.area_km2 > a.area_km2 ? r : a)), low = seen.reduce((a, r) => (r.area_km2 < a.area_km2 ? r : a));
    say.push(`The largest mapped mangrove area is ${n(top.area_km2)} km² (${top.year}) and the smallest ${n(low.area_km2)} km² (${low.year}).`);
  }
  const future = years.filter((y) => y > last.year);
  if (future.length || ask(FUTURE) || ask(/worst|best|good case|normal case|decline/)) {
    const named = ["worst", "good", "normal"].filter((sc) => ask(new RegExp(sc === "good" ? "good|best" : sc)));
    for (const sc of named.length ? named : ["normal", "good", "worst"]) {
      const line = rows.filter((r) => r.scenario === sc);
      if (line.length) say.push(`${change(line[0], line.find((r) => r.year === future[0]) ?? line.at(-1), `Projected, ${sc} case: mangrove area`, true)} This is the team's scenario, not a measurement.`);
    }
  }
  if (!say.length) { say.push(whole); if (gaps.length) also.push(`No map exists for ${ranges(gaps)}.`); } // the gaps matter to someone reading the whole record, not to someone asking about one year
  else if (!say.some((l) => l.startsWith("Mapped mangrove area"))) also.push(whole);
  return { title: "Mangroves", tool: "mangrove_area", say, also, source: "mangrove_area (Global Mangrove Watch extracts supplied by the project team)" };
}

/* ---------- coastal erosion ---------- */
async function erosion({ s, ask, years }) {
  if (!/erosion|erod|land (lost|loss)|lost land|shoreline|retreat/.test(s)) return null;
  const e = JSON.parse(await runTool("erosion_summary", {}, 100000)), seen = e.observed_periods ?? [], ahead = e.projected_running_total_km2 ?? {};
  if (!seen.length) return null;
  const total = seen.at(-1), say = [], span = (p) => `${p.from}–${p.to}`, targets = Object.keys(ahead).map(Number).sort((a, b) => a - b), lastY = targets.at(-1);
  const mapped = `Mapped (observed): ${n(total.running_total_km2)} km² of land was lost to the sea between ${seen[0].from} and ${total.to}.`;
  const projected = targets.length ? `Projected (CA-Markov model, not a measurement): a further ${list(targets.map((y) => `${n(ahead[y] - total.running_total_km2)} km² by ${y}`))}, about ${n((ahead[lastY] - total.running_total_km2) / (lastY - total.to))} km² a year.` : null;
  const most = seen.reduce((a, p) => (p.lost_km2 > a.lost_km2 ? p : a)), least = seen.reduce((a, p) => (p.lost_km2 < a.lost_km2 ? p : a));
  const periods = `By period: ${seen.map((p) => `${span(p)} ${n(p.lost_km2)} km²`).join("; ")}.`;
  if (ask(/which (period|decade|years)|when was|most land|least land|fastest|slowest|worst (period|decade)|in which/)) say.push(`The most land was lost in ${span(most)}: ${n(most.lost_km2)} km². The least was in ${span(least)}: ${n(least.lost_km2)} km².`);
  if (projected && (years.some((y) => y > total.to) || ask(FUTURE) || ask(/more land/))) say.push(projected);
  if (ask(/each (period|decade)|by (period|decade)|per (period|decade)|break ?down/)) say.push(periods);
  if (ask(/how fast|how quick|\brate\b|per year|a year|each year|speed/)) say.push(`Land was lost at about ${list(seen.map((p) => `${n(p.lost_km2 / (p.to - p.from), 1)} km² a year in ${span(p)}`))} (mapped).${targets.length ? ` The projection continues at about ${n((ahead[lastY] - total.running_total_km2) / (lastY - total.to), 1)} km² a year.` : ""}`);
  if (!say.length) say.push(mapped);
  return { title: "Coastal erosion", tool: "erosion_summary", say, also: [mapped, periods, projected].filter((l) => l && !say.includes(l)), source: "erosion_area (eroded-area polygons by period supplied by the project team; projection = CA-Markov run)" };
}

/* ---------- plastics: the sampling stations ---------- */
const GENERIC = new Set(["creek", "outer", "mouth", "estuary", "coastal", "basin", "mangrove", "channel", "mudflats", "reserve", "river", "sindh", "bandar"]);
const METALS = [[/cadmium|\bcd\b/, "cadmium", "Cd_ppm"], [/\blead\b|\bpb\b/, "lead", "Pb_ppm"], [/chromium|\bcr\b/, "chromium", "Cr_ppm"]];
async function plastics({ s, q, ask, back }) {
  if (!/plastic|polymer|debris|litter|heavy metal|metals?\b|cadmium|\blead\b|chromium|stations?\b|sampling/.test(s)) return null;
  const all = (await doc("dmjm_doc", "stations"))?.rows ?? [];
  if (!all.length) return null;
  /* the places asked about, from the stations' own names: a creek's name picks that station, a district picks all of its stations */
  const words = new Set(all.flatMap((r) => `${r.Site_Name} ${r.District} ${r.Tehsil_Taluka}`.toLowerCase().split(/[^a-z]+/)).filter((w) => w.length > 3 && !GENERIC.has(w)));
  const placesIn = (text) => [...words].filter((w) => new RegExp(`\\b${w}\\b`).test(text));
  const mine = placesIn(q), named = mine.length ? mine : back.map(placesIn).find((p) => p.length) ?? []; // a follow-up with no place of its own keeps the place last spoken of
  const groups = named.map((w) => { const site = all.filter((r) => r.Site_Name.toLowerCase().includes(w)); return { label: site.length === 1 ? site[0].Site_Name : cap(w), rows: site.length ? site : all.filter((r) => `${r.District} ${r.Tehsil_Taluka}`.toLowerCase().includes(w)) }; }).filter((g) => g.rows.length);
  const scope = groups.length ? [...new Set(groups.flatMap((g) => g.rows))] : all, say = [], also = [];
  const span = (rows, field, unit) => { const have = [...rows].sort((a, b) => a[field] - b[field]), lo = have[0], hi = have.at(-1); return rows.length === 1 ? `${lo[field]} ${unit}` : `between ${lo[field]} ${unit} (${lo.Site_Name}) and ${hi[field]} ${unit} (${hi.Site_Name}), ${n(have.reduce((a, r) => a + r[field], 0) / have.length)} on average`; };
  const ends = (rows, field) => { const have = [...rows].sort((a, b) => a[field] - b[field]); return [have[0], have.at(-1)]; };
  const where = (r) => `${r.Site_Name} (${r.District})`, wide = groups.length ? groups : [{ label: `All ${all.length} stations`, rows: all }];
  const metals = ask(/heavy metal|metals\b/) ? METALS : METALS.filter(([re]) => ask(re)), extreme = ask(/\bmost\b|\bleast\b|highest|lowest|worst|cleanest|dirtiest|maximum|minimum|where is|which (station|site|place)/);
  const overall = (g) => `${g.label}${groups.length && g.rows.length > 1 ? ` (${g.rows.length} stations)` : ""}: plastic debris is ${span(g.rows, "Plastic_Count_per_m2", "pieces per m²")}; risk ${list([...new Set(g.rows.map((r) => r.Risk_Level))])}.`;
  const detail = (r) => `${r.Site_Name} (${r.Site_ID}, ${r.District}): ${r.Plastic_Count_per_m2} pieces of plastic per m², mainly ${r.Primary_Polymer}; cadmium ${r.Cd_ppm}, lead ${r.Pb_ppm}, chromium ${r.Cr_ppm} ppm; risk ${r.Risk_Level}.`;
  if (ask(/how many (plastic |sampling |debris )*(stations|sites)|number of (stations|sites)/)) {
    const per = Object.entries(all.reduce((m, r) => ({ ...m, [r.District]: (m[r.District] ?? 0) + 1 }), {}));
    say.push(`The portal has ${all.length} plastic-debris sampling stations, all in ${[...new Set(all.map((r) => r.Province))].join(" and ")}: ${per.map(([d, c]) => `${c} in ${d}`).join(", ")}. They were sampled on ${dates(all.map((r) => r.Sampling_Date))}.`);
  }
  if (ask(/polymer|kind of plastic|type of plastic|types of plastic|what plastic|made of|common/)) for (const r of scope.slice(0, 5)) say.push(`At ${where(r)} the most common plastic is ${r.Primary_Polymer}.`);
  for (const [, name, field] of metals) {
    if (extreme && !groups.length) { const [lo, hi] = ends(all, field); say.push(`${cap(name)} is highest at ${where(hi)}: ${hi[field]} ppm in sediment. It is lowest at ${where(lo)}: ${lo[field]} ppm.`); continue; }
    for (const g of wide) say.push(`${g.label}${groups.length && g.rows.length > 1 ? ` (${g.rows.length} stations)` : ""}: ${name} in sediment is ${span(g.rows, field, "ppm")}.`);
  }
  if (extreme && !metals.length && scope.length > 1) { const [lo, hi] = ends(scope, "Plastic_Count_per_m2"); say.push(`The most plastic is at ${where(hi)}: ${hi.Plastic_Count_per_m2} pieces per m². The least is at ${where(lo)}: ${lo.Plastic_Count_per_m2} pieces per m².`); }
  if (ask(/risk|alert|danger|severe|emergency|how bad/)) for (const r of scope.slice(0, 5)) say.push(`${where(r)}: risk ${r.Risk_Level}, alert ${r.Emergency_Alert_Level}; ${r.Plastic_Count_per_m2} pieces of plastic per m².`);
  const asked = say.length > 0; // a specific question was answered; otherwise the general picture is the answer
  if (!asked) for (const g of wide) if (g.rows.length > 1) say.push(overall(g));
  const top = [...scope].sort((a, b) => b.Plastic_Count_per_m2 - a.Plastic_Count_per_m2);
  if (!asked) for (const r of top.slice(0, groups.length > 1 ? 0 : groups.length ? 4 : 2)) (groups.length ? say : also).push(detail(r));
  return { title: groups.length ? `Plastics at ${list(groups.map((g) => g.label))}` : "Plastics", tool: "plastics_stations", say, also, source: `dmjm:stations (field sampling, ${dates(scope.map((r) => r.Sampling_Date))}, supplied by the project team)` };
}

/* ---------- plastics: what is in the seafood, and the hazards ---------- */
const SPECIES = [[/oyster/, /oyster/i], [/crab/, /crab/i], [/prawn|shrimp/, /prawn/i], [/mullet|\bboi\b/, /mullet/i], [/hilsa|palla|shad/, /hilsa/i], [/grunter|dhotar/, /grunter/i], [/snapper|\bhira\b/, /snapper/i], [/sea ?bass|dangri|barramundi/, /seabass/i]];
async function seafood({ s, ask }) {
  const about = /oyster|crab|prawn|shrimp|mullet|hilsa|palla|grunter|snapper|sea ?bass|seafood|shellfish|food web|biomagnif|species|safe to eat|\beat(ing)? (the |local |delta )?(fish|catch)/.test(s), hazard = /hazard|toxic|human health|health risk|danger/.test(s) && /plastic|debris|seafood|oyster|fish/.test(s);
  if (!about && !hazard) return null;
  const species = (await doc("dmjm_doc", "species"))?.rows ?? [], hazards = (await doc("dmjm_doc", "hazards"))?.rows ?? [], say = [], also = [];
  const line = (r) => `${r.Common_Name} (${r.Species}): on average ${r.Microplastic_ingested_avg} microplastic particles per animal and a heavy-metal burden of ${r.Heavy_Metal_Burden_ug_g} µg/g; human risk rated "${r.Human_Risk}".`;
  const danger = (h) => `Hazard, ${h.hazard.toLowerCase()}: ${h.metric} (severity ${h.severity} of 10, ${h.severity_label.toLowerCase()}).`;
  const named = SPECIES.filter(([re]) => re.test(s)).map(([, name]) => species.find((r) => name.test(r.Common_Name))).filter(Boolean);
  if (about) {
    for (const r of named) say.push(ask(/safe|\beat/) ? `The portal has no official food-safety advice, but its plastics data rates the human risk from eating ${r.Common_Name} as "${r.Human_Risk}": on average ${r.Microplastic_ingested_avg} microplastic particles per animal and a heavy-metal burden of ${r.Heavy_Metal_Burden_ug_g} µg/g.` : line(r));
    if (!named.length && species.length) {
      const up = [...species].sort((a, b) => a.Trophic_Level - b.Trophic_Level), lo = up[0], hi = up.at(-1);
      say.push(`Microplastics and metals build up along the food web: from ${lo.Common_Name} (${lo.Microplastic_ingested_avg} particles per animal, ${lo.Heavy_Metal_Burden_ug_g} µg/g of heavy metals) to ${hi.Common_Name}, a top predator (${hi.Microplastic_ingested_avg} particles, ${hi.Heavy_Metal_Burden_ug_g} µg/g).`);
      for (const r of [...up].reverse().slice(0, 4)) say.push(line(r));
    }
  }
  const people = hazards.filter((h) => /human|chemical/i.test(h.category));
  if (hazard && !about) for (const h of hazards.slice(0, 5)) say.push(danger(h)); else for (const h of people.slice(0, 2)) also.push(danger(h));
  if (!say.length) return null;
  return { title: named.length ? `Plastics in ${list(named.map((r) => r.Common_Name))}` : "Plastics in seafood", tool: "plastics_food", say, also, source: "dmjm:species, dmjm:hazards (supplied by the project team)" };
}

/* ---------- ocean: heatwaves, temperature, acidity, oxygen, fish stocks, exposure ---------- */
const REGIONS = [[/sindh/, "Sindh shelf"], [/makran|balochistan/, "Makran shelf"], [/offshore|open sea/, "Offshore EEZ"]];
const waters = (reg) => (reg === "Whole EEZ" ? "Pakistan's waters (whole EEZ)" : `the ${reg.replace("EEZ", "part of the EEZ")} waters`);
const outlook = async () => (await doc("ocean_doc", "data/outlook_thresholds")) ?? [];
const OCEAN = [
  { topic: "heatwave", title: "Marine heatwaves", ask: /heat ?waves?|hot spells?|heat spells?/, finding: /heatwave/i,
    now: async (reg) => { const r = (await doc("ocean_doc", "data/mhw_summary"))?.find((x) => x.region === reg && x.definition === "fixed"); return r && `Measured in ${waters(reg)}: ${n(r.days_last5, 0)} marine heatwave days a year over the last five years, against ${n(r.days_mean_1991_2020, 0)} a year in 1991–2020. Worst years: ${r.top3_years_days}. Rising by ${n(r.days_trend_per_decade, 0)} days per decade.`; } },
  { topic: "temperature", title: "Sea temperature", ask: /temperature|warming|warmer|\bwarm\b|\bsst\b|\bhot(ter)?\b|heating/, finding: /warmed|heatwave conditions/i,
    now: async (reg) => { const r = (await doc("ocean_doc", "data/sst_summary"))?.find((x) => x.region === reg); return r && `Measured from satellite in ${waters(reg)}: the sea surface is warming by ${r.trend_per_decade_1982_2025} °C per decade (1982–2025). The last five years were ${r.last5_anomaly_c} °C above the long-term average of ${r.baseline_mean_c} °C, and the warmest year was ${r.warmest_year} (+${r.warmest_anomaly_c} °C).`; } },
  { topic: "ph", title: "Ocean acidity", ask: /acidif|\bph\b|acidic|acidity|\bacid\b/, finding: /acidic|acidity/i,
    now: async (reg) => { const r = (await doc("ocean_doc", "data/ph_summary_regions"))?.find((x) => x.region === reg && /LSCE/.test(x.product)), [a, b] = String(r?.first_last_ph ?? "").split("/").map(Number); return r && `Reconstructed from observations (${r.product}) for ${waters(reg)}: surface pH fell from ${n(a, 2)} to ${n(b, 2)} between the first and last year of the record, ${n(Math.abs(r.ols_per_decade), 3)} per decade. Lower pH means more acidic.`; },
    later: async () => { const o = await outlook(); return o.length ? `Projected surface pH in 2050: ${list(o.map((x) => `${n(x.ph_2050, 3)} under ${x.scenario}`))}; that is ${list(o.map((x) => `${n(x.h_pct_2050_vs_1985, 0)}%`))} more acidity than in 1985.` : null; } },
  { topic: "aragonite", title: "Shell-building conditions (aragonite)", ask: /aragonite|omega|shell.?build|saturation/, finding: /shell-building conditions|boundary/i,
    now: async (reg) => { const r = (await doc("ocean_doc", "data/omega_summary_regions"))?.find((x) => x.region === reg && /LSCE/.test(x.product)), [a, b] = String(r?.first_last ?? "").split("/").map(Number); return r && `Reconstructed from observations (${r.product}) for ${waters(reg)}: aragonite saturation fell from ${n(a, 2)} to ${n(b, 2)} between the first and last year of the record, ${n(Math.abs(r.ols_per_decade), 3)} per decade. Below 3 is stressful for shell-builders; below 1 shells dissolve.`; },
    later: async () => { const o = await outlook(); return o.length ? `Projected aragonite saturation in 2050: ${list(o.map((x) => `${n(x.omega_2050, 2)} under ${x.scenario}`))}.` : null; } },
  { topic: "oxygen", title: "Oxygen", ask: /oxygen|hypoxi|dead zone|plankton/, finding: /oxygen/i, findingFirst: true,
    now: async (reg) => {
      const rows = ((await doc("ocean_doc", "data/o2_trends")) ?? []).filter((x) => x.region === reg && x.product === "GOBAI-O2 v2.3" && x.years === "2004-2024"), m = (id) => rows.find((x) => x.metric === id);
      const part = (id, label) => (m(id) ? `${label} averages ${n(m(id).mean, 1)} µmol/kg, changing by ${m(id).trend > 0 ? "+" : ""}${n(m(id).trend, 1)} µmol/kg per decade${m(id).significant ? "" : " (not significant)"}` : null);
      const parts = [part("o2_0m", "surface oxygen"), part("o2_0_100", "the top 100 m"), part("o2_100_600", "100 to 600 m")].filter(Boolean);
      return parts.length ? `Observation-based (GOBAI-O2 v2.3: Argo floats and ships, 2004–2024) for ${waters(reg)}: ${parts.join("; ")}. The catalogue marks these trends as not robust.` : null;
    } },
  { topic: "fisheries", title: "Fish stocks", ask: /\bstocks?\b|fisher|\bcatch\b|overfish|over-fish|\bfish\b|fishing/, finding: /depleted stocks/i,
    now: async () => { const r = (await doc("ocean_doc", "data/stock_status_indicator"))?.[0]; return r && `In ${r.year}, ${n(r.share_stocks_overexploited_collapsed_pct, 1)}% of the ${r.stocks} assessed fish stocks were overexploited or collapsed, and ${n(r.share_catch_overexploited_collapsed_pct, 1)}% of the catch came from them (${n(r.share_catch_5yr_mean_pct, 1)}% on a five-year average). This is a catch-based estimate, not an official stock assessment.`; } },
  { topic: "exposure", title: "Climate exposure of the sea", ask: /exposure|vulnerab|climate pressure|potential impact/, finding: /exposed|climate pressure/i,
    now: async (reg) => { const r = (await doc("ocean_doc", "data/exposure_summary"))?.find((x) => x.region === reg); return r && `Climate exposure index (0 to 1, heat plus acidification) for ${waters(reg)}: ${n(r.exposure_now)} now against ${n(r.exposure_1991_2020)} in 1991–2020, rising ${n(r.exposure_trend_per_decade, 3)} per decade.`; } },
];
async function ocean({ s, ask, years }, deltaWanted) {
  const topics = OCEAN.filter((t) => t.ask.test(s) && !(t.topic === "exposure" && deltaWanted));
  if (!topics.length) return [];
  const region = REGIONS.find(([re]) => re.test(s))?.[1] ?? "Whole EEZ", findings = (await doc("ocean_doc", "findings"))?.findings ?? [], future = years.some((y) => y > 2026) || ask(FUTURE), sections = [];
  const told = (f) => `${f.headline}${f.number ? `: ${f.number.value} ${f.number.caption}` : ""}.${f.sub_numbers?.length ? ` ${f.sub_numbers.slice(0, 2).join("; ")}.` : ""}${ask(/\bmean\b|\bmeans\b|matter|so what|effect|impact|important|consequence/) ? ` What it means: ${f.so_what}` : ""}${ask(/how sure|confiden|reliab|certain|trust|accura/) ? ` How sure: ${f.confidence}` : ""}`;
  for (const t of topics) {
    const now = (await t.now(region)) ?? (region !== "Whole EEZ" ? await t.now("Whole EEZ") : null), later = t.later ? await t.later() : null;
    const found = findings.filter((f) => t.finding.test(f.headline)), ahead = found.filter((f) => /2050/.test(f.headline)).map(told), today = found.filter((f) => !/2050/.test(f.headline)).map(told);
    const say = (future ? [ahead[0], later] : t.findingFirst ? [today[0], now] : [now, today[0]]).filter(Boolean), also = (future ? [now, today[0]] : [later ?? ahead[0], today[1]]).filter(Boolean);
    if (!say.length && also.length) say.push(also.shift());
    if (say.length) sections.push({ title: t.title, tool: "ocean_summary", say, also, source: "ocean:findings and the ocean package's summary tables" });
  }
  return sections;
}

/* ---------- the Indus Delta: salt water, groundwater, sea level, river flow ---------- */
const DELTA = [[/saltwater|salt water|intrusion|salt wedge/, "saltwater"], [/groundwater|aquifer|fresh ?water|\blens\b|tube ?wells?/, "groundwater"], [/sea.?level|tide gauge|inundat|subsid|sinking|flood/, "sea_level"],
  [/salt.affected|saline (soil|land)|tidal flat|soil salinity/, "salt_land"], [/shelf salinity|plume|turbid/, "shelf"], [/kotri|river flow|indus flow|discharge|barrage/, "river_flow"]];
const EFFECTS = /effect|impact|consequence|exposure|exposed|affect|harm|damage|threat|\bdo(es)? to\b|crops?\b|livestock|farm|agricultur|drinking|incomes?\b|livelihood|people/;
const WHY = /\bwhy\b|reason|cause|driver|due to|because|behind/;
const effects = (s) => EFFECTS.test(s.replace(/salt.affected/g, "")); // "salt-affected land" names a dataset, it does not ask about effects
function deltaTopics(s) {
  const want = new Set(DELTA.filter(([re]) => re.test(s)).map(([, topic]) => topic)), salty = /salinity|saline|\bsalt(y|ier|iness)?\b/.test(s);
  if (salty && !want.has("salt_land")) { want.add("saltwater"); want.add("shelf"); } // "salinity" alone: salt in the river (projected) and the measured salinity at sea
  if (salty || want.has("saltwater")) {
    if (WHY.test(s)) want.add("river_flow"); // the flow scenarios are the data's own explanation
    if (effects(s)) { want.delete("shelf"); want.add("groundwater"); want.add("salt_land"); } // what salt does on land, as far as the data goes
  }
  return want;
}
async function delta({ s }, want) {
  if (!want.size) return [];
  const scenario = s.match(/ssp ?-?(1-?2\.?6|2-?4\.?5|5-?8\.?5)/)?.[1]?.replace(/\D/g, "") ?? (/high(est|er)? emissions?|worst.case emissions?/.test(s) ? "585" : /low(est|er)? emissions?|best.case emissions?/.test(s) ? "126" : undefined), zone = s.match(/karachi|keti ?bandar|sujawal|bela|sonmiani/)?.[0]?.replace(" ", ""), sections = [];
  for (const topic of [...want].slice(0, 4)) {
    const r = JSON.parse(await runTool("delta_series", { topic, ...(scenario ? { scenario: `ssp${scenario}` } : {}), ...(zone ? { place: zone } : {}) }, 100000));
    if (!r.statements?.length) continue;
    const say = r.statements.slice(0, r.core || 3); // the main measure at the place asked about; other places and side measures are left out
    if (WHY.test(s) && r.driver) say.unshift(r.driver); // "why?" is answered first, then the figures behind it
    sections.push({ title: r.title, tool: "delta_series", say, also: [], source: r.source });
  }
  if (sections.length && effects(s) && (want.has("saltwater") || want.has("salt_land"))) sections.at(-1).missing = "the effects of salt on crops, livestock, fish catch, drinking water, health and incomes, and how many people are exposed. The portal's data covers two effects only: fresh groundwater and salt-affected land.";
  return sections;
}

/* ---------- the portal itself ---------- */
async function health({ s, ask }) {
  const thing = /\b(layers?|maps?|portal|site|website|server|system|database|postgres|redis|cache|app|timeline|images?|pictures?)\b/.test(s), state = /\b(work|works|working|health|healthy|status|broken|fail|fails|failed|failing|down|online|running|ok|okay|fine|up|load|loading|loaded|slow|stuck|frozen|hang(s|ing)?|crash(ed|es|ing)?|errors?|problems?|issues?|doing)\b/.test(s);
  if (!(thing && state) && !/system health|health (check|report)|diagnos/.test(s)) return null;
  const d = await diagnostics(), checks = d.checks ?? [], bad = checks.filter((c) => c.status !== "ok"), say = [], also = [], group = (g) => checks.filter((c) => c.group === g);
  const one = (c) => `${c.name}: ${c.status === "ok" ? "" : `${c.status.toUpperCase()}, `}${c.detail}`;
  const overall = bad.length ? `${bad.length} of ${checks.length} checks need attention: ${bad.map(one).join("; ")}.` : `Everything is working: all ${checks.length} checks are ok (services, layer data, caches and the machine).`;
  const layers = `Layer data: ${group("Layer data").map((c) => `${c.name}${c.status === "ok" ? "" : ` (${c.status})`}, ${c.detail}`).join("; ")}.`, services = `Services: ${group("Services").map(one).join("; ")}.`;
  if (ask(/year map|maps? .*(fail|load|slow|missing|blank)|(fail|load|slow|missing|blank).* maps?|images?|pictures?|timeline/)) {
    const a = JSON.parse(await runTool("access_summary", { hours: 24 }, 100000)), img = (a.routes ?? []).filter((r) => /\/api\/amib\/image/.test(r.route));
    say.push("A year map on the timeline is one picture requested from the server. It fails to appear when the picture for that year or layer does not exist or could not be drawn (the request returns an error), or when drawing is slow: pictures are drawn on demand by a small pool, so many years asked for at once wait in a queue, and playback moves on before the picture arrives.");
    say.push(img.length ? `In the last ${a.hours} hours there were ${n(img.reduce((t, r) => t + r.requests, 0), 0)} year-map picture requests; ${img.reduce((t, r) => t + r.errors, 0)} failed, and the slowest took ${n(Math.max(...img.map((r) => r.slowest_ms)) / 1000, 1)} seconds.` : "No year-map picture requests are in the access log for the last 24 hours.");
    also.push(overall);
  } else {
    const named = checks.filter((c) => c.name.toLowerCase().split(/[^a-z]+/).some((w) => w.length > 4 && new RegExp(`\\b${w}`).test(s)) || (/database|postgres|\bdb\b/.test(s) && /postgres/i.test(c.name)) || (/redis|cache/.test(s) && /redis/i.test(c.name)));
    for (const c of named.slice(0, 3)) say.push(`${one(c)}.`);
    say.push(overall);
    if (!named.length) { say.push(layers); also.push(services); } // asked about one thing (the database, a layer): that line and the overall verdict are the answer
  }
  return { title: "Portal status", tool: "system_health", say, also, source: "the portal's own health report, run just now" };
}

/* ---------- what the portal holds, and what its words mean ---------- */
function holdings({ q }) {
  if (!/what (data|datasets|layers|topics)|which (data|datasets|layers|topics)|what (do|can) you (have|know|cover|answer)|what('?s| is) in the portal|list (the |your |all )*(data|datasets|layers)|what can i ask/.test(q)) return null;
  return { title: "What the portal holds", tool: "list_datasets", also: [], say: [
    "The portal holds: mangrove area year by year, with projections to 2050; land lost to coastal erosion by period, with a projection; plastic debris and heavy metals at the sampling stations, with what was found in seafood and the hazards; for Pakistan's sea: marine heatwaves, temperature, acidity, shell-building conditions, oxygen, fish stocks and climate exposure; and for the Indus Delta: salt water in the river, fresh groundwater, sea level, salt-affected land and the river flow below Kotri.",
    "Not loaded: earthquake and seismic records, sea-floor depth (bathymetry) change, and raw Google Earth Engine exports.",
    "I can also tell you whether the portal, its database and each layer are working.",
  ] };
}
const GLOSSARY = [
  [/\bpsu\b/, "psu (practical salinity unit) measures how salty water is, roughly grams of salt in a kilogram of water. Sea water is about 35 psu, fresh water below 0.5; the portal draws the salt front in the river at 1 psu."],
  [/\bmaf\b|acre.?f(ee|oo)t/, "MAF is million acre-feet, the unit Pakistan uses for river water. One MAF is about 1.23 cubic kilometres (1.23 billion cubic metres)."],
  [/\beez\b|exclusive economic zone/, "The EEZ (Exclusive Economic Zone) is the sea out to 200 nautical miles from the coast, where Pakistan holds the rights to fish and other resources. The portal's ocean figures for \"Pakistan's waters\" cover it."],
  [/\bssp ?-?\d|\bssps?\b|emissions? scenario/, "SSP scenarios are the futures used in the IPCC's sixth assessment: ssp126 is low emissions, ssp245 medium and ssp585 high. The portal shows ssp245 unless you ask for another."],
  [/aragonite|omega/, "Aragonite saturation says how easily shell-building animals can make their shells from sea water. Above 3 conditions are comfortable, below 3 they become stressful, and below 1 shells begin to dissolve."],
  [/\bph\b/, "pH measures acidity: the lower the pH, the more acidic the water. A fall of 0.1 means about 26% more acidity (hydrogen ions)."],
  [/ca.?markov/, "CA-Markov is a model that projects how land will change by carrying the changes mapped in the past forward, cell by cell. The portal's erosion projection is a CA-Markov run, not a measurement."],
  [/heat ?wave/, "A marine heatwave is a spell of at least five days when the sea surface is hotter than 90% of the temperatures recorded for that time of year (the Hobday definition the portal uses, against 1991–2020)."],
  [/hypoxi|low.oxygen|oxygen.poor/, "Hypoxic water has less than 2 mg of oxygen per litre: too little for most fish and shellfish."],
  [/(accord|current|degraded) flow|flow scenario/, "The flow scenarios are assumptions about how much Indus water reaches the delta: accord flow is the release promised by the water accord, current flow is as today, and degraded flow is less than today."],
  [/\bp50\b|likely range|percentile/, "The middle estimate (p50) has an equal chance of being too high or too low. The \"likely\" range runs from the 17th to the 83rd percentile: about a two-in-three chance that the truth lies inside it."],
  [/mangrove watch|\bgmw\b/, "Global Mangrove Watch is a worldwide satellite mapping of mangrove extent, year by year. The portal's mangrove areas are extracts from it supplied by the project team."],
  [/trophic/, "Trophic level is an animal's place in the food web: about 2 for those eating plants and detritus, 4 and above for top predators. Pollutants build up as the level rises."],
  [/\bppm\b/, "ppm is parts per million: milligrams of the metal in each kilogram of sediment."],
];
function glossary({ q }) {
  if (!/what (is|are|does|do)|what'?s\b|whats\b|mean(s|ing)?\b|define|definition|stand(s)? for|explain/.test(q)) return null;
  const found = GLOSSARY.filter(([re]) => re.test(q)).map(([, text]) => text);
  return found.length ? { title: "What it means", tool: "glossary", say: found.slice(0, 3), also: [], source: "the portal's glossary (definitions, not measurements)" } : null;
}

function notLoaded({ s }) {
  const what = [[/earthquake|seismic|tsunami|tremor|quake/, "earthquake, seismic and tsunami records"], [/shelf depth|continental shelf|bathymetr|seabed depth|sea ?floor depth/, "continental-shelf depth (bathymetry) change"], [/earth engine|\bgee\b/, "raw Google Earth Engine exports"]].filter(([re]) => re.test(s)).map(([, name]) => name);
  return what.length ? { title: "Not in the portal", tool: "list_datasets", say: [`The portal has no data on ${list(what)}. ${what.length > 1 ? "They are" : "That is"} not loaded, so I can give no figures for ${what.length > 1 ? "them" : "it"}.`], also: [] } : null;
}

/** The answer, written from the data, or null when the question is not one of the kinds above. */
export async function answerDirect(question, earlier = [], { short = false } = {}) {
  const { q, s, followUp, back } = subject(question, earlier);
  const ctx = { q, s, followUp, back, ask: (re) => re.test(q) || (followUp && re.test(s)), years: yearsIn(q).length || !followUp ? yearsIn(q) : yearsIn(s) };
  let sections;
  const status = await health(ctx);
  if (status) sections = [status]; // "are the maps loading?" is about the portal, not about the data on the maps
  else {
    const want = deltaTopics(s);
    const food = await seafood(ctx), atStations = !food || /station|debris|litter|sediment|sampling|creek|sites?\b|karachi|korangi|thatta|sujawal|badin/.test(s); // "microplastics in crabs" is about the animals, not the stations
    sections = [holdings(ctx), glossary(ctx), await mangroves(ctx), await erosion(ctx), atStations ? await plastics(ctx) : null, food, ...(await delta(ctx, want)), ...(await ocean(ctx, want.size > 0)), notLoaded(ctx)].filter(Boolean);
  }
  if (!sections.length) return null;
  /* how much to show: everything that answers the question (within reason), and context only while the answer is brief */
  const single = sections.length === 1, most = short ? 1 : single ? 5 : sections.length === 2 ? 3 : 2;
  const body = sections.map((sec) => {
    const said = sec.say.slice(0, most), more = short || !single ? [] : sec.also.slice(0, said.length >= 3 ? 0 : said.length === 2 ? 1 : 2), [head, ...rest] = [...said, ...more];
    return `${single ? "" : `${sec.title}: `}${head}${rest.map((l) => `\n- ${l}`).join("")}`;
  }).join("\n\n");
  const missing = sections.map((sec) => sec.missing).filter(Boolean), sources = [...new Set(sections.map((sec) => sec.source).filter(Boolean))];
  /* what the portal cannot answer comes first: it is the honest reply to that part of the question */
  return { answer: [missing.length ? `Not loaded in the portal: ${missing.join("; ")}\n\nWhat the data does show:` : "", body, sources.length ? `Source: ${sources.join("; ")}.` : ""].filter(Boolean).join("\n\n"), tools: [...new Set(sections.map((sec) => sec.tool))] };
}
