import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";

const root = path.resolve(process.argv[2] ?? "../data/terrain");
const z = +(process.argv[3] ?? 10);
const lon2x = (lon, z) => ((lon + 180) / 360) * 2 ** z;
const lat2y = (lat, z) => { const r = (lat * Math.PI) / 180; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z; };

const cache = new Map();
function elev(lon, lat) {
  const fx = lon2x(lon, z), fy = lat2y(lat, z);
  const tx = Math.floor(fx), ty = Math.floor(fy);
  const f = path.join(root, String(z), String(tx), `${ty}.png`);
  if (!fs.existsSync(f)) return null;
  if (!cache.has(f)) cache.set(f, PNG.sync.read(fs.readFileSync(f)));
  const png = cache.get(f);
  const px = Math.min(255, Math.floor((fx - tx) * 256)), py = Math.min(255, Math.floor((fy - ty) * 256));
  const i = (py * 256 + px) * 4;
  return png.data[i] * 256 + png.data[i + 1] + png.data[i + 2] / 256 - 32768;
}

const pts = [
  ["Karachi Saddar", 24.86, 67.01], ["Karachi airport", 24.906, 67.16], ["Manora", 24.80, 66.97], ["Keti Bandar", 24.14, 67.45],
  ["Indus delta creek", 23.95, 67.60], ["Gwadar town", 25.12, 62.32], ["Pasni", 25.26, 63.47], ["Ormara", 25.21, 64.64],
  ["Sonmiani", 25.43, 66.58], ["Arabian Sea (off Karachi)", 24.5, 66.8], ["Hub river inland", 25.0, 67.0],
];
for (const [name, lat, lon] of pts) {
  const v = elev(lon, lat);
  console.log(name.padEnd(28), v == null ? "no tile" : `${v.toFixed(1)} m`);
}
