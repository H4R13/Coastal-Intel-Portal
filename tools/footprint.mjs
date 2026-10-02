import { fromFile } from "geotiff";
import proj4 from "proj4";
const utm42 = "+proj=utm +zone=42 +datum=WGS84 +units=m +no_defs";
for (const f of process.argv.slice(2)) {
  const img = await (await fromFile(f)).getImage();
  const [x0, y0, x1, y1] = img.getBoundingBox();
  const c = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map((p) => proj4(utm42, "EPSG:4326", p));
  const lons = c.map((p) => p[0]), lats = c.map((p) => p[1]);
  console.log(f.split("/").pop(), "lon", Math.min(...lons).toFixed(2), "→", Math.max(...lons).toFixed(2), " lat", Math.min(...lats).toFixed(2), "→", Math.max(...lats).toFixed(2));
}
