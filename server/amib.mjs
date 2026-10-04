/**
 * Map images for the saltwater intrusion / salinity package (AMIB).
 *   GET /api/amib/image/<layer id>/<step>   PNG of the layer's pre-coloured raster for that time step (0 for single maps)
 * The package ships every raster as a coloured GeoTIFF in longitude/latitude. This reads it (at most 2048 px wide,
 * using the file's overviews), re-spaces the rows by Web-Mercator latitude so it lines up when stretched on the map,
 * and returns a PNG. Results are cached in Redis by the caller.
 * With clearBackground the colour that fills most of the picture is made see-through (see clearCommon below);
 * with hideColors the given class colours are (see hideClasses below).
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

/**
 * Make the picture's most common colour see-through, fading in over nearby colours, so only the places that differ
 * from the even background stay coloured. Used for smooth fields that are nearly one value across the whole study
 * box (sea-level rise: the same regional rise everywhere, plus local land sinking). Nothing happens when no single
 * colour covers a third of the picture. Pixels are only hidden, never recoloured.
 */
const NEAR = 5, FAR = 22; // colour distance (0-255 per channel): hidden up to NEAR, fully shown from FAR
function clearCommon(px, W, H) {
  const counts = new Map();
  let opaque = 0;
  for (let o = 0; o < px.length; o += 4) {
    if (px[o + 3] < 128) continue;
    opaque++;
    const key = ((px[o] >> 2) << 12) | ((px[o + 1] >> 2) << 6) | (px[o + 2] >> 2);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best = -1, n = 0;
  for (const [k, c] of counts) if (c > n) { best = k; n = c; }
  // neighbouring shades count towards "common": a smooth background spans a few of them
  const r = ((best >> 12) << 2) + 2, g = (((best >> 6) & 63) << 2) + 2, b = ((best & 63) << 2) + 2;
  let near = 0;
  for (let o = 0; o < px.length; o += 4) if (px[o + 3] >= 128 && Math.max(Math.abs(px[o] - r), Math.abs(px[o + 1] - g), Math.abs(px[o + 2] - b)) <= NEAR) near++;
  if (near < px.length / 4 * 0.3) return; // only when one colour fills about a third of the whole picture: a thin feature (a river) is never touched
  // the picture's own rim is blended with nothing and so has odd colours: hide it too, or it draws a dotted frame
  const empty = new Uint8Array(px.length / 4), RIM = 4;
  for (let i = 0; i < empty.length; i++) empty[i] = px[i * 4 + 3] < 128 ? 1 : 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (empty[i]) continue;
    let rim = x < RIM || y < RIM || x >= W - RIM || y >= H - RIM;
    for (let k = 1; k <= RIM && !rim; k++) rim = empty[i - k] || empty[i + k] || empty[i - k * W] || empty[i + k * W];
    if (rim) px[i * 4 + 3] = 0;
  }
  for (let o = 0; o < px.length; o += 4) {
    const d = Math.max(Math.abs(px[o] - r), Math.abs(px[o + 1] - g), Math.abs(px[o + 2] - b));
    if (d < FAR) px[o + 3] = d <= NEAR ? 0 : Math.round((px[o + 3] * (d - NEAR)) / (FAR - NEAR));
  }
}

/** Make every pixel of the given class colours ([[r, g, b]]) see-through. For class maps: a class is hidden, the rest untouched. */
function hideClasses(px, colors) {
  const TOL = 10; // the package's pictures are lightly compressed, so a class colour varies by a few steps
  for (let o = 0; o < px.length; o += 4) {
    if (colors.some(([r, g, b]) => Math.abs(px[o] - r) <= TOL && Math.abs(px[o + 1] - g) <= TOL && Math.abs(px[o + 2] - b) <= TOL)) px[o + 3] = 0;
  }
}

/** PNG bytes for one layer step, or null when the layer, step or file does not exist. */
export async function amibImage(id, step, { clearBackground = false, hideColors = [] } = {}) {
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
  if (clearBackground) clearCommon(out, W, H);
  if (hideColors.length) hideClasses(out, hideColors);
  return sharp(out, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
}
