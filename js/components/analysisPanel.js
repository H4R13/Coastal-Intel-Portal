import { LAYERS } from "../config/layers.js";
import { getState, subscribe, setState } from "../state.js";
import { renderChart, loadChartData } from "./chart.js";
import { ModeTabs } from "./modeTabs.js";

const dash = (v, unit) => (v == null ? "—" : `${v}${unit ? ` <small>${unit}</small>` : ""}`);
const na = (v, fallback) => v ?? fallback;

function indicators(layer, title) {
  return `<section class="block">
    <h3 class="sec-title">${title}</h3>
    <dl class="indicators">
      ${layer.indicators.map((i) => `<div class="ind"><dt>${i.label}</dt><dd class="${i.value == null ? "empty" : ""}">${dash(i.value, i.unit)}</dd></div>`).join("")}
    </dl>
  </section>`;
}

function about(layer) {
  const m = layer.meta;
  const row = (label, v, fallback) => `<div><dt>${label}</dt><dd class="${v ? "" : "muted"}">${na(v, fallback)}</dd></div>`;
  return `<section class="block">
    <h3 class="sec-title">What this layer shows</h3>
    <p class="about">${layer.about}</p>
    <h3 class="sec-title sub">Data availability</h3>
    <ul class="avail">${layer.availability.map((x) => `<li><span>${x}</span><em>Awaiting dataset</em></li>`).join("")}</ul>
    <dl class="meta">
      ${row("Data source", m.source, "Not connected")}
      ${row("Temporal coverage", m.temporal, "Not available")}
      ${row("Spatial coverage", m.spatial, "Not available")}
      ${row("Last updated", m.updated, "Not available")}
    </dl>
  </section>`;
}

/* Sea-level exposure sets built by tools/build-flood.mjs (data/sealevel/index.json); empty if none have been built. */
let floodLevels = [];
const floodReady = fetch("data/sealevel/index.json").then((r) => (r.ok ? r.json() : null)).then((j) => { floodLevels = j?.levels ?? []; }).catch(() => {});

function exposure(selected) {
  if (!floodLevels.length) return "";
  const chip = (id, label, extra = "") => `<button class="xchip ${selected === id ? "active" : ""}" data-flood="${id ?? ""}">${label}${extra}</button>`;
  const sel = floodLevels.find((l) => l.id === selected);
  return `<section class="block exposure">
    <h3 class="sec-title">Terrain exposure</h3>
    <p class="about">Which land lies below a given water level and is open to the sea, from the 12.5 m terrain model (heights above mean sea level).</p>
    <div class="xchips">${chip(null, "Off")}${floodLevels.map((l) => chip(l.id, `+${l.level_m} m`)).join("")}</div>
    ${sel ? `<dl class="indicators one"><div class="ind"><dt>Land exposed</dt><dd>${sel.approxFloodedAreaKm2.toLocaleString()} <small>km²</small></dd></div></dl>` : ""}
    <p class="caveat">Terrain exposure, not a projection: no tides, defences, subsidence or erosion. Vertical error of the model in the flat delta is about 1–3 m.</p>
  </section>`;
}

function outlook(layer) {
  return `<section class="block outlook">
    <div class="field">
      <label class="field-label" for="scenario">Scenario</label>
      <div class="select"><select id="scenario" disabled><option>Select scenario</option></select></div>
      <small class="muted">Scenarios will be listed once projection data is connected.</small>
    </div>
    <div class="field"><span class="field-label">Selected layer</span><strong class="sel-layer" style="--layer:${layer.color}">${layer.title}</strong></div>
    <dl class="indicators one">
      <div class="ind"><dt>Projected change</dt><dd class="empty">—</dd></div>
      <div class="ind"><dt>Confidence</dt><dd class="empty">—</dd></div>
      <div class="ind"><dt>Source</dt><dd class="empty">—</dd></div>
    </dl>
  </section>`;
}

export function AnalysisPanel(root) {
  root.innerHTML = `
    <div class="panel-head">
      <nav class="modes" id="modes"></nav>
    </div>
    <div class="panel-scroll" id="panelBody"></div>`;
  ModeTabs(root.querySelector("#modes"));
  const body = root.querySelector("#panelBody");
  let lastKey = null, token = 0;

  async function render(s) {
    const layer = LAYERS.find((l) => l.id === s.primaryLayer);
    const key = `${layer.id}|${s.mode}|${s.chartIndex}|${s.activeLayers.join()}|${s.floodId}`;
    if (key === lastKey) return;
    lastKey = key;
    const my = ++token;
    await floodReady;

    const chartCfg = layer.charts[s.chartIndex] ?? layer.charts[0];
    const data = await loadChartData(chartCfg);
    if (my !== token) return;

    const extra = s.activeLayers.length
      ? `<div class="overlay-note"><span class="field-label">On the map</span>${s.activeLayers.map((id) => { const l = LAYERS.find((x) => x.id === id); return `<span class="chip" style="--layer:${l.color}">${l.title}</span>`; }).join("")}</div>`
      : "";

    body.innerHTML = `<div class="fade" style="--layer:${layer.color}">
      <header class="layer-head">
        <span class="layer-head-icon">${layer.icon}</span>
        <div><h2>${layer.title}</h2><p>${layer.lead}</p></div>
      </header>
      ${extra}
      ${s.mode === "forecast" ? outlook(layer) : ""}
      ${layer.id === "sealevel" ? exposure(s.floodId) : ""}
      <section class="block">
        <div class="chart-tabs" role="tablist">
          ${layer.charts.map((c, i) => `<button role="tab" class="ctab ${i === s.chartIndex ? "active" : ""}" data-i="${i}" aria-selected="${i === s.chartIndex}">${c.title}</button>`).join("")}
        </div>
        ${renderChart(chartCfg, data)}
        ${!data ? `<div class="empty-note"><b>No data connected yet</b><p>This visualization will display ${chartCfg.placeholder.replace(/ will appear here$/, "").toLowerCase()} once the dataset is connected.</p><span class="src"><i>Data source</i>Pending integration</span></div>` : ""}
      </section>
      ${indicators(layer, s.mode === "forecast" ? "Forecast indicators" : "Key indicators")}
      ${about(layer)}
    </div>`;
    body.scrollTop = 0;
    body.querySelectorAll(".ctab").forEach((b) => b.addEventListener("click", () => setState({ chartIndex: +b.dataset.i })));
    body.querySelectorAll(".xchip").forEach((b) => b.addEventListener("click", () => setState({ floodId: b.dataset.flood || null })));
  }

  subscribe(render);
  render(getState());
}
