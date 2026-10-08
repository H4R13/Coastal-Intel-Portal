/**
 * Access to the saltwater intrusion / salinity package (AMIB) served by the data API under api/amib/.
 * A portal layer opts in with layer.amib = { hazards, browse? }:
 *   hazards  ids of js/amib/hazards.js shown under this button, or "all"
 *   browse   true to also offer every raw layer of the package (topic / group / layer selects), collapsed
 * What is drawn is resolved here from the panel's choice (state.amibView[layer id]), the emissions scenario (state.ssp)
 * and the timeline year, so the map and the panel always agree. Everything resolves to null when the API is not running.
 */
import { HAZARDS, PRODUCT_STYLE, SSPS } from "./hazards.js";

const docs = new Map();
export function loadAmibDoc(key) {
  if (!docs.has(key)) docs.set(key, fetch(`api/amib/${key}`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  return docs.get(key);
}
export const loadAmibCatalog = () => loadAmibDoc("catalog");

export const groupTitle = (l) => l.group.replace(/^\S+\s+/, ""); // "C  Fresh groundwater..." → "Fresh groundwater..."
const YEARLY = "Year by year";
const byId = new WeakMap(); // catalog → Map(id → layer)
export const layerById = (catalog, id) => {
  if (!byId.has(catalog)) byId.set(catalog, new Map(catalog.layers.map((l) => [l.id, l])));
  return byId.get(catalog).get(id) ?? null;
};

/** The hazards a portal layer shows. */
export const hazardsOf = (layer) => (layer.amib.hazards === "all" ? HAZARDS : HAZARDS.filter((h) => layer.amib.hazards.includes(h.id)));
const productsOf = (layer) => [...new Set(hazardsOf(layer).map((h) => h.product))];

/** Drawing options of a package map: { clearBackground, hideClasses } by its product. */
export const styleOf = (L) => PRODUCT_STYLE[L?.product] ?? {};

/** Emissions scenarios a variant has a map for: { ssp126: true, ... }, or null for an observed map. */
export const sspAvailability = (variant) => (variant.ssp ? Object.fromEntries(SSPS.map((s) => [s.id, !!variant.ssp[s.id]])) : null);

/** For a year-by-year layer: index of the newest step at or before the timeline year (else the first step). */
export function pickStep(l, year) {
  if (!l.steps || l.time_step === "month-of-year") return 0;
  let at = 0;
  l.steps.forEach((s, i) => { if (s.t <= year) at = i; });
  return at;
}
export const stepLabel = (l, i) => (l.steps && l.time_step !== "month-of-year" ? String(l.steps[i].t) : l.year ? String(l.year) : "");

/**
 * The hazard view of a portal layer: { hazards, hazard, variant, measure, ssp, sspUsed, L, step }.
 * sspUsed differs from ssp when the package has no run for the chosen scenario (the nearest one is drawn instead).
 */
export function resolveHazard(catalog, layer, view = {}, ssp = "ssp245", year = 2026) {
  const hazards = hazardsOf(layer);
  const hazard = hazards.find((h) => h.id === view.hazard) ?? hazards[0];
  if (!hazard) return null;
  const variant = hazard.variants[view.variant] ?? hazard.variants[0];
  const measure = hazard.measures?.find((m) => m.id === view.measure) ?? hazard.measures?.[0] ?? null;
  let sspUsed = null, ref = variant.layer;
  if (variant.ssp) {
    const order = [ssp, "ssp245", "ssp585", "ssp126"]; // the chosen run, else the nearest the package has
    sspUsed = order.find((x) => variant.ssp[x]);
    ref = variant.ssp[sspUsed];
  }
  const fill = (id) => (measure ? id.replace("{m}", measure.id) : id);
  let L;
  if (Array.isArray(ref)) { // fixed maps for several years: the newest at or before the timeline year, else the first
    const maps = ref.map((id) => layerById(catalog, fill(id))).filter(Boolean).sort((a, b) => a.year - b.year);
    L = maps.filter((m) => m.year <= year).at(-1) ?? maps[0] ?? null;
  } else L = layerById(catalog, fill(ref));
  return { hazards, hazard, variant, measure, ssp, sspUsed, L, step: L ? pickStep(L, year) : 0 };
}

/** Every raw map layer of the package under this portal layer's products (browse mode). */
export function resolveBrowse(catalog, layer, view = {}) {
  const products = layer.amib.hazards === "all" ? null : productsOf(layer);
  const all = catalog.layers.filter((l) => l.bounds && (!products || products.includes(l.product)));
  const topics = [...new Map(all.map((l) => [l.product, groupTitle(l)])).entries()].map(([id, title]) => ({ id, title })).sort((a, b) => a.id.localeCompare(b.id));
  const product = topics.find((p) => p.id === view.product)?.id ?? topics[0]?.id;
  const inProduct = all.filter((l) => l.product === product);
  const subgroups = [...new Set(inProduct.map((l) => l.subgroup))].sort((a, b) => (b === YEARLY) - (a === YEARLY)); // year-by-year first
  const subgroup = subgroups.includes(view.subgroup) ? view.subgroup : subgroups[0];
  const layers = inProduct.filter((l) => l.subgroup === subgroup);
  return { topics, product, subgroups, subgroup, layers, current: layers.find((l) => l.id === view.layer) ?? null };
}

/** The map a portal layer draws now: a raw layer chosen in browse mode wins over the hazard's map. { L, step } */
export function currentMap(catalog, layer, s, year = s.year) {
  const view = s.amibView[layer.id] ?? {};
  const raw = view.raw && layerById(catalog, view.raw);
  if (raw) return { L: raw, step: pickStep(raw, year) };
  const h = resolveHazard(catalog, layer, view, s.ssp, year);
  return { L: h?.L ?? null, step: h?.step ?? 0 };
}

/** Legend entries of a class map that are not drawn (PRODUCT_STYLE hideClasses). */
export const hiddenStops = (L) => (L?.kind === "categorical" ? (L.legend ?? []).filter((c) => (styleOf(L).hideClasses ?? []).includes(c.label ?? L.classes?.[c.value])) : []);
export const clearsBackground = (L) => !!styleOf(L).clearBackground && L.kind !== "categorical";

/** URL of the PNG for one step of a package map (server/amib.mjs), relative to `base`. */
export function imageUrl(L, step, base = location.href) {
  const hide = hiddenStops(L).map((c) => c.color.replace("#", "")).join(",");
  const query = [clearsBackground(L) && "bg=clear", hide && `hide=${hide}`].filter(Boolean).join("&");
  return `${new URL("api/amib/image/", base).href}${encodeURIComponent(L.id)}/${step}${query ? `?${query}` : ""}`;
}

/** Readable scenario names for chart series. */
export const scenarioName = (s) => String(s)
  .replace(/ssp126/g, "low emissions (SSP1-2.6)").replace(/ssp245/g, "medium emissions (SSP2-4.5)").replace(/ssp585/g, "high emissions (SSP5-8.5)")
  .replace(/_subs\b/g, " + land sinking").replace(/ subs\b/g, " + land sinking").replace(/_/g, " ");
