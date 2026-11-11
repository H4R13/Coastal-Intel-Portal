/**
 * Drawing of one map image of the saltwater intrusion / salinity package (AMIB). Pure: a file in, PNG bytes out, no
 * database or cache, so it can run inside the worker threads of server/amib.mjs.
 * The package ships every raster as a coloured GeoTIFF in longitude/latitude. This reads it (at most 2048 px wide,
 * using the file's overviews), re-spaces the rows by Web-Mercator latitude so it lines up when stretched on the map,
 * and returns a PNG.
 * With clearBackground the colour that fills most of the picture is made see-through (see clearCommon below);
 * with hideColors the given class colours are (see hideClasses below); with tints class colours are drawn part
 * see-through and feathered (see tintClasses below); with clipRings everything outside them is
 * (Pakistan's EEZ for the sea maps, see clipToRings below); with ramp the raw values beside the coloured file are drawn
 * in other colours (see rampPixels below).
 */
import { fromFile, addDecoder, BaseDecoder } from "geotiff";
import sharp from "sharp";

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

const MAX = 2048;
const mercY = (lat) => Math.asinh(Math.tan((lat * Math.PI) / 180));

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

/**
 * Make everything outside the given polygon rings ([[[lon, lat], ...], ...], even-odd) see-through. For sea maps:
 * the rings are Pakistan's EEZ, so neither land nor the neighbours' waters are coloured. Row by row: where the row's
 * latitude crosses the rings' edges, the pixels between alternate crossings are inside.
 */
function clipToRings(px, W, H, rings, [w, s, e, n]) {
  const yN = mercY(n), yS = mercY(s), SUB = 4; // SUB rows per pixel row, and exact overlap across it: a smooth edge
  const edges = [];
  for (const r of rings) for (let k = 0; k < r.length - 1; k++) edges.push([r[k][0], r[k][1], r[k + 1][0], r[k + 1][1]]);
  const cover = new Float32Array(W);
  for (let j = 0; j < H; j++) {
    cover.fill(0);
    for (let sub = 0; sub < SUB; sub++) {
      const lat = (Math.atan(Math.sinh(yN - ((j + (sub + 0.5) / SUB) / H) * (yN - yS))) * 180) / Math.PI;
      const xs = [];
      for (const [x0, y0, x1, y1] of edges) if ((y0 <= lat) !== (y1 <= lat)) xs.push(((x0 + ((lat - y0) / (y1 - y0)) * (x1 - x0)) - w) / (e - w) * W);
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) { // inside between alternate crossings
        const a = Math.max(0, xs[k]), b = Math.min(W, xs[k + 1]);
        for (let i = Math.floor(a); i < b; i++) cover[i] += (Math.min(i + 1, b) - Math.max(i, a)) / SUB;
      }
    }
    for (let i = 0; i < W; i++) { const o = (j * W + i) * 4 + 3; px[o] = Math.round(px[o] * Math.min(1, cover[i])); }
  }
}

/**
 * For the sea maps: the climate-model rasters are coarse cells with nothing over land, which leaves a stepped coast
 * of empty cells inside the EEZ. Every empty pixel takes the mean of its filled neighbours (spreading outwards until
 * all are filled), then the field is softened over about one model cell, so the colours run smoothly up to the
 * coastline that the EEZ cut then draws. Returns the RGBA pixels, all opaque. Colours are only spread and blended.
 */
async function fillAndSoften(px, W, H) {
  const filled = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) filled[i] = px[i * 4 + 3] >= 128 ? 1 : 0;
  for (let pass = 0; pass < 4 * (W + H); pass++) {
    const add = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (filled[i]) continue;
      let r = 0, g = 0, b = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy, k = yy * W + xx;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H || !filled[k]) continue;
        r += px[k * 4]; g += px[k * 4 + 1]; b += px[k * 4 + 2]; c++;
      }
      if (c) add.push(i, r / c, g / c, b / c);
    }
    if (!add.length) break;
    for (let k = 0; k < add.length; k += 4) {
      const o = add[k] * 4;
      px[o] = add[k + 1]; px[o + 1] = add[k + 2]; px[o + 2] = add[k + 3]; px[o + 3] = 255;
      filled[add[k]] = 1;
    }
  }
  const SOFT = Math.max(1, W / 120); // about one model cell of the CMIP6 maps (0.25° in an 8.5° box)
  return sharp(px, { raw: { width: W, height: H, channels: 4 } }).blur(SOFT).raw().toBuffer();
}

