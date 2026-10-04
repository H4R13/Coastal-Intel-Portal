/**
 * Access to the saltwater intrusion / salinity package (AMIB) served by the data API under api/amib/.
 * A portal layer opts in with layer.amib = { products: [...], match?, exclude?, optional? }:
 *   products  package products shown under this button (A salty soils, B river salt, C fresh groundwater, D sea-level
 *             rise, GH salt-water boundary, F mangroves and shoreline change, G fresh-water signs at sea, H future ocean)
 *   match / exclude   keep only layers whose name does / does not contain this text
 *   optional  true when the button already has its own map layer: no package layer is drawn until one is chosen
 * Everything resolves to null when the API is not running.
 */
const docs = new Map();
export function loadAmibDoc(key) {
  if (!docs.has(key)) docs.set(key, fetch(`api/amib/${key}`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  return docs.get(key);
}
export const loadAmibCatalog = () => loadAmibDoc("catalog");

export const groupTitle = (l) => l.group.replace(/^\S+\s+/, ""); // "C  Fresh groundwater..." → "Fresh groundwater..."
const YEARLY = "Year by year";

/** Map layers of the package that belong to a portal layer. */
export function mapLayersFor(catalog, layer) {
  const { products, match, exclude } = layer.amib;
  const has = (l, text) => `${l.name} ${l.id}`.toLowerCase().includes(text);
  return catalog.layers.filter((l) => l.bounds && products.includes(l.product) && (!match || has(l, match)) && (!exclude || !has(l, exclude)));
}

/** What the panel offers and what is currently chosen: { products, product, subgroups, subgroup, layers, current }. */
export function resolveView(catalog, layer, view = {}) {
  const all = mapLayersFor(catalog, layer);
  const order = layer.amib.products; // topics are offered in the order the layer lists them, so its own subject comes first
  const products = [...new Map(all.map((l) => [l.product, groupTitle(l)])).entries()].map(([id, title]) => ({ id, title })).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const product = products.find((p) => p.id === view.product)?.id ?? products[0]?.id;
  const inProduct = all.filter((l) => l.product === product);
  const subgroups = [...new Set(inProduct.map((l) => l.subgroup))].sort((a, b) => (b === YEARLY) - (a === YEARLY)); // year-by-year first
  const subgroup = subgroups.includes(view.subgroup) ? view.subgroup : subgroups[0];
  const layers = inProduct.filter((l) => l.subgroup === subgroup);
  const current = layers.find((l) => l.id === view.layer) ?? (layer.amib.optional ? null : layers[0] ?? null);
  return { products, product, subgroups, subgroup, layers, current };
}

/** For a year-by-year layer: index of the newest step at or before the timeline year (else the first step). */
export function pickStep(l, year) {
  if (!l.steps || l.time_step === "month-of-year") return 0;
  let at = 0;
  l.steps.forEach((s, i) => { if (s.t <= year) at = i; });
  return at;
}
export const stepLabel = (l, i) => (l.steps && l.time_step !== "month-of-year" ? String(l.steps[i].t) : "");

/** Readable scenario names for chart series. */
export const scenarioName = (s) => String(s)
  .replace(/ssp126/g, "low emissions (SSP1-2.6)").replace(/ssp245/g, "medium emissions (SSP2-4.5)").replace(/ssp585/g, "high emissions (SSP5-8.5)")
  .replace(/_subs\b/g, " + land sinking").replace(/_/g, " ");
