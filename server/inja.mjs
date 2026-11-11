/**
 * The INJA coastal erosion and accretion maps (server/load-inja.mjs) as part of the AMIB hazard machinery: their layers are
 * added to the AMIB catalog (product J) and their pictures are served by the same image route. Nothing is in PostgreSQL;
 * everything lives in data/inja/ (catalog.json plus one PNG per map) and is absent, harmlessly, on a machine without it.
 */
import fs from "node:fs"; import path from "node:path";

const DIR = path.resolve("data", "inja"), CATALOG = path.join(DIR, "catalog.json");
let cache = { stamp: 0, doc: null };

function read() {
  try {
    const stamp = fs.statSync(CATALOG).mtimeMs;
    if (stamp !== cache.stamp) cache = { stamp, doc: JSON.parse(fs.readFileSync(CATALOG, "utf8")) };
  } catch { cache = { stamp: 0, doc: null }; }
  return cache.doc;
}

/** Changes whenever the loader has run again (part of the cache key of the catalog answer). */
export const injaStamp = () => (read(), cache.stamp);

/** The AMIB catalog JSON text with the INJA layers added (unchanged when the package is not loaded). */
export function withInjaCatalog(json) {
  const inja = read();
  if (!inja || json === "null") return json;
  const cat = JSON.parse(json);
  cat.layers = [...cat.layers.filter((l) => l.product !== "J"), ...inja.layers];
  return JSON.stringify(cat);
}

/** The chart series of product J, or null. */
export const injaSeries = () => read()?.series ?? null;

/** Path of the picture for one step of an INJA layer, or null. */
export function injaFile(id, step) {
  const rel = read()?.files?.[id]?.[step];
  if (!rel) return null;
  const abs = path.resolve(DIR, rel);
  return abs.startsWith(DIR) && fs.existsSync(abs) ? abs : null;
}

export const isInja = (id) => id.startsWith("J:");
