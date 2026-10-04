/**
 * Colour scales named in the ocean catalog (matplotlib names; "_r" = reversed), as evenly spaced stops from low to high,
 * and the drawing of a data grid onto a canvas for the map.
 */
const STOPS = {
  viridis: ["#440154", "#482878", "#3e4989", "#31688e", "#26828e", "#1f9e89", "#35b779", "#6ece58", "#b5de2b", "#fde725"],
  magma: ["#000004", "#180f3d", "#440f76", "#721f81", "#9e2f7f", "#cd4071", "#f1605d", "#fd9668", "#feca8d", "#fcfdbf"],
  Reds: ["#fff5f0", "#fee0d2", "#fcbba1", "#fc9272", "#fb6a4a", "#ef3b2c", "#cb181d", "#a50f15", "#67000d"],
  Purples: ["#fcfbfd", "#efedf5", "#dadaeb", "#bcbddc", "#9e9ac8", "#807dba", "#6a51a3", "#54278f", "#3f007d"],
  YlOrRd: ["#ffffcc", "#ffeda0", "#fed976", "#feb24c", "#fd8d3c", "#fc4e2a", "#e31a1c", "#bd0026", "#800026"],
  YlGnBu: ["#ffffd9", "#edf8b1", "#c7e9b4", "#7fcdbb", "#41b6c4", "#1d91c0", "#225ea8", "#253494", "#081d58"],
  RdBu: ["#67001f", "#b2182b", "#d6604d", "#f4a582", "#fddbc7", "#f7f7f7", "#d1e5f0", "#92c5de", "#4393c3", "#2166ac", "#053061"],
  RdYlBu: ["#a50026", "#d73027", "#f46d43", "#fdae61", "#fee090", "#ffffbf", "#e0f3f8", "#abd9e9", "#74add1", "#4575b4", "#313695"],
  binary: ["#ffffff", "#000000"],
};
/** Class colours for categorical layers, in class order (best to worst for the habitat classes). */
export const CLASS_COLORS = ["#2c7fb8", "#7fcdbb", "#fdae61", "#d7191c", "#8856a7", "#636363"];

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
export function stopsOf(name = "viridis") {
  const reversed = name.endsWith("_r");
  const s = STOPS[reversed ? name.slice(0, -2) : name] ?? STOPS.viridis;
  return reversed ? [...s].reverse() : s;
}
export const gradientCss = (name) => `linear-gradient(to right, ${stopsOf(name).join(", ")})`;

function colorAt(stops, t) {
  const p = Math.min(1, Math.max(0, t)) * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(p)), f = p - i;
  return stops[i].map((c, k) => Math.round(c + (stops[i + 1][k] - c) * f));
}

const mercY = (lat) => Math.asinh(Math.tan((lat * Math.PI) / 180));
const WIDTH = 768; // canvas width: a little over 1 km per pixel across the study box; smooth, yet quick to redraw each year

/** Outer and inner rings of every polygon in a GeoJSON boundary. */
export const ringsOf = (boundary) => (boundary?.features ?? []).flatMap((f) => (f.geometry.type === "Polygon" ? f.geometry.coordinates : f.geometry.coordinates.flat()));

/** Is a point inside the boundary? Even-odd ray casting over all rings, so holes count as outside. */
export function insideRings(rings, lon, lat) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/**
 * Cells without data take the mean of their neighbours that have it, ring by ring outwards, so the drawn layer has
 * no holes or stepped edges between the product's last cell and the coast. Class layers copy a neighbour's class.
 */
function fillGaps(grid, isClass) {
  const { width: gw, height: gh } = grid, vals = grid.values.slice();
  for (let pass = 0; pass < gw + gh; pass++) {
    const next = vals.slice();
    let filled = 0, left = 0;
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      if (vals[y * gw + x] != null) continue;
      let sum = 0, count = 0, first = null;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const v = x + dx < 0 || x + dx >= gw || y + dy < 0 || y + dy >= gh ? null : vals[(y + dy) * gw + x + dx];
        if (v != null) { sum += v; count++; first ??= v; }
      }
      if (count) { next[y * gw + x] = isClass ? first : sum / count; filled++; } else left++;
    }
    vals.splice(0, vals.length, ...next);
    if (!filled || !left) break;
  }
  return vals;
}

