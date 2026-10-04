/**
 * Map images for the saltwater intrusion / salinity package (AMIB).
 *   GET /api/amib/image/<layer id>/<step>   PNG of the layer's pre-coloured raster for that time step (0 for single maps)
 * The package ships every raster as a coloured GeoTIFF in longitude/latitude. This reads it (at most 2048 px wide,
 * using the file's overviews), re-spaces the rows by Web-Mercator latitude so it lines up when stretched on the map,
 * and returns a PNG. Results are cached in Redis by the caller.
 */
import fs from "node:fs"; import path from "node:path";
import { fromFile, addDecoder, BaseDecoder } from "geotiff";
import sharp from "sharp";
import { query } from "./db.mjs";

// The package's coloured GeoTIFFs are WebP-compressed (TIFF compression 50001), which geotiff.js only decodes in a
// browser. This decodes each tile with sharp instead.
class WebpDecoder extends BaseDecoder {
  async decode(fileDirectory, buffer) {
    const tile = sharp(Buffer.from(buffer));
    const raw = await (fileDirectory.SamplesPerPixel === 4 ? tile.ensureAlpha() : tile.removeAlpha()).raw().toBuffer();
    return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  }
}
addDecoder(50001, async () => WebpDecoder);

const DIR = path.resolve(process.env.AMIB_DIR ?? "Other Data/AMIB");
const MAX = 2048;
const mercY = (lat) => Math.asinh(Math.tan((lat * Math.PI) / 180));
const files = new Map(); // layer id → image file per step

async function fileOf(id, step) {
  if (!files.has(id)) files.set(id, (await query("select body from amib_doc where key = $1", [`files/${id}`])).rows[0]?.body ?? null);
  const rel = files.get(id)?.[step];
  if (!rel) return null;
  const abs = path.resolve(DIR, rel);
  return abs.startsWith(DIR) && fs.existsSync(abs) ? abs : null;
}

/** PNG bytes for one layer step, or null when the layer, step or file does not exist. */
export async function amibImage(id, step) {
  const file = await fileOf(id, step);
  if (!file) return null;
  const tiff = await fromFile(file), img = await tiff.getImage();
  const [w, s, e, n] = img.getBoundingBox(), spp = img.getSamplesPerPixel();
  const scale = Math.min(1, MAX / Math.max(img.getWidth(), img.getHeight()));
  const W = Math.max(1, Math.round(img.getWidth() * scale)), srcH = Math.max(1, Math.round(img.getHeight() * scale));
  const data = await tiff.readRasters({ interleave: true, width: W, height: srcH, resampleMethod: "nearest" });
  const yN = mercY(n), yS = mercY(s);
  const H = Math.min(2 * MAX, Math.max(1, Math.round((W * (yN - yS)) / (((e - w) * Math.PI) / 180))));
  const out = Buffer.alloc(W * H * 4);
  for (let j = 0; j < H; j++) {
    const lat = (Math.atan(Math.sinh(yN - ((j + 0.5) / H) * (yN - yS))) * 180) / Math.PI;
    const row = Math.min(srcH - 1, Math.max(0, Math.floor(((n - lat) / (n - s)) * srcH)));
    for (let i = 0; i < W; i++) {
      const k = (row * W + i) * spp, o = (j * W + i) * 4;
      out[o] = data[k]; out[o + 1] = data[spp >= 3 ? k + 1 : k]; out[o + 2] = data[spp >= 3 ? k + 2 : k];
      out[o + 3] = spp === 4 ? data[k + 3] : spp === 2 ? data[k + 1] : 255;
    }
  }
  return sharp(out, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
}