/** A value's colour on a ramp ([[value, r, g, b, alpha 0-1], ...], clamped at both ends) as [r, g, b, alpha 0-255]. */
function rampColor(stops, v) {
  let k = 1;
  while (k < stops.length - 1 && v > stops[k][0]) k++;
  const [v0, ...c0] = stops[k - 1], [v1, ...c1] = stops[k];
  const t = Math.min(1, Math.max(0, (v - v0) / (v1 - v0 || 1)));
  return [0, 1, 2, 3].map((i) => (c0[i] + (c1[i] - c0[i]) * t) * (i === 3 ? 255 : 1));
}

/**
 * For maps recoloured from their raw values (a ramp of src/amib/hazards.js RAMPS): the value raster beside the
 * coloured one, at W × H, as RGBA in the ramp's colours and opacity. For sea maps (fill) the empty land cells take the
 * mean of their filled neighbours, spreading outwards, and the values are softened over about one model cell before
 * they are coloured, as fillAndSoften does with the colours (softening colours would mix the ramp's opacities).
 */
async function rampPixels(file, W, H, stops, fill) {
  const raw = file.replace(/_rgba\.tif$/i, ".tif");
  if (raw === file) throw new Error(`No value raster beside ${file}`);
  const tiff = await fromFile(raw), img = await tiff.getImage(), nd = img.getGDALNoData();
  const [band] = await tiff.readRasters({ samples: [0], width: W, height: H, resampleMethod: "nearest" });
  let v = Float32Array.from(band, (x) => (Number.isFinite(x) && x !== nd && Math.abs(x) < 1e10 ? x : NaN));
  if (fill) {
    for (let pass = 0; pass < 4 * (W + H); pass++) {
      const add = [];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (!Number.isNaN(v[y * W + x])) continue;
        let s = 0, c = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy, q = v[yy * W + xx];
          if (xx >= 0 && yy >= 0 && xx < W && yy < H && !Number.isNaN(q)) { s += q; c++; }
        }
        if (c) add.push(y * W + x, s / c);
      }
      if (!add.length) break;
      for (let k = 0; k < add.length; k += 2) v[add[k]] = add[k + 1];
    }
    const sigma = Math.max(1, W / 60), R = Math.ceil(3 * sigma); // a Gaussian across, then down, over about half a 0.25° model cell (they are about 10 px here), so the cells' squares do not show
    const kern = Array.from({ length: 2 * R + 1 }, (_, i) => Math.exp(-((i - R) ** 2) / (2 * sigma * sigma)));
    for (const [sx, sy] of [[1, 0], [0, 1]]) {
      const out = new Float32Array(W * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let s = 0, wsum = 0;
        for (let i = -R; i <= R; i++) {
          const xx = Math.max(0, Math.min(W - 1, x + i * sx)), yy = Math.max(0, Math.min(H - 1, y + i * sy)), q = v[yy * W + xx];
          if (!Number.isNaN(q)) { s += q * kern[i + R]; wsum += kern[i + R]; }
        }
        out[y * W + x] = wsum ? s / wsum : NaN;
      }
      v = out;
    }
  }
  const px = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) if (!Number.isNaN(v[i])) rampColor(stops, v[i]).forEach((c, k) => { px[i * 4 + k] = Math.round(c); });
  return px;
}

