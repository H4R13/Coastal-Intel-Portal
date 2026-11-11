import fs from "node:fs"; import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { APP_DIR, DATA_ROOT } from "./root.mjs";
import { oceanPackage } from "./ocean-package.mjs";

/**
 * The ocean monitoring package's own modules (webapp/js: colour maps, layer configuration, raster drawing, the panel's
 * charts, number tables and key points) compiled into the app as one module, `virtual:ocean-monitoring`
 * (src/oceanMonitoring/). They are read from the package at build time and never copied into src/: the licence forbids
 * copying or changing them, and a new delivery then only needs `npm run build`. Their own app.js and index.html are not
 * used; src/oceanMonitoring/ is the React version of them.
 *
 * Two kinds of changes are made on the way in, and none to the numbers or the wording:
 *   - the data address (DATA) points at /ocean-monitoring/portal/, served by server.mjs;
 *   - colours drawn straight onto the charts for their white page are swapped for ones that read on the portal's dark
 *     panels (dark text and lines become light, white separators become the panel colour).
 * A swap that no longer finds its text (the package changed) is reported in the build output, not silently skipped.
 */
const FILES = ["colormaps.js", "config.js", "core.js", "panel.js", "numbers.js", "keypoints.js"];
const EXPORTS = ["CMAPS", "DATA", "REGIONS", "SCEN", "PRODUCT_COLOR", "REGION_COLOR", "STATUS_COLOR", "TABS", "LAYER_SETS", "LAYER_CHART", "CHARTS",
  "OBS_END", "COMPARE", "LAYER_FINDINGS", "DRIVER_OF", "DONUTS", "MEAS", "CHECKS", "Core", "Float", "Panel", "Numbers", "KeyPoints"];
const SWAPS = [ // [file, text, replacement, every occurrence?]
  ["config.js", "const DATA = '../portal/';", "const DATA = 'ocean-monitoring/portal/';"],
  ["config.js", "'Whole EEZ': '#0F172A'", "'Whole EEZ': '#e6eef0'"],
  ["config.js", "color: '#173C66'", "color: '#5fa8e8'"], // low emissions: the portal's SSP1-2.6 colour (src/panels/SspKeys.jsx)
  ["config.js", "color: '#951B1E'", "color: '#e5534b'"], // high emissions: the portal's SSP5-8.5 colour
  ["config.js", "'#0072B2'", "'#3d9be0'", true], // the primary products' blue, lifted to read on dark
  ["panel.js", "px Fira Code'", "px Manrope, sans-serif'", true], // text drawn on the charts: the portal's font
  ["panel.js", "px Fira Sans'", "px Manrope, sans-serif'", true],
  ["panel.js", "Chart.defaults.font.family = \"'Fira Sans', 'Segoe UI', sans-serif\";", "Chart.defaults.font.family = \"'Manrope', 'Segoe UI', system-ui, sans-serif\";"],
  ["panel.js", "Chart.defaults.color = '#475569';", "Chart.defaults.color = '#bccdce';"],
  ["panel.js", "'#0F172A'", "'#e6eef0'", true],
  ["panel.js", "'#1E293B'", "'#cbd5e1'", true],
  ["panel.js", "'#7A7A7A'", "'#9db4b7'", true],
  ["panel.js", "'#475569'", "'#bccdce'", true],
  ["panel.js", "'#fff'", "'#10232b'", true],
  ["panel.js", "'rgba(15,23,42,.7)'", "'rgba(230,238,240,.7)'"],
  ["panel.js", "'rgba(224,242,254,.55)'", "'rgba(125,211,252,.08)'"],
  ["panel.js", "'rgba(2,132,199,.85)'", "'rgba(56,189,248,.85)'"],
  ["panel.js", "'#0284C7'", "'#38BDF8'", true],
  ["panel.js", "g.fillStyle = '#0369A1'", "g.fillStyle = '#7DD3FC'"],
  ["panel.js", "'rgba(100,116,139,.35)'", "'rgba(188,205,206,.35)'"],
  ["numbers.js", "'#2E2E3A'", "'#a9b4c2'", true],
];
const ID = "virtual:ocean-monitoring", RESOLVED = "\0" + ID;

function oceanMonitoring() {
  return {
    name: "ocean-monitoring",
    resolveId: (id) => (id === ID ? RESOLVED : null),
    load(id) {
      if (id !== RESOLVED) return null;
      const pkg = oceanPackage(DATA_ROOT), js = pkg && path.join(pkg, "webapp", "js");
      if (!js || !FILES.every((f) => fs.existsSync(path.join(js, f)))) {
        this.warn("Ocean monitoring package not found (Other Data/AMHK/ocean-monitoring_*): the Ocean layer will say so.");
        return `export const available = false; ${EXPORTS.map((e) => `export const ${e} = null;`).join(" ")}`;
      }
      const parts = FILES.map((f) => {
        let src = fs.readFileSync(path.join(js, f), "utf8");
        for (const [file, from, to, all] of SWAPS) {
          if (file !== f) continue;
          if (!src.includes(from)) { this.warn(`ocean-monitoring: "${from}" is no longer in ${f}; that colour or address is left as delivered.`); continue; }
          src = all ? src.split(from).join(to) : src.replace(from, to);
        }
        this.addWatchFile(path.join(js, f));
        return `/* ---- ${f} (ocean monitoring package) ---- */\n${src}`;
      });
      return [
        `import { Chart, registerables } from "chart.js"; Chart.register(...registerables);`,
        `import * as GeoTIFF from "geotiff";`,
        ...parts,
        `export const available = true; export const packageDir = ${JSON.stringify(path.basename(path.dirname(pkg)))};`,
        `export { Chart, ${EXPORTS.join(", ")} };`,
      ].join("\n");
    },
  };
}

// The app is built into dist/ and served by server.mjs on port 5173, next to the data API. `base: "./"` keeps every
// address relative (api/..., data/..., css/...), exactly as in the original portal. `root` is fixed because root.mjs
// moves the process to the data folder.
export default defineConfig({
  root: APP_DIR,
  base: "./",
  plugins: [react(), oceanMonitoring()],
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 1800 },
});
