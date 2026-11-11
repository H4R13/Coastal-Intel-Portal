/**
 * Where the ocean monitoring package is (Sir Tayyab / Rana Hasnain, delivered as "ocean-monitoring_<date>/ocean-monitoring"):
 *   portal/   the data (catalog.json, rasters, series, tables, vectors, findings), served at /ocean-monitoring/portal/
 *   webapp/   their static app; its js/ modules are compiled into ours by vite.config.js (src/oceanMonitoring/)
 * OCEAN_MONITORING_DIR in .env names it; otherwise the newest Other Data/AMHK/ocean-monitoring_* folder is used, so a new
 * delivery only has to be unpacked next to the old one. The licence forbids copying or changing it: it stays out of git.
 * Used by the build (vite.config.js), the server (server.mjs) and the loader (server/load-ocean.mjs); none of them
 * changes the process's folder, so this takes the data folder as an argument.
 */
import fs from "node:fs"; import path from "node:path";

const isPackage = (dir) => fs.existsSync(path.join(dir, "portal", "catalog.json"));

/** The package folder (holding portal/ and webapp/), or null when none is unpacked. */
export function oceanPackage(dataRoot) {
  if (process.env.OCEAN_MONITORING_DIR) {
    const dir = path.resolve(dataRoot, process.env.OCEAN_MONITORING_DIR);
    return isPackage(dir) ? dir : null;
  }
  const amhk = path.join(dataRoot, "Other Data", "AMHK");
  if (!fs.existsSync(amhk)) return null;
  const dated = fs.readdirSync(amhk).filter((d) => /^ocean-monitoring/.test(d)).sort().reverse(); // the date in the name sorts newest first
  for (const d of dated) for (const dir of [path.join(amhk, d, "ocean-monitoring"), path.join(amhk, d)]) if (isPackage(dir)) return dir;
  return null;
}