/**
 * For class maps meant to read as a tint on the satellite picture (the salt-affected soils): each class colour
 * ([[r, g, b, alpha 0-1]]) keeps its colour but is drawn only that opaque, so the ground shows through (common
 * classes faint, the salty ones strong). Before that, lone
 * pixels take the class most of their 3×3 neighbours have (Landsat speckle), and afterwards the class borders
 * are feathered over about a pixel, so the map has no pixel stair-steps or poster-flat patches. Hidden pixels stay hidden.
 * A tint may carry a display colour ([r, g, b, alpha, [r2, g2, b2]]): the class is then drawn in that colour (a class
 * colour that vanishes on the desert, see SHORE_TINTS in src/amib/hazards.js; the legend shows the same one).
 * crisp (the shoreline changes, often one pixel wide): no speckle filter or feathering, which would thin those out;
 * instead a thin dark outline round the strongest classes (alpha ≥ 0.9) makes them stand out from sand and sea alike.
 */
async function tintClasses(px, W, H, tints, crisp = false) {
  const N = W * H, cls = new Int8Array(N);
  for (let i = 0; i < N; i++) { // the nearest class colour (the pictures are lightly compressed, so colours vary a little)
    const o = i * 4;
    if (px[o + 3] < 128) { cls[i] = -1; continue; }
    let best = 0, bd = Infinity;
    tints.forEach(([r, g, b], k) => { const d = Math.abs(px[o] - r) + Math.abs(px[o + 1] - g) + Math.abs(px[o + 2] - b); if (d < bd) { bd = d; best = k; } });
    cls[i] = best;
  }
  const major = crisp ? cls : new Int8Array(N), votes = new Int32Array(tints.length + 2);
  if (!crisp) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (cls[i] < 0) { major[i] = -1; continue; } // hidden pixels are never filled in
    votes.fill(0);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < W && yy < H) votes[cls[yy * W + xx] + 1]++;
    }
    let best = cls[i] + 1;
    for (let k = 0; k < votes.length; k++) if (votes[k] > votes[best]) best = k;
    major[i] = votes[best] >= 5 ? best - 1 : cls[i]; // a clear majority only: thin features (creeks, field edges) survive
  }
  for (let i = 0; i < N; i++) {
    const o = i * 4, c = major[i];
    if (c < 0) { px[o + 3] = 0; continue; }
    const [r, g, b, a, shown] = tints[c];
    [px[o], px[o + 1], px[o + 2]] = shown ?? [r, g, b]; px[o + 3] = Math.round(255 * a);
  }
  if (crisp) { // outline: the faint pixels touching a strong class turn dark, about two thirds opaque
    const strong = (k) => major[k] >= 0 && tints[major[k]][3] >= 0.9;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (strong(i)) continue;
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1 && !near; dx++) {
        const xx = x + dx, yy = y + dy;
        near = xx >= 0 && yy >= 0 && xx < W && yy < H && strong(yy * W + xx);
      }
      if (near) { const o = i * 4; px[o] = 18; px[o + 1] = 16; px[o + 2] = 22; px[o + 3] = 165; }
    }
    return;
  }
  // feather: blur with the colours weighted by their alpha, so see-through pixels do not darken the borders
  let a = new Float32Array(N * 4), b = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) { const o = i * 4, al = px[o + 3] / 255; a[o] = px[o] * al; a[o + 1] = px[o + 1] * al; a[o + 2] = px[o + 2] * al; a[o + 3] = px[o + 3]; }
  for (const [sx, sy] of [[1, 0], [0, 1]]) { // a 1-2-1 filter across, then down (about one pixel of Gaussian blur)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      const p = (Math.max(0, Math.min(H - 1, y - sy)) * W + Math.max(0, Math.min(W - 1, x - sx))) * 4;
      const q = (Math.max(0, Math.min(H - 1, y + sy)) * W + Math.max(0, Math.min(W - 1, x + sx))) * 4;
      for (let k = 0; k < 4; k++) b[o + k] = (a[p + k] + 2 * a[o + k] + a[q + k]) / 4;
    }
    [a, b] = [b, a];
  }
  for (let i = 0; i < N; i++) {
    const o = i * 4, al = a[o + 3];
    px[o + 3] = Math.round(al);
    if (al > 0) { const f = 255 / al; px[o] = Math.round(a[o] * f); px[o + 1] = Math.round(a[o + 1] * f); px[o + 2] = Math.round(a[o + 2] * f); }
  }
}

