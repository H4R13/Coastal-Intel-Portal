/**
 * Plastic debris and biomagnification (the DMJM material), served by the data API under api/dmjm/.
 * Two kinds of thing, kept apart because they are not the same kind of evidence:
 *   the team's data, read out of their page by server/load-dmjm.mjs
 *     stations     sampling stations in the Indus Delta creeks: plastic density, sediment metals, people exposed
 *     literature   published microplastic measurements along the coast, with the papers they come from
 *     species      microplastics and heavy metals in eight food-web species, by trophic level
 *     hazards      seven hazard pathways and their severity scores
 *   two models, formulas with assumed inputs copied from the team's two simulation pages; no measurements go in
 *     index        "plastic debris outlook": a relative index, 2020 = 100, growing at an assumed yearly rate
 *     biomag       "biomagnification outlook": the same kind of index carried up a four-step food chain
 * Everything resolves to null when the API is not running.
 */
const docs = new Map();
function loadDoc(key) {
  if (!docs.has(key)) docs.set(key, fetch(`api/dmjm/${key}`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  return docs.get(key);
}
/** { stations: [rows], species: [rows], hazards: [rows], literature: { sites, biota, references } } or null */
export async function loadPlastics() {
  const [stations, species, hazards, literature] = await Promise.all(["stations", "species", "hazards", "literature"].map(loadDoc));
  return stations && species && hazards && literature ? { stations: stations.rows, species: species.rows, hazards: hazards.rows, literature } : null;
}

export const DENSITY_UNIT = "pieces per m²";
const TOPIC_IDS = ["stations", "literature", "species", "hazards", "index", "biomag"];
export function viewOf(s) {
  const v = { topic: "stations", growth: 4, tmf: 2, after: "continue", ...s.plasticsView };
  return TOPIC_IDS.includes(v.topic) ? v : { ...v, topic: "stations" };
}

/* ---- monitoring points on the map ---- */
const RAMP = [[0, "#14b8a6"], [8, "#84cc16"], [15, "#facc15"], [22, "#fb923c"], [30, "#f43f5e"], [40, "#c026d3"]]; // the team's own colour ramp
export const SCALE_MAX = RAMP.at(-1)[0];
export const PLASTIC_RAMP = `linear-gradient(to right, ${RAMP.map(([v, c]) => `${c} ${(v / SCALE_MAX) * 100}%`).join(", ")})`;
const RISK_COLORS = { Severe: "#f43f5e", High: "#fb923c", Moderate: "#facc15", "Low-Moderate": "#84cc16", Low: "#14b8a6" };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "15–19 March 2026": the days the stations were sampled. */
export function samplingPeriod(d) {
  const dates = d.stations.map((r) => r.Sampling_Date).sort(), first = dates[0], last = dates.at(-1), [y, m, day] = first.split("-");
  if (last.slice(0, 7) !== first.slice(0, 7)) return `${first} to ${last}`;
  return `${+day}${last === first ? "" : `–${+last.slice(8)}`} ${MONTHS[m - 1]} ${y}`;
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const WATER_RAMP = [[250, "#22d3ee"], [550, "#6366f1"], [800, "#a855f7"], [1100, "#f0abfc"]]; // the team's ramp for particles per litre of seawater
export const BIOTA_COLOR = "#f43f5e";
/** What the dots mean, for the panel: [css background, label]. */
export const POINT_KEY = [
  [`linear-gradient(to right, ${WATER_RAMP.map(([, c]) => c).join(", ")})`, `Published seawater and sediment site (${WATER_RAMP[0][0]} to ${WATER_RAMP.at(-1)[0]}+ particles per litre)`],
  [BIOTA_COLOR, "Published fish and crab records"],
];

/**
 * Every monitoring point of the team's map as one collection: the sampling stations (kind "stations"), the published
 * seawater and sediment sites ("water") and the places the published fish and crab records come from ("biota").
 * `pop` is the balloon shown when the dot is clicked.
 */
export function pointsGeojson(d) {
  const point = (lon, lat, properties) => ({ type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] }, properties });
  const places = new Map();
  for (const r of d.literature.biota) places.set(r.area, [...(places.get(r.area) ?? []), r]);
  return {
    type: "FeatureCollection",
    features: [
      ...d.literature.sites.map((r) => point(r.lon, r.lat, { kind: "water", name: r.site, value: r.seawater_particles_per_l,
        pop: `<b>${esc(r.site)}</b><span>${esc(r.province)} · published site</span><strong>${r.seawater_particles_per_l} <small>particles per litre of seawater</small></strong><span>Sediment: ${r.sediment_particles_per_kg} particles per kg</span><span>${esc(r.source)}</span>` })),
      ...[...places].map(([area, rows]) => point(rows[0].lon, rows[0].lat, { kind: "biota", name: area, value: rows.length,
        pop: `<b>${esc(area)}</b><span>${rows.length} published fish and crab records · items per individual</span>${rows.map((r) => `<span><i>${esc(r.species)}</i>: ${esc(r.value)} (${esc(r.tissue)})</span>`).join("")}<span>${[...new Set(rows.map((r) => r.source))].map(esc).join("; ")}</span>` })),
      ...d.stations.map((r) => point(r.Lon, r.Lat, { kind: "stations", name: r.Site_Name, value: r.Plastic_Count_per_m2,
        pop: `<b>${esc(r.Site_Name)}</b><span>${esc(r.District)}</span><strong>${r.Plastic_Count_per_m2} <small>${DENSITY_UNIT}</small></strong><span>${esc(r.Risk_Level)} risk · ${esc(r.Primary_Polymer)}</span><span>Sampled ${r.Sampling_Date}</span>` })),
    ],
  };
}
/** MapLibre colour expressions: the station value, and the seawater value of a published site. */
export const colorExpr = () => ["interpolate", ["linear"], ["get", "value"], ...RAMP.flat()];
export const waterColorExpr = () => ["interpolate", ["linear"], ["get", "value"], ...WATER_RAMP.flat()];

/* ---- figures, in the shape js/ocean/oceanFigures.js draws: { l: catalog-like entry, data } ---- */
const ASSUMED = ["illustrative model", "no measured data"], PUBLISHED = ["published measurements"];
const bar = (id, title, shows, data, chart, badges) => ({ l: { id, title, shows, badges, chart: { type: "horizontal_bar", ...chart } }, data });
const table = (id, title, shows, data, badges) => ({ l: { id, title, shows, badges }, data });

export function stationFigures(d) {
  const when = samplingPeriod(d), n = d.stations.length;
  return [
    bar("plastic_density", "Plastic density at each station", `Plastic pieces counted per square metre at ${n} stations in the Indus Delta creeks, sampled ${when}. Colours show each station's risk level.`, d.stations,
      { x: "Plastic_Count_per_m2", y: "Site_Name", sort: "Plastic_Count_per_m2 descending", color_by: "Risk_Level", colors: RISK_COLORS, x_label: `Plastic ${DENSITY_UNIT}` }),
    bar("plastic_metals", "Heavy metals at each station", "Cadmium, lead and chromium at the same stations, in parts per million.", d.stations,
      { x: ["Cd_ppm", "Pb_ppm", "Cr_ppm"], y: "Site_Name", x_label: "Parts per million (ppm)" }),
    bar("plastic_fisherfolk", "Fisherfolk exposed near each station", "The fishing population exposed around each station.", d.stations,
      { x: "Exposed_Fisherfolk_Pop", y: "Site_Name", sort: "Exposed_Fisherfolk_Pop descending", color_by: "Risk_Level", colors: RISK_COLORS, x_label: "People" }),
    table("plastic_stations", "All sampling stations", `${n} stations, sampled ${when}.`, d.stations),
  ];
}

export function literatureFigures(d) {
  const { sites, biota, references } = d.literature, papers = references.map((r) => r.reference).join("; ");
  return [
    bar("lit_water", "Microplastics in seawater", `Particles per litre of seawater at ${sites.length} sites along the coast. Source: ${sites[0].source}.`, sites,
      { x: "seawater_particles_per_l", y: "site", sort: "seawater_particles_per_l descending", color_by: "province", x_label: "Particles per litre" }, PUBLISHED),
    bar("lit_sediment", "Microplastics in sediment", `Particles per kilogram of dry sediment at the same sites. Source: ${sites[0].source}.`, sites,
      { x: "sediment_particles_per_kg", y: "site", sort: "sediment_particles_per_kg descending", color_by: "province", x_label: "Particles per kg of dry sediment" }, PUBLISHED),
    table("lit_biota", "Microplastics in fish and crabs", `${biota.length} published records of microplastic items per individual, by tissue (GIT = gut). Sources: ${papers}.`, biota, PUBLISHED),
    table("lit_sites", "All published sites", `${sites.length} sites with their coordinates.`, sites, PUBLISHED),
    table("lit_references", "The papers", "Where the published measurements come from.", references),
  ];
}

export function speciesFigures(d) {
  const rows = [...d.species].sort((a, b) => a.Trophic_Level - b.Trophic_Level).map((r) => ({ ...r, name: `${r.Common_Name} · level ${r.Trophic_Level}` }));
  return [
    bar("species_microplastics", "Microplastics eaten, by place in the food chain", "Average microplastic particles found per individual, from the lowest trophic level to the highest.", rows,
      { x: "Microplastic_ingested_avg", y: "name", x_label: "Particles per individual" }),
    bar("species_metals", "Heavy metals in tissue, by place in the food chain", "Heavy-metal burden in tissue, in micrograms per gram of dry weight, in the same order.", rows,
      { x: "Heavy_Metal_Burden_ug_g", y: "name", x_label: "µg per g dry weight", reference_lines: [{ y: 10, label: "Reference line, 10 µg/g" }] }),
    table("species_table", "All species", `${d.species.length} species with their feeding guild, commercial value and risk to people.`, d.species),
  ];
}

export function hazardFigures(d) {
  return [
    bar("hazard_severity", "Severity of each hazard pathway", `${d.hazards.length} hazard pathways scored out of 10.`, d.hazards,
      { x: "severity", y: "hazard", sort: "severity descending", x_label: "Severity (out of 10)", y_range: [0, 10] }),
    table("hazard_table", "The hazard pathways", "Who is affected, the headline figure and a short description of each pathway.", d.hazards),
  ];
}

/** Index(year) = 100 x (1 + g)^(year - 2020), for the three growth rates of the team's page. */
const INDEX_YEARS = Array.from({ length: 31 }, (_, i) => 2020 + i);
export const INDEX_CLASSES = [["#22c99a", "Low: under +25 %"], ["#f5cf58", "Moderate: +25 to +75 %"], ["#ff9f52", "High: +75 to +150 %"], ["#ff657f", "Very high: +150 % or more"]];
export function indexFigures() {
  const line = (g) => INDEX_YEARS.map((year) => { const index = 100 * (1 + g / 100) ** (year - 2020); return { year, index: +index.toFixed(1), increase_pct: +(index - 100).toFixed(1) }; });
  return [{
    l: { id: "plastic_index", title: "Relative debris index, 2020 = 100", badges: ASSUMED,
      shows: "Index(year) = 100 × (1 + yearly growth)^(year − 2020). 2020 is a starting point set to 100, not a measurement, and the three growth rates are assumptions. Steady growth leaves out cleanup, storms, river flow, seasons and policy.",
      chart: { type: "line_trend", x: "year", y: "index", y_label: { index: "Relative debris index (2020 = 100)", increase_pct: "Increase since 2020 (%)" } } },
    data: { "Indus Delta": { "Lower growth, 2 % a year": line(2), "Central illustration, 4 % a year": line(4), "Higher growth, 6 % a year": line(6) } },
  }];
}

/**
 * C1(y) = 100 x (1 + g)^min(y - 2020, 6) x (1 + h)^max(y - 2026, 0);  C(level, y) = C1(y) x TMF^(level - 1)
 * g = yearly source growth, h = the growth from 2027 (g, 0 or -2 %), TMF = magnification per step of the food chain.
 */
export const TIERS = [["Phytoplankton (level 1)", "#60ffc5"], ["Zooplankton (level 2)", "#65dfff"], ["Small fish (level 3)", "#ffc96f"], ["Predatory fish (level 4)", "#ff91bf"]];
export function biomagFigures({ growth, tmf, after }) {
  const g = growth / 100, h = after === "continue" ? g : +after / 100;
  const base = (y) => 100 * (1 + g) ** Math.min(y - 2020, 6) * (1 + h) ** Math.max(y - 2026, 0);
  const tier = (i) => INDEX_YEARS.map((year) => ({ year, tissue_index: +(base(year) * tmf ** i).toFixed(1), change_pct: +(100 * (base(year) / 100 - 1)).toFixed(1) }));
  return [
    { l: { id: "biomag_ratio", title: "Predatory fish compared with phytoplankton", badges: ASSUMED, shows: `With a magnification factor of ${tmf} per step and three steps up the chain, the top is ${tmf}³ times the bottom. The factor is an assumption held fixed through time.`,
        chart: { type: "big_number", value: "ratio", unit: "×", caption: "the concentration at the bottom of the food chain" } }, data: [{ ratio: +(tmf ** 3).toFixed(1), tmf, growth_pct_to_2026: growth, growth_pct_from_2027: +(h * 100).toFixed(1) }] },
    { l: { id: "biomag_chain", title: "Relative tissue index up the food chain, 2020–2050", badges: ASSUMED,
        shows: "A persistent contaminant followed through a simplified four-step food chain. Phytoplankton in 2020 = 100; values are relative, not µg/kg and not measured contamination. The food chain is a sketch, not a verified local one.",
        chart: { type: "line_trend", x: "year", y: "tissue_index", y_label: { tissue_index: "Relative tissue index (phytoplankton 2020 = 100)", change_pct: "Change since 2020 (%), the same at every level" }, series_colors: Object.fromEntries(TIERS) } },
      data: { "Food chain": Object.fromEntries(TIERS.map(([name], i) => [name, tier(i)])) } },
  ];
}
