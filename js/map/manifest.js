/**
 * Per-layer manifest from the data API (server/api.mjs): which years and scenarios exist, units and source.
 * Resolves to null for layers without one, or when the API is not running, so the placeholders stay.
 */
const cache = new Map();

export function loadManifest(layer) {
  const url = layer.mapLayer.manifest;
  if (!url) return Promise.resolve(null);
  if (!cache.has(url)) cache.set(url, fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  return cache.get(url);
}

/**
 * Which tile set to draw for a timeline year: the newest one at or before it.
 * Shapes are never interpolated, so a year without its own data shows the last mapped year and says so.
 */
export function pickTiles(manifest, year, scenario) {
  const proj = manifest.projected.filter((p) => p.scenario === scenario && p.year <= year).pop();
  if (proj) return { scenario, year: proj.year, projected: true };
  const obs = manifest.observed.filter((y) => y <= year).pop();
  return obs ? { scenario: "observed", year: obs, projected: false } : null;
}
