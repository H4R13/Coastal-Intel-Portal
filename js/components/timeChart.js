/**
 * Line chart over years that follows the timeline: the part up to the current year is drawn bright, the rest faint,
 * with a cursor line, a dot on each series and a read-out of the values at that year.
 *   timeChart(groups, { yLabel, unit })   groups = [{ name, points: [{ x: year, y }] }]  → HTML string
 *   syncTimeCharts()                      call after inserting that HTML; later years are followed automatically
 * Also owns the pop-out view: any element with [data-popbox] gets shown full screen by a [data-pop] button inside it.
 */
import { getState, subscribe } from "../state.js";

const W = 340, H = 200, M = { l: 46, r: 12, t: 14, b: 30 };
const PALETTE = ["var(--layer, var(--accent))", "#c9a3e6", "#7fd0c8", "#d8b77a", "#9fb4ff", "#e79ac0", "#b9d27a", "#f2c179"];
/* Scenario lines always get the same three colours, whatever the layer: low/good blue, medium/normal orange,
   high/worst red; measured series are near-white. Other series take the palette in order. */
const SCENARIO_COLORS = [[/ssp1|126|\blow\b|good/i, "#5fa8e8"], [/ssp2|245|medium|normal/i, "#f79420"], [/ssp5|585|\bhigh\b|worst/i, "#e5534b"], [/observ|mapped|measured|histor/i, "#e5e8e5"]];
function colorsFor(groups) {
  const used = new Set();
  return groups.map((g, i) => {
    const fixed = g.color ?? SCENARIO_COLORS.find(([re]) => re.test(g.name))?.[1]; // a series may bring its own colour
    const color = fixed && !used.has(fixed) ? fixed : PALETTE[i % PALETTE.length]; // two series of one scenario: the second takes a palette colour
    used.add(color);
    return color;
  });
}
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (v) => (Number.isInteger(v) ? String(v) : Math.abs(v) < 1e-3 || Math.abs(v) >= 1e6 ? v.toExponential(2) : String(+v.toPrecision(4)));

const charts = new Map(); // chart id → { groups, x0, x1, y0, y1, unit }
let seq = 0;
const px = (c, x) => M.l + ((x - c.x0) / (c.x1 - c.x0 || 1)) * (W - M.l - M.r);
const py = (c, y) => H - M.b - ((y - c.y0) / (c.y1 - c.y0 || 1)) * (H - M.t - M.b);

export function timeChart(groups, { yLabel = "", unit = "" } = {}) {
  const pts = groups.flatMap((g) => g.points), xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const pad = (Math.max(...ys) - Math.min(...ys)) * 0.06 || 1;
  const COLORS = colorsFor(groups);
  const c = { groups, unit, colors: COLORS, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys) - pad, y1: Math.max(...ys) + pad };
  const id = String(++seq);
  charts.set(id, c);
  const lines = groups.map((g, i) => `<polyline class="ln" style="stroke:${COLORS[i % COLORS.length]}" points="${g.points.map((p) => `${px(c, p.x).toFixed(1)},${py(c, p.y).toFixed(1)}`).join(" ")}"/>`).join("");
  const yTicks = [c.y0 + pad, (c.y0 + c.y1) / 2, c.y1 - pad];
  return `<div class="tc" data-tc="${id}">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(yLabel)} by year">
      <defs><clipPath id="tc-${id}-clip"><rect class="tc-clip" x="0" y="0" width="${W}" height="${H}"/></clipPath></defs>
      ${yTicks.map((y) => `<line class="gd" x1="${M.l}" x2="${W - M.r}" y1="${py(c, y)}" y2="${py(c, y)}"/><text class="axl" x="${M.l - 5}" y="${py(c, y) + 3}" text-anchor="end">${fmt(y)}</text>`).join("")}
      <line class="ax" x1="${M.l}" y1="${H - M.b}" x2="${W - M.r}" y2="${H - M.b}"/>
      <text class="axl" x="${M.l}" y="${H - 16}">${c.x0}</text><text class="axl" x="${W - M.r}" y="${H - 16}" text-anchor="end">${c.x1}</text>
      <text class="axl" x="${(M.l + W - M.r) / 2}" y="${H - 4}" text-anchor="middle">${esc(yLabel)}${unit ? ` (${esc(unit)})` : ""}</text>
      <g class="tc-rest">${lines}</g>
      <g clip-path="url(#tc-${id}-clip)">${lines}</g>
      <line class="tc-cur" x1="0" x2="0" y1="${M.t - 4}" y2="${H - M.b}"/>
      <text class="tc-year" x="0" y="${M.t - 6}" text-anchor="middle"></text>
      ${groups.map((g, i) => `<circle class="tc-dot" r="3" style="fill:${COLORS[i % COLORS.length]}"/>`).join("")}
    </svg>
    <div class="tc-read"></div>
  </div>`;
}