/**
 * A soft, irregular edge for maps of a rectangular pilot area (the salt-affected soils of Keti Bandar and Sujawal), so
 * they do not end in a hard box: towards the picture's rim the pixels fade out along a wavy line. The waviness is a
 * fixed smooth noise of the position (no randomness per call), so every year of an area gets the same edge and the
 * timeline does not flicker. Only the outer band is touched; inside it every pixel is as delivered.
 */
function softEdge(px, W, H) {
  const hash = (x, y) => { const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return h - Math.floor(h); };
  const smooth = (t) => t * t * (3 - 2 * t);
  const noise = (x, y) => { // value noise on a unit grid, smoothly interpolated, 0..1
    const xi = Math.floor(x), yi = Math.floor(y), xf = smooth(x - xi), yf = smooth(y - yi);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
  const S = Math.min(W, H), BASE = 0.015, WAVE = 0.07, BAND = 0.06; // fractions of the shorter side
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4 + 3;
    if (!px[o]) continue;
    const d = Math.min(x, W - 1 - x, y, H - 1 - y) / S;
    if (d > BASE + WAVE + BAND) continue;
    const u = x / S, v = y / S;
    const t = BASE + WAVE * (0.65 * noise(u * 6, v * 6) + 0.35 * noise(u * 17 + 40, v * 17 + 40));
    const a = Math.min(1, Math.max(0, (d - t) / BAND));
    px[o] = Math.round(px[o] * smooth(a));
  }
}

/** PNG bytes of one pre-coloured GeoTIFF. clipRings: keep only what lies inside these rings (clipToRings); softEdges: fade a rectangular area out along a wavy rim (softEdge); tints: draw class colours see-through by class (tintClasses); ramp: draw the raw values in these colours instead (rampPixels). */
export async function renderAmibFile(file, { clearBackground = false, hideColors = [], clipRings = null, softEdges = false, tints = [], crisp = false, ramp = null } = {}) {
  const tiff = await fromFile(file), img = await tiff.getImage();
  const [w, s, e, n] = img.getBoundingBox();
  let spp = img.getSamplesPerPixel();
  const scale = Math.min(1, MAX / Math.max(img.getWidth(), img.getHeight()));
  let W = Math.max(1, Math.round(img.getWidth() * scale)), srcH = Math.max(1, Math.round(img.getHeight() * scale));
  let data = ramp ? await rampPixels(file, W, srcH, ramp, !!clipRings?.length) : await tiff.readRasters({ interleave: true, width: W, height: srcH, resampleMethod: "nearest" });
  if (ramp) { spp = 4; hideColors = []; }
  if (clipRings?.length) { // sea maps: fill the land cells, soften, and draw at up to 4× so the cut coast is smooth
    let rgba = ramp ? data : Buffer.alloc(W * srcH * 4); // a ramp's pixels are already filled and softened
    if (!ramp) {
      for (let i = 0; i < W * srcH; i++) {
        const k = i * spp;
        rgba[i * 4] = data[k]; rgba[i * 4 + 1] = data[spp >= 3 ? k + 1 : k]; rgba[i * 4 + 2] = data[spp >= 3 ? k + 2 : k];
        rgba[i * 4 + 3] = spp === 4 ? data[k + 3] : spp === 2 ? data[k + 1] : 255;
      }
      if (hideColors.length) hideClasses(rgba, hideColors);
      hideColors = [];
      rgba = await fillAndSoften(rgba, W, srcH);
    }
    const up = Math.max(1, Math.min(4, Math.floor(MAX / W)));
    data = await sharp(rgba, { raw: { width: W, height: srcH, channels: 4 } }).resize(W * up, srcH * up, { kernel: "cubic" }).raw().toBuffer();
    W *= up; srcH *= up; spp = 4;
  }
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
  if (tints.length) await tintClasses(out, W, H, tints, crisp);
  if (clipRings?.length) clipToRings(out, W, H, clipRings, [w, s, e, n]);
  if (softEdges) softEdge(out, W, H);
  return sharp(out, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
}
