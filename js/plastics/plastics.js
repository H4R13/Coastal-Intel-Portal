/**
 * Plastic debris and biomagnification (the DMJM material), served by the data API under api/dmjm/.
 * Three things, kept apart because they are not the same kind of evidence:
 *   surveys      beach debris surveys at 12 sites, 2025-01 to 2026-09 (a demo dataset: sources not recorded), and a
 *                scenario simulation of those sites to 2050 (projection_2050.json)
 *   index        "plastic debris outlook": a relative index, 2020 = 100, growing at an assumed yearly rate
 *   biomag       "biomagnification outlook": the same kind of index carried up a four-step food chain
 * The last two are formulas with assumed inputs, copied from the team's two simulation pages; no measurements go in.
 * Everything resolves to null when the API is not running.
 */
const docs = new Map();
function loadDoc(key) {
  if (!docs.has(key)) docs.set(key, fetch(`api/dmjm/${key}`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  return docs.get(key);
}
/** { surveys: [rows], projection } or null */
export async function loadPlastics() {
  const [surveys, projection] = await Promise.all([loadDoc("surveys"), loadDoc("projection")]);
  return surveys && projection ? { surveys: surveys.rows, projection } : null;
}

export const METRICS = { plastic_items_per_100m: "Plastic items per 100 m of beach", plastic_kg_per_100m: "Plastic weight per 100 m of beach (kg)" };
export const viewOf = (s) => ({ topic: "surveys", scenario: "bau", growth: 4, tmf: 2, after: "continue", ...s.plasticsView });

/* ---- survey sites on the map ---- */
const RAMP = ["#22c99a", "#f5cf58", "#ff9f52", "#ff657f"]; // the team's own low → very high colours
export const PLASTIC_RAMP = `linear-gradient(to right, ${RAMP.join(", ")})`;
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

/** Top of the colour scale: the largest middle estimate of any site, scenario and year, rounded up to a hundred. */
export const scaleMax = (d) => Math.ceil(Math.max(...Object.values(d.projection.results).flatMap((bySite) => Object.values(bySite).flatMap((m) => m.plastic_items_per_100m.p50))) / 100) * 100;

/**
 * Items per 100 m at a site for a timeline year: the mean of that year's surveys while surveys exist, then the
 * scenario's middle estimate. Null before the first survey year: nothing was measured and nothing is back-cast.
 */
export function siteValue(d, site, year, scenario) {
  const p = d.projection, first = p.years[0];
  if (year >= first) {
    const y = Math.min(year, p.years.at(-1)), i = p.years.indexOf(y), m = p.results[scenario]?.[site]?.plastic_items_per_100m;
    return m ? { value: m.p50[i], lo: m.p5[i], hi: m.p95[i], year: y, kind: y === first ? "survey baseline" : "scenario" } : null;
  }
  const rows = d.surveys.filter((r) => r.coastal_site === site && +r.survey_date.slice(0, 4) === year);
  return rows.length ? { value: Math.round(mean(rows.map((r) => r.plastic_items_per_100m))), year, kind: "survey mean" } : null;
}

export function sitesGeojson(d, year, scenario) {
  return {
    type: "FeatureCollection",
    features: Object.entries(d.projection.sites).map(([name, s]) => {
      const v = siteValue(d, name, year, scenario);
      return { type: "Feature", geometry: { type: "Point", coordinates: [s.lon, s.lat] }, properties: { name, area: s.area, value: v?.value ?? -1, lo: v?.lo ?? -1, hi: v?.hi ?? -1, year: v?.year ?? year, kind: v?.kind ?? "no survey" } };
    }),
  };
}
/** MapLibre colour expression for the site value; sites without a value are hollow grey. */
export const colorExpr = (max) => ["case", ["<", ["get", "value"], 0], "rgba(200,210,210,0.25)", ["interpolate", ["linear"], ["get", "value"], ...RAMP.flatMap((c, i) => [(max * i) / (RAMP.length - 1), c])]];

/* ---- figures, in the shape js/ocean/oceanFigures.js draws: { l: catalog-like entry, data } ---- */
const DEMO = ["demo dataset", "sources not recorded"], ASSUMED = ["illustrative model", "no measured data"];
const count = (rows, key) => Object.entries(rows.reduce((m, r) => ((m[r[key]] = (m[r[key]] ?? 0) + 1), m), {})).map(([k, n]) => ({ [key]: k, surveys: n }));

export function surveyFigures(d) {
  const p = d.projection, names = Object.keys(p.sites);
  const series = Object.fromEntries(names.map((site) => [site, Object.fromEntries(p.scenarios.map((sc) => [sc.label, p.years.map((year, i) => ({
    year, plastic_items_per_100m: p.results[sc.id][site].plastic_items_per_100m.p50[i], plastic_kg_per_100m: p.results[sc.id][site].plastic_kg_per_100m.p50[i],
  }))]))]));
  const bySite = names.map((site) => { const rows = d.surveys.filter((r) => r.coastal_site === site); return { site, area: p.sites[site].area, surveys: rows.length, plastic_items_per_100m: Math.round(mean(rows.map((r) => r.plastic_items_per_100m))), plastic_kg_per_100m: +mean(rows.map((r) => r.plastic_kg_per_100m)).toFixed(2), overall_risk_score: +mean(rows.map((r) => r.overall_risk_score)).toFixed(1) }; });
  const bars = (id, title, key, shows) => ({ l: { id, title, shows, badges: DEMO, chart: { type: "horizontal_bar", x: "surveys", y: key, sort: "surveys descending", x_label: "Number of surveys" } }, data: count(d.surveys, key) });
  return [
    { l: { id: "plastic_scenarios", title: `Debris at each site under three scenarios, ${p.years[0]}–${p.years.at(-1)}`, badges: ["scenario simulation", "not a forecast"],
        shows: `Middle estimate of ${p.method.draws.toLocaleString()} simulation runs. ${p.method.assumption} ${p.scenarios.map((sc) => `${sc.label}: ${sc.note}`).join(" ")}`,
        chart: { type: "line_trend", x: "year", y: "plastic_items_per_100m", y_label: METRICS } }, data: series },
    { l: { id: "plastic_by_site", title: "Survey average at each site", badges: DEMO, shows: `Mean of each site's surveys, ${p.baseline.period}.`,
        chart: { type: "horizontal_bar", x: "plastic_items_per_100m", y: "site", sort: "plastic_items_per_100m descending", color_by: "area", x_label: METRICS.plastic_items_per_100m } }, data: bySite },
    bars("plastic_types", "What kind of plastic was found", "plastic_type", "How often each type was the main plastic recorded in a survey."),
    bars("plastic_sources", "Where it probably came from", "probable_source", "The probable source noted in each survey."),
    bars("plastic_risk", "Risk class of the surveys", "risk_class", "The risk class given in the dataset; how it was calculated is not recorded."),
    { l: { id: "plastic_surveys", title: "All beach surveys", badges: DEMO, shows: `${d.surveys.length} surveys at ${names.length} sites, ${p.baseline.period}.` }, data: d.surveys },
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