/** Shrink (erode) or grow a 0/1 mask by r pixels, as two straight passes. */
function morph(src, W, H, r, erode) {
  const want = erode ? 0 : 1, run = (inp, lineLen, lines, idx) => {
    const res = new Uint8Array(W * H);
    for (let l = 0; l < lines; l++) for (let p = 0; p < lineLen; p++) {
      let hit = false;
      for (let k = Math.max(0, p - r), end = Math.min(lineLen - 1, p + r); k <= end && !hit; k++) hit = inp[idx(l, k)] === want;
      res[idx(l, p)] = hit ? want : 1 - want;
    }
    return res;
  };
  return run(run(src, W, H, (y, x) => y * W + x), H, W, (x, y) => y * W + x);
}

const INLET_KM = 4; // inlets narrower than about twice this are left out
const masks = new Map();
/**
 * Open-sea mask for the canvas: the boundary polygon's coverage (0–255, soft edge) with narrow inlets removed.
 * The EEZ outline runs up every creek of the delta; colouring those thin channels from a 25 km ocean grid looks
 * wrong, so the area is shrunk and regrown by a few kilometres, which drops the creeks and keeps the open coast.
 */
function seaMask(rings, [w, s, e, n], W, H, yN, yS) {
  const key = `${W}x${H}:${w},${s},${e},${n}:${rings.length}`;
  if (masks.has(key)) return masks.get(key);
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  ctx.beginPath();
  for (const ring of rings) {
    ring.forEach(([lon, lat], k) => ctx[k ? "lineTo" : "moveTo"](((lon - w) / (e - w)) * W, ((yN - mercY(lat)) / (yN - yS)) * H));
    ctx.closePath();
  }
  ctx.fill("evenodd");
  const rgba = ctx.getImageData(0, 0, W, H).data, alpha = new Uint8Array(W * H), solid = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) { alpha[i] = rgba[i * 4 + 3]; solid[i] = alpha[i] > 127 ? 1 : 0; }
  const kmPerPx = ((e - w) * 111.32 * Math.cos((((n + s) / 2) * Math.PI) / 180)) / W, r = Math.max(1, Math.round(INLET_KM / kmPerPx));
  const open = morph(morph(solid, W, H, r, true), W, H, r + 1, false);
  for (let i = 0; i < W * H; i++) if (!open[i]) alpha[i] = 0;
  masks.set(key, alpha);
  return alpha;
}

/**
 * Draw a grid ({ width, height, bounds: [w, s, e, n], values } with rows from the north, null = no data) with the
 * layer's colour scale. Rows are placed by Web-Mercator latitude so the image lines up when stretched on the map.
 * With a boundary (GeoJSON polygons), the layer covers the open sea inside it right up to the coast and nothing
 * outside it. Returns a PNG data URL and corner coordinates for a MapLibre image source, plus inside(lon, lat) to
 * test points against the same area.
 */
