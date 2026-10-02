import { fromFile } from "geotiff";
import proj4 from "proj4";
const utm42 = "+proj=utm +zone=42 +datum=WGS84 +units=m +no_defs";
const [, , file, ...pts] = process.argv;
const tiff = await fromFile(file); const img = await tiff.getImage();
const [x0, , , y1] = img.getBoundingBox(); const [rx, ry] = img.getResolution();
for (const p of pts) {
  const [name, lat, lon] = p.split(",");
  const [e, n] = proj4("EPSG:4326", utm42, [+lon, +lat]);
  const px = Math.floor((e - x0) / rx), py = Math.floor((n - y1) / ry);
  if (px < 5 || py < 5 || px >= img.getWidth() - 5 || py >= img.getHeight() - 5) { console.log(name, "outside raster"); continue; }
  const r = await img.readRasters({ window: [px - 4, py - 4, px + 5, py + 5], interleave: true });
  const vals = Array.from(r).filter((v) => v !== -32768);
  console.log(name.padEnd(22), `n=${vals.length}/81`, "min", Math.min(...vals), "max", Math.max(...vals), "centre", r[40]);
}
