import { fromFile } from "geotiff";
import proj4 from "proj4";
import { loadGeoid } from "./lib/geoid.mjs";

const utm42 = "+proj=utm +zone=42 +datum=WGS84 +units=m +no_defs";
const geoid = await loadGeoid("data/us_nga_egm08_25.tif");

const sindh = await (await fromFile("D:/NDMA/Sindh12.5.tif")).getImage();
const [x0, , , y1] = sindh.getBoundingBox();
const [rx, ry] = sindh.getResolution();

const pts = [
  ["Karachi_Manora_coast", 24.80, 66.97], ["Keti_Bandar", 24.14, 67.45], ["Indus_delta_creek", 23.95, 67.60],
  ["Karachi_inland_Saddar", 24.86, 67.01], ["Karachi_airport", 24.906, 67.16],
];
console.log("name".padEnd(24), "N(geoid)".padStart(9), "h(raw)".padStart(8), "H=h-N".padStart(8));
for (const [name, lat, lon] of pts) {
  const [e, n] = proj4("EPSG:4326", utm42, [lon, lat]);
  const px = Math.floor((e - x0) / rx), py = Math.floor((n - y1) / ry);
  const r = await sindh.readRasters({ window: [px - 2, py - 2, px + 3, py + 3], interleave: true });
  const vals = Array.from(r).filter((v) => v !== -32768);
  const h = vals.reduce((a, b) => a + b, 0) / vals.length;
  const N = geoid.at(lon, lat);
  console.log(name.padEnd(24), N.toFixed(2).padStart(9), h.toFixed(1).padStart(8), (h - N).toFixed(1).padStart(8));
}
