/**
 * Figures for the ocean package's charts and tables (catalog layers of type "timeseries" and "table").
 * Each one is drawn the way its catalog entry asks where that fits a side panel:
 *   year series            → lines that follow the timeline (region / product / measure pickers)
 *   bar, grouped_bar, horizontal_bar, dot_plot → horizontal bars or dots with the package's reference lines
 *   strip_plot             → one row of dots per indicator, the highlighted country marked
 *   big_number             → the headline value
 *   everything else        → a tile that opens the table full screen
 * Every chart card can flip to its data table, and every card opens full screen.
 *   figureCard(l, data)    HTML for one catalog entry;  kindOf(l, data) → "stat" | "chart" | "table"
 */
import { timeChart, syncTimeCharts, POP_BUTTON, FIRST_YEAR } from "../components/timeChart.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const num = (v) => (typeof v !== "number" ? esc(v ?? "") : Number.isInteger(v) ? String(v) : Math.abs(v) < 1e-3 || Math.abs(v) >= 1e6 ? v.toExponential(2) : String(+v.toPrecision(4)));
const cell = (v) => (v == null ? "–" : v === true ? "✓" : v === false ? "✗" : Array.isArray(v) ? v.map(num).join("–") : num(v));
const NAMES = { ph: "pH", sst: "SST", omega: "Omega", PI: "PI" };
const pretty = (k) => { if (NAMES[k]) return NAMES[k]; const s = String(k).replace(/_pct\b/g, " %").replace(/_km2\b/g, " km²").replace(/_/g, " ").trim(); return s.charAt(0).toUpperCase() + s.slice(1); };
const titleOf = (l) => String(l.title).replace(/\s*\(table\)\s*$/i, "");
const PALETTE = ["var(--layer, var(--accent))", "#c9a3e6", "#7fd0c8", "#d8b77a", "#9fb4ff", "#e79ac0", "#b9d27a", "#f2c179"];
const BAR_TYPES = ["bar", "grouped_bar", "horizontal_bar", "dot_plot"];
const TABLE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M3.5 14.5h17M9.5 9.5v10"/></svg>`;

const docs = new Map(); // catalog id → { l, data }, so a card can redraw itself (also the copy in the full-screen view)

export function kindOf(l, data) {
  if (!data) return "table";
  if (!Array.isArray(data)) return "chart";
  if (l.chart?.type === "big_number") return "stat";
  return BAR_TYPES.includes(l.chart?.type) || l.chart?.type === "strip_plot" ? "chart" : "table";
}

const chips = (name, values, current, label = (v) => v) => (values.length < 2 ? "" : `<div class="xchips">${values.map((v) => `<button class="xchip ${v === current ? "active" : ""}" data-pick="${name}" data-value="${esc(v)}">${esc(label(v))}</button>`).join("")}</div>`);

/* ---- tables ---- */
/** Series files are { region: { product: [rows] } }; flatten them for a table. */
const early = (r) => (typeof r.year === "number" && r.year < FIRST_YEAR) || (typeof r.time === "string" && +r.time.slice(0, 4) < FIRST_YEAR); // before the timeline: not shown anywhere
const flatten = (data) => (Array.isArray(data) ? data : Object.entries(data).flatMap(([region, byProduct]) => Object.entries(byProduct).flatMap(([product, rows]) => rows.filter((r) => !early(r)).map((r) => ({ region, product, ...r })))));
const ID_COLUMNS = ["region", "product", "definition", "variant", "scenario", "metric", "benchmark", "where", "model"];
const td = (v) => `<td class="${typeof v === "number" ? "n" : typeof v === "string" && v.length > 40 ? "txt" : ""}">${cell(v)}</td>`;

function tableHtml(rows, columns) {
  if (!rows.length) return `<p class="caveat">No rows.</p>`;
  const cols = columns?.filter((c) => c in rows[0]) ?? Object.keys(rows[0]);
  // a few records with many fields read better turned on their side: one column per record
  if (!columns && cols.length > 8 && rows.length <= 8) {
    const ids = ID_COLUMNS.filter((c) => cols.includes(c));
    return `<div class="otable"><table><thead><tr><th></th>${rows.map((r, i) => `<th>${esc(ids.map((k) => r[k]).join(" · ") || `#${i + 1}`)}</th>`).join("")}</tr></thead>
      <tbody>${cols.filter((c) => !ids.includes(c)).map((c) => `<tr><th>${esc(pretty(c))}</th>${rows.map((r) => td(r[c])).join("")}</tr>`).join("")}</tbody></table></div>`;
  }
  return `<div class="otable"><table><thead><tr>${cols.map((c) => `<th>${esc(pretty(c))}</th>`).join("")}</tr></thead>
    <tbody>${rows.slice(0, 400).map((r) => `<tr>${cols.map((c) => td(r[c])).join("")}</tr>`).join("")}</tbody></table></div>
    ${rows.length > 400 ? `<p class="caveat">First 400 of ${rows.length} rows.</p>` : ""}`;
}
const tableOf = (l, data) => tableHtml(flatten(data), l.chart?.type === "table_with_markers" ? l.chart.columns : null);