/** Move every chart on the page to the timeline year. */
export function syncTimeCharts(year = getState().year) {
  document.querySelectorAll("[data-tc]").forEach((el) => {
    const c = charts.get(el.dataset.tc);
    if (!c) return;
    const at = Math.min(c.x1, Math.max(c.x0, year)), x = px(c, at);
    el.querySelector(".tc-clip").setAttribute("width", x);
    const cur = el.querySelector(".tc-cur"); cur.setAttribute("x1", x); cur.setAttribute("x2", x);
    const label = el.querySelector(".tc-year"); label.setAttribute("x", Math.min(W - M.r - 12, Math.max(M.l + 12, x))); label.textContent = at;
    const dots = el.querySelectorAll(".tc-dot"), read = [];
    c.groups.forEach((g, i) => {
      const p = g.points.filter((q) => q.x <= at).pop(); // the series' latest value at or before this year
      dots[i].style.display = p ? "" : "none";
      if (p) { dots[i].setAttribute("cx", px(c, p.x)); dots[i].setAttribute("cy", py(c, p.y)); }
      // every series is always listed, so all scenarios are named even before the timeline reaches them
      read.push(`<span><i style="background:${c.colors[i]}"></i>${esc(g.name)} ${p ? `<b>${fmt(p.y)}</b>${c.unit ? ` ${esc(c.unit)}` : ""}${p.x !== at ? ` <em>(${p.x})</em>` : ""}` : `<em>from ${g.points[0].x}</em>`}</span>`);
    });
    el.querySelector(".tc-read").innerHTML = read.join("");
  });
  document.querySelectorAll(".bar[data-from]").forEach((b) => b.classList.toggle("ahead", +b.dataset.from >= year)); // period not begun yet
  for (const id of charts.keys()) if (!document.querySelector(`[data-tc="${id}"]`)) charts.delete(id); // forget charts that left the page
}
subscribe((s) => syncTimeCharts(s.year));

/* ---- pop-out: show a chart or table full screen, closed with the X, Esc or a click outside ---- */
export const POP_BUTTON = `<button class="pop-btn" data-pop aria-label="Open full view" title="Open full view"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7"/></svg></button>`;

let dialog = null;
function popOut(box) {
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.className = "chart-pop";
    dialog.innerHTML = `<button class="pop-close" aria-label="Close full view" title="Close">✕</button><div class="pop-body"></div>`;
    document.body.appendChild(dialog);
    dialog.querySelector(".pop-close").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (e) => e.target === dialog && dialog.close());
    dialog.addEventListener("close", () => (dialog.querySelector(".pop-body").innerHTML = ""));
  }
  const layer = getComputedStyle(box).getPropertyValue("--layer");
  // the copy needs its own clip-path ids, or it would share the original's
  dialog.querySelector(".pop-body").innerHTML = `<div style="--layer:${layer}">${box.outerHTML.replace(/tc-(\d+)-clip/g, "tc-$1-clip-pop")}</div>`;
  dialog.querySelector("[data-pop]")?.remove();
  dialog.showModal();
  syncTimeCharts();
}
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-pop]");
  if (btn) popOut(btn.closest("[data-popbox]"));
});
