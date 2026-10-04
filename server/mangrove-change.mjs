/**
 * Mangrove change pictures: the delivered extent of one year compared with the first mapped year, as a PNG.
 *   yellow  mangrove in both years (still standing)
 *   blue    mangrove now, none in the first year (gained)
 *   red     mangrove in the first year, none now (lost)
 * The yearly shapes in mangrove_extent are drawn into a pixel mask (SVG rendered by sharp) and the two masks are
 * compared pixel by pixel. Nothing is modelled here: every pixel comes from the delivered shapes of the two years.
 * The coast is covered by two frames so each stays sharp: the east (Sonmiani, Karachi, Indus Delta) and the west (Makran).
 */
import sharp from "sharp";
import { query } from "./db.mjs";

export const FRAMES = {
  east: { bounds: [66.0, 23.6, 68.7, 25.65], width: 4096 },
  west: { bounds: [61.5, 24.85, 66.0, 25.65], width: 6144 },
};
const COLORS = { stable: [255, 214, 10], gain: [36, 132, 255], loss: [255, 51, 51] };

const R = 6378137, mx = (lon) => (lon * Math.PI / 180) * R, my = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * R;
function grid(frame) {
  const f = FRAMES[frame], [w, s, e, n] = f.bounds, x0 = mx(w), x1 = mx(e), y0 = my(s), y1 = my(n), k = f.width / (x1 - x0);
  return { x0, y0, x1, y1, k, width: f.width, height: Math.round((y1 - y0) * k) };
}

/** One byte per pixel, 255 where the year's shapes cover it. The shapes are stored in Web Mercator, which is also the map's own grid. */
async function mask(frame, scenario, year) {
  const g = grid(frame);
  const { rows } = await query(
    `select ST_AsSVG(ST_Collect(ST_TransScale(geom, $7, $8, $9, $9)), 0, 1) as d from mangrove_extent
     where scenario = $1 and year = $2::int and geom && ST_MakeEnvelope($3, $4, $5, $6, 3857)`,
    [scenario, year, g.x0, g.y0, g.x1, g.y1, -g.x0, -g.y1, g.k]);
  if (!rows[0].d) return Buffer.alloc(g.width * g.height);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${g.width}" height="${g.height}" viewBox="0 0 ${g.width} ${g.height}"><path d="${rows[0].d}" fill="#fff" fill-rule="evenodd"/></svg>`;
  return sharp(Buffer.from(svg), { unlimited: true }).ensureAlpha().extractChannel(3).raw().toBuffer();
}

const baseMasks = new Map(); // the first year's mask is used by every picture, so it is drawn once
const baseMask = (frame, year) => baseMasks.get(`${frame}:${year}`) ?? baseMasks.set(`${frame}:${year}`, mask(frame, "observed", year)).get(`${frame}:${year}`);

export async function mangroveChangeImage(frame, scenario, year, baseYear) {
  if (!FRAMES[frame]) return null;
  const g = grid(frame), [now, base] = await Promise.all([mask(frame, scenario, year), baseMask(frame, baseYear)]);
  const out = Buffer.alloc(g.width * g.height * 4);
  for (let i = 0, o = 0; i < now.length; i++, o += 4) {
    const a = now[i] > 127, b = base[i] > 127;
    if (!a && !b) continue;
    const c = a && b ? COLORS.stable : a ? COLORS.gain : COLORS.loss;
    out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = 255;
  }
  return sharp(out, { raw: { width: g.width, height: g.height, channels: 4 } }).png({ palette: true, colours: 8, compressionLevel: 9 }).toBuffer();
}