/* ---- year series ---- */
/** Monthly rows ("2004-01") become one point per full year: the mean of its twelve months. */
function yearly(rows, xKey, k) {
  if (xKey === "year") return rows.filter((r) => r[k] != null).map((r) => ({ x: r.year, y: r[k] }));
  const byYear = new Map();
  for (const r of rows) if (r[k] != null) { const y = +String(r[xKey]).slice(0, 4); byYear.set(y, [...(byYear.get(y) ?? []), r[k]]); }
  return [...byYear].filter(([, v]) => v.length === 12).map(([x, v]) => ({ x, y: v.reduce((a, b) => a + b, 0) / 12 }));
}

function seriesFigure(l, data, pick) {
  const c = l.chart ?? {}, facets = Object.keys(data);
  const facet = facets.includes(pick.facet) ? pick.facet : facets.includes("Whole EEZ") ? "Whole EEZ" : facets[0];
  const products = Object.keys(data[facet]), first = data[facet][products[0]] ?? [];
  const xKey = first[0] && "year" in first[0] ? "year" : "time";
  const numeric = Object.keys(first[0] ?? {}).filter((k) => k !== xKey && first.some((r) => typeof r[k] === "number"));
  const colorOf = (k) => (typeof c.colors === "object" ? c.colors[k] ?? c.colors[k.replace(/_pct$/, "")] : undefined);
  // columns the entry draws together on one axis (heatwave classes, stock-status shares, index parts)
  const together = c.type !== "line_monthly_annual" && [].concat(Array.isArray(c.y) ? c.y : Array.isArray(c.panels) ? c.panels[0].y : [], c.line ?? []).filter((k) => numeric.includes(k));
  let groups, controls = chips("facet", facets, facet), yLabel;
  if (together?.length > 1) {
    const product = products.includes(pick.product) ? pick.product : products[0];
    groups = together.map((k) => ({ name: pretty(k), color: colorOf(k), points: yearly(data[facet][product], xKey, k) }));
    controls += chips("product", products, product, pretty);
    yLabel = typeof c.y_label === "string" ? c.y_label : "";
  } else {
    const asked = typeof c.y === "string" ? c.y.split(" or ") : [].concat(c.y ?? []);
    const measures = [...asked.filter((k) => numeric.includes(k)), ...numeric.filter((k) => !asked.includes(k) && !/(_sd|_lo|_hi)$|^n_models$/.test(k))];
    const measure = measures.includes(pick.measure) ? pick.measure : measures[0];
    const label = (k) => (typeof c.y_label === "object" ? c.y_label[k] : k === c.y ? c.y_label : null) ?? pretty(k);
    groups = products.map((p) => ({ name: c.labels?.[p] ?? p, color: c.series_colors?.[p], points: yearly(data[facet][p], xKey, measure) }));
    if (measures.length > 1) controls += `<div class="select omeasure"><select data-pick="measure" aria-label="Measure">${measures.map((k) => `<option value="${esc(k)}" ${k === measure ? "selected" : ""}>${esc(label(k))}</option>`).join("")}</select></div>`;
    yLabel = label(measure);
  }
  groups = groups.filter((g) => g.points.length);
  if (!groups.length) return `${controls}<p class="caveat">No values for this choice.</p>`;
  return `${controls}${timeChart(groups, { yLabel })}${xKey === "year" ? "" : `<p class="caveat">Each point is the mean of that year's twelve monthly values.</p>`}`;
}

