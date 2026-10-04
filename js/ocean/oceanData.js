/**
 * Access to the ocean package (pH, warming, oxygen, exposure, fisheries) served by the data API under api/ocean/.
 * The package's catalog lists every layer; the helpers here turn it into what the panel and the map need.
 * Everything resolves to null when the API is not running, so the portal falls back to "no data connected".
 */
const docs = new Map();
export function loadDoc(key) {
  if (!docs.has(key)) docs.set(key, fetch(`api/ocean/${key}`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  return docs.get(key);
}
export const loadCatalog = () => loadDoc("catalog");

export const SCENARIOS = [
  { id: "ssp126", label: "Low (SSP1-2.6)" },
  { id: "ssp245", label: "Medium (SSP2-4.5)" },
  { id: "ssp585", label: "High (SSP5-8.5)" },
];

const isMap = (l) => (l.type === "raster" || l.type === "raster_series") && l.show_alone !== false;
/** Scenario versions of one quantity share an id up to the "_ssp###" suffix; they are offered as one entry. */
export const variableOf = (l) => (l.scenario ? l.id.replace(`_${l.scenario}`, "") : l.id);
const plainTitle = (l) => (l.scenario ? l.title.replace(/,\s*(Low|Medium|High) \(SSP[^)]*\)\s*$/, "") : l.title);

/** Map layers of a step, main versions first: [{ id, title, primary, scenarios }] */
export function mapVariables(catalog, step) {
  const out = new Map();
  for (const l of catalog.layers) {
    if (l.step !== step || !isMap(l)) continue;
    const id = variableOf(l);
    const v = out.get(id) ?? out.set(id, { id, title: plainTitle(l), primary: false, scenarios: !!l.scenario, defaultOn: false, yearly: l.type === "raster_series" }).get(id);
    v.primary ||= !!l.primary; v.defaultOn ||= !!l.default_on;
  }
  return [...out.values()].sort((a, b) => b.yearly - a.yearly || b.primary - a.primary);
}

/**
 * The catalog layer to draw for a view { step, variable } and scenario. When none is chosen, a topic opens on its
 * year-by-year layer so the map moves with the timeline; topics without one open on the catalog's main result.
 */
export function resolveLayer(catalog, view, scenario) {
  const vars = mapVariables(catalog, view.step);
  const v = vars.find((x) => x.id === view.variable) ?? vars.find((x) => x.yearly) ?? vars.find((x) => x.defaultOn) ?? vars[0];
  if (!v) return null;
  return catalog.layers.find((l) => l.step === view.step && isMap(l) && variableOf(l) === v.id && (!l.scenario || l.scenario === scenario)) ?? null;
}

/** Charts and tables shown beside a step's map. */
export const panelLayers = (catalog, step) => catalog.layers.filter((l) => l.step === step && (l.display === "chart" || l.display === "table"));

/** For a year-by-year layer: the newest year at or before the timeline year (else its first year). */
export const pickYear = (layer, year) => layer.years.filter((y) => y <= year).pop() ?? layer.years[0];