export function drawGrid(grid, layer, boundary = null) {
  const [w, s, e, n] = grid.bounds, yN = mercY(n), yS = mercY(s);
  const CELL = Math.ceil(WIDTH / grid.width);
  const W = grid.width * CELL, H = Math.max(1, Math.round((W * (yN - yS)) / (((e - w) * Math.PI) / 180)));
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d"), img = ctx.createImageData(W, H);
  const classes = layer.classes ? Object.keys(layer.classes).map(Number).sort((a, b) => a - b) : null;
  const stops = classes ? CLASS_COLORS.map(rgb) : stopsOf(layer.colormap).map(rgb);
  const span = layer.vmax - layer.vmin || 1;
  const rings = ringsOf(boundary), mask = rings.length ? seaMask(rings, grid.bounds, W, H, yN, yS) : null;
  const values = mask ? fillGaps(grid, !!classes) : grid.values; // gaps are only filled when a boundary limits the result
  // Smooth display: each pixel is the distance-weighted mean of the four nearest cell centres, so the coarse cells
  // (25 km or more) fade into each other instead of showing as blocks. Class layers are never blended.
  // This loop runs for every pixel of every frame while the timeline plays, so it works on plain numbers and
  // look-up tables only: per-column positions, a 256-step colour table, no objects created inside it.
  const gw = grid.width, gh = grid.height, px = img.data;
  const clampX = (x) => Math.min(gw - 1, Math.max(0, x)), clampY = (y) => Math.min(gh - 1, Math.max(0, y));
  const xa = new Int32Array(W), xb = new Int32Array(W), tx = new Float32Array(W), xn = new Int32Array(W);
  for (let i = 0; i < W; i++) { const fx = (i + 0.5) / CELL - 0.5, x0 = Math.floor(fx); xa[i] = clampX(x0); xb[i] = clampX(x0 + 1); tx[i] = fx - x0; xn[i] = clampX(Math.round(fx)); }
  const lut = new Uint8Array(256 * 3);
  if (!classes) for (let k = 0; k < 256; k++) lut.set(colorAt(stops, k / 255), k * 3);
  const classColor = (v) => stops[Math.max(0, classes.indexOf(Math.round(v))) % stops.length];
  for (let j = 0; j < H; j++) {
    const lat = (Math.atan(Math.sinh(yN - ((j + 0.5) / H) * (yN - yS))) * 180) / Math.PI;
    const fy = ((n - lat) / (n - s)) * gh - 0.5, y0 = Math.floor(fy), ty = fy - y0; // position in grid rows, from cell centres
    const ra = clampY(y0) * gw, rb = clampY(y0 + 1) * gw, rn = clampY(Math.round(fy)) * gw;
    for (let i = 0; i < W; i++) {
      const a = mask ? mask[j * W + i] : 255;
      if (!a) continue; // outside the boundary, or a narrow inlet
      const o = (j * W + i) * 4;
      if (classes) {
        const v = values[rn + xn[i]];
        if (v == null) continue;
        const c = classColor(v);
        px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = a;
        continue;
      }
      const t = tx[i], v00 = values[ra + xa[i]], v10 = values[ra + xb[i]], v01 = values[rb + xa[i]], v11 = values[rb + xb[i]];
      let sum = 0, weight = 0, wgt;
      if (v00 != null) { wgt = (1 - t) * (1 - ty); sum += v00 * wgt; weight += wgt; }
      if (v10 != null) { wgt = t * (1 - ty); sum += v10 * wgt; weight += wgt; }
      if (v01 != null) { wgt = (1 - t) * ty; sum += v01 * wgt; weight += wgt; }
      if (v11 != null) { wgt = t * ty; sum += v11 * wgt; weight += wgt; }
      if (!weight) continue; // no data nearby: stays transparent
      const k = Math.min(255, Math.max(0, Math.round(((sum / weight - layer.vmin) / span) * 255))) * 3;
      px[o] = lut[k]; px[o + 1] = lut[k + 1]; px[o + 2] = lut[k + 2]; px[o + 3] = a;
    }
  }
  ctx.putImageData(img, 0, 0);
  const inside = (lon, lat) => {
    if (!mask) return true;
    const i = Math.floor(((lon - w) / (e - w)) * W), j = Math.floor(((yN - mercY(lat)) / (yN - yS)) * H);
    return i >= 0 && i < W && j >= 0 && j < H && mask[j * W + i] > 127;
  };
  return { url: canvas.toDataURL("image/png"), coordinates: [[w, n], [e, n], [e, s], [w, s]], inside };
}