/* ---- bars and dots ---- */
function barsFigure(l, rows, pick) {
  const c = l.chart, flat = c.type === "horizontal_bar" || c.type === "dot_plot";
  let labelKey = flat ? c.y : c.x, picker = "";
  const keys = [].concat(flat ? c.x : c.y);
  const labels = [...new Set(rows.map((r) => r[labelKey]))];
  if (c.series && labels.length < rows.length) { // several rows per label (one per product): pick the label, list the products
    const facet = labels.includes(pick.facet) ? pick.facet : labels[0];
    picker = chips("facet", labels, facet);
    rows = rows.filter((r) => r[labelKey] === facet);
    labelKey = c.series;
  }
  if (/descending/.test(c.sort ?? "")) rows = [...rows].sort((a, b) => (b[keys[0]] ?? -Infinity) - (a[keys[0]] ?? -Infinity));
  const refs = Array.isArray(c.reference_lines) ? c.reference_lines.filter((r) => typeof r.y === "number") : [];
  const values = rows.flatMap((r) => keys.map((k) => r[k])).filter((v) => typeof v === "number");
  if (!values.length) return tableHtml(rows);
  const lo = Math.min(0, ...values), hi = Math.max(c.y_range?.[1] ?? 0, ...values, ...refs.map((r) => r.y)), pos = (v) => ((v - lo) / (hi - lo || 1)) * 100;
  const cats = c.color_by ? [...new Set(rows.map((r) => r[c.color_by]))] : [];
  const catColor = (v) => (typeof c.colors === "object" && c.colors[v]) || PALETTE[cats.indexOf(v) % PALETTE.length];
  const colorOf = (r, i) => (c.color_by ? catColor(r[c.color_by]) : PALETTE[i % PALETTE.length]);
  const key = keys.length > 1 ? keys.map((k, i) => [pretty(k), PALETTE[i % PALETTE.length]]) : cats.map((v) => [v, catColor(v)]);
  const axis = (flat ? c.x_label : c.y_label) ?? (keys.length === 1 ? pretty(keys[0]) : "");
  return `${picker}<ul class="obars">${rows.map((r) => `<li class="${c.highlight && r[labelKey] === c.highlight ? "hl" : ""}"><span class="obar-name">${esc(r[labelKey])}</span>${keys.map((k, i) => {
    const v = r[k];
    if (typeof v !== "number") return "";
    const mark = c.type === "dot_plot" ? `<i class="dot" style="left:${pos(v)}%;background:${colorOf(r, i)}"></i>` : `<i style="left:${pos(Math.min(v, 0))}%;width:${Math.abs(pos(v) - pos(0))}%;background:${colorOf(r, i)}"></i>`;
    return `<div class="obar"><div class="obar-track">${mark}${refs.map((x) => `<u style="left:${pos(x.y)}%"></u>`).join("")}</div><b>${num(v)}</b></div>`;
  }).join("")}</li>`).join("")}</ul>
  ${key.length || refs.length ? `<div class="okey">${key.map(([name, color]) => `<span><i style="background:${color}"></i>${esc(name)}</span>`).join("")}${refs.map((x) => `<span><u></u>${esc(x.label ?? num(x.y))}</span>`).join("")}</div>` : ""}
  ${axis ? `<p class="oaxis">${esc(axis)}</p>` : ""}`;
}

/** One row of dots per indicator, every record a dot, the highlighted one large with its value. */
function stripFigure(l, rows) {
  const c = l.chart, [hKey, hValue] = Object.entries(c.highlight ?? {}).find(([k]) => k !== "label") ?? [], W = 340, ROW = 58, PAD = 12;
  const me = rows.find((r) => String(r[hKey]) === String(hValue));
  return `<svg viewBox="0 0 ${W} ${c.x.length * ROW + 6}" role="img" aria-label="${esc(titleOf(l))}">${c.x.map((k, i) => {
    const vals = rows.map((r) => r[k]).filter((v) => typeof v === "number"), lo = Math.min(...vals), hi = Math.max(...vals), y = i * ROW + 38;
    const x = (v) => PAD + ((v - lo) / (hi - lo || 1)) * (W - 2 * PAD);
    return `<text class="pend-sub" x="${PAD}" y="${y - 24}">${esc(pretty(k))}</text>
      <line class="ax" x1="${PAD}" x2="${W - PAD}" y1="${y}" y2="${y}"/>
      ${vals.map((v) => `<circle class="ostrip-dot" cx="${x(v).toFixed(1)}" cy="${y}" r="2.6"/>`).join("")}
      <text class="axl" x="${PAD}" y="${y + 14}">${num(lo)}</text><text class="axl" x="${W - PAD}" y="${y + 14}" text-anchor="end">${num(hi)}</text>
      ${typeof me?.[k] === "number" ? `<circle class="ostrip-me" cx="${x(me[k]).toFixed(1)}" cy="${y}" r="5"/><text class="ostrip-val" x="${Math.min(W - PAD - 14, Math.max(PAD + 14, x(me[k]))).toFixed(1)}" y="${y - 9}" text-anchor="middle">${num(me[k])}</text>` : ""}`;
  }).join("")}</svg>
  <div class="okey"><span><i class="ostrip-key"></i>${esc(c.highlight?.label ?? "Highlighted")}</span><span><i class="ostrip-key other"></i>Each of the other ${rows.length - (me ? 1 : 0)} countries</span></div>`;
}

