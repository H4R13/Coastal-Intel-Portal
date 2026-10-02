/**
 * Chart component. renderChart(cfg, data?) returns an HTML string.
 * With no data → a labelled, data-pending frame (no invented values).
 * With data → minimal line / bar rendering. Expected shape:
 *   data = { series: [{ name, points: [{ x: number|string, y: number }] }] }
 */
const W = 340, H = 200, M = { l: 44, r: 12, t: 12, b: 34 };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function frame(cfg) {
  const x0 = M.l, x1 = W - M.r, y0 = H - M.b, y1 = M.t;
  const unit = cfg.unit && cfg.unit !== "—" ? ` (${esc(cfg.unit)})` : "";
  return `
    <line class="ax" x1="${x0}" y1="${y0}" x2="${x1}" y2="${y0}"/>
    <line class="ax" x1="${x0}" y1="${y0}" x2="${x0}" y2="${y1}"/>
    <text class="axl" x="${(x0 + x1) / 2}" y="${H - 6}" text-anchor="middle">${esc(cfg.xLabel)}</text>
    <text class="axl" transform="translate(12 ${(y0 + y1) / 2}) rotate(-90)" text-anchor="middle">${esc(cfg.yLabel)}${unit}</text>`;
}

function pending(cfg) {
  const x0 = M.l, x1 = W - M.r, y0 = H - M.b, y1 = M.t;
  const guides = [0.25, 0.5, 0.75].map((f) => `<line class="gd" x1="${x0}" x2="${x1}" y1="${y0 - (y0 - y1) * f}" y2="${y0 - (y0 - y1) * f}"/>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(cfg.title)} — dataset required">
    ${guides}${frame(cfg)}
    <text class="pend" x="${(x0 + x1) / 2}" y="${(y0 + y1) / 2 - 2}" text-anchor="middle">Dataset required</text>
    <text class="pend-sub" x="${(x0 + x1) / 2}" y="${(y0 + y1) / 2 + 16}" text-anchor="middle">${esc(cfg.placeholder)}</text>
  </svg>`;
}

function plotted(cfg, data) {
  const series = data.series ?? [];
  const pts = series.flatMap((s) => s.points);
  if (!pts.length) return pending(cfg);
  const cat = typeof pts[0].x === "string";
  const xs = cat ? [...new Set(pts.map((p) => p.x))] : pts.map((p) => p.x);
  const xMin = cat ? 0 : Math.min(...xs), xMax = cat ? xs.length - 1 || 1 : Math.max(...xs);
  const yMax = Math.max(0, ...pts.map((p) => p.y)), yMin = Math.min(0, ...pts.map((p) => p.y));
  const px = (x) => M.l + ((cat ? xs.indexOf(x) : x) - xMin) / (xMax - xMin || 1) * (W - M.l - M.r);
  const py = (y) => H - M.b - ((y - yMin) / (yMax - yMin || 1)) * (H - M.t - M.b);
  let body = "";
  if (cfg.type === "bar") {
    const bw = Math.max(4, ((W - M.l - M.r) / xs.length) * 0.5);
    body = pts.map((p) => `<rect class="bar" x="${px(p.x) - bw / 2}" y="${Math.min(py(p.y), py(0))}" width="${bw}" height="${Math.abs(py(p.y) - py(0))}" rx="1.5"/>`).join("");
  } else {
    body = series.map((s, i) => `<polyline class="ln s${i % 4}" points="${s.points.map((p) => `${px(p.x)},${py(p.y)}`).join(" ")}"/>`).join("");
  }
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(cfg.title)}">${frame(cfg)}${body}</svg>`;
}

export async function loadChartData(cfg) {
  if (!cfg.endpoint) return null;
  try { return await (await fetch(cfg.endpoint)).json(); } catch { return null; }
}

export function renderChart(cfg, data = null) {
  return `<figure class="chart ${data ? "" : "is-pending"}" data-type="${cfg.type}">
    <figcaption><span class="chart-title">${esc(cfg.title)}</span><span class="chart-tag">${data ? esc(cfg.unit ?? "") : "No data connected"}</span></figcaption>
    ${data ? plotted(cfg, data) : pending(cfg)}
  </figure>`;
}