function statHtml(l, rows) {
  const c = l.chart;
  return `<div class="ostats">${rows.map((r) => `<div class="ostat">
    ${r.benchmark ? `<span class="ostat-name">${esc(r.benchmark)}</span>` : ""}
    <b>${num(r[c.value])}${c.unit ? `<small>${esc(c.unit)}</small>` : ""}</b>
    <span>${c.caption in r ? `${esc(pretty(c.caption))}: ${num(r[c.caption])}` : esc(c.caption ?? "")}${r.year ? ` · ${r.year}` : ""}</span>
  </div>`).join("")}</div>`;
}

/* ---- cards ---- */
function bodyOf(l, data, pick) {
  if (pick.mode === "table") return tableOf(l, data);
  if (!Array.isArray(data)) return seriesFigure(l, data, pick);
  return l.chart.type === "strip_plot" ? stripFigure(l, data) : barsFigure(l, data, pick);
}
const badges = (l) => ((l.badges ?? []).length ? `<div class="obadges">${l.badges.map((b) => `<span class="obadge">${esc(b)}</span>`).join("")}</div>` : "");

export function figureCard(l, data) {
  docs.set(l.id, { l, data });
  const kind = kindOf(l, data), title = esc(titleOf(l));
  if (!data) return `<div class="otile"><div class="otile-head">${TABLE_ICON}<div><span class="chart-title">${title}</span><small>Data not available</small></div></div></div>`;
  if (kind === "chart") {
    return `<figure class="chart ocard" data-popbox data-id="${esc(l.id)}">
      <figcaption><span class="chart-title">${title}</span><button class="oflip" data-flip title="Switch between the chart and its numbers">Table</button>${POP_BUTTON}</figcaption>
      <div class="ocard-body">${bodyOf(l, data, {})}</div>
      <p class="ocard-about">${esc(l.shows)}</p>${badges(l)}
    </figure>`;
  }
  const rows = flatten(data), size = `${rows.length} row${rows.length === 1 ? "" : "s"} · ${Object.keys(rows[0] ?? {}).length} columns`;
  if (kind === "stat") {
    return `<figure class="chart ocard" data-popbox>
      <figcaption><span class="chart-title">${title}</span>${POP_BUTTON}</figcaption>
      ${statHtml(l, rows)}
      <p class="ocard-about">${esc(l.shows)}</p>${badges(l)}
      <div class="otable-wrap">${tableOf(l, data)}</div>
    </figure>`;
  }
  return `<div class="otile" data-popbox>
    <div class="otile-head">${TABLE_ICON}<div><span class="chart-title">${title}</span><small>${size}</small></div><button class="oflip" data-pop title="Open the table full screen">Open</button></div>
    <p class="ocard-about">${esc(l.shows)}</p>
    <div class="otable-wrap">${badges(l)}${tableOf(l, data)}</div>
  </div>`;
}

/* A card keeps its choices on itself (data-facet, data-product, data-measure, data-mode), so its full-screen copy works too. */
function redraw(card) {
  const doc = docs.get(card.dataset.id);
  if (!doc) return;
  card.querySelector(".ocard-body").innerHTML = bodyOf(doc.l, doc.data, card.dataset);
  syncTimeCharts();
}
const cardOf = (el) => el.closest(".ocard[data-id]");
document.addEventListener("click", (e) => {
  const flip = e.target.closest("[data-flip]"), chip = e.target.closest("button[data-pick]"), card = cardOf(e.target);
  if (!card) return;
  if (flip) { card.dataset.mode = card.dataset.mode === "table" ? "" : "table"; flip.textContent = card.dataset.mode ? "Chart" : "Table"; redraw(card); }
  else if (chip) { card.dataset[chip.dataset.pick] = chip.dataset.value; redraw(card); }
});
document.addEventListener("change", (e) => {
  const select = e.target.closest("select[data-pick]"), card = select && cardOf(select);
  if (card) { card.dataset[select.dataset.pick] = select.value; redraw(card); }
});
