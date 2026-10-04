/**
 * Analysis panel for layers backed by the ocean package (layer.ocean = { steps }): a topic picker, the map layers of
 * that topic with their legend, badges and notes, and the topic's charts and tables.
 * Used by the Ocean layer (pH, warming, oxygen, exposure, outlook) and by Fisheries (catch, shellfish, national index).
 */
import { getState, setState, toggleLayer } from "../state.js";
import { loadCatalog, loadDoc, mapVariables, resolveLayer, panelLayers, variableOf, SCENARIOS } from "./oceanData.js";
import { gradientCss, CLASS_COLORS } from "./colormaps.js";
import { syncTimeCharts, FIRST_YEAR } from "../components/timeChart.js";
import { figureCard, kindOf, num } from "./oceanFigures.js";
import { NATIONAL, NATIONAL_RAMP, forecastFigure } from "./national.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const badges = (l) => `<div class="obadges">${(l.badges ?? []).map((b) => `<span class="obadge">${esc(b)}</span>`).join("")}</div>`;
export const viewOf = (layer, s) => s.oceanView[layer.id] ?? { step: layer.ocean.steps[0], variable: null };

function legend(l) {
  if (l.classes) {
    return `<ul class="oclasses">${Object.entries(l.classes).map(([, label], i) => `<li><i style="background:${CLASS_COLORS[i % CLASS_COLORS.length]}"></i>${esc(label)}</li>`).join("")}</ul>`;
  }
  return `<div class="oramp" style="background:${gradientCss(l.colormap)}"></div>
    <div class="oramp-scale"><span>${num(l.vmin)}</span><span>${esc(l.units ?? "")}</span><span>${num(l.vmax)}</span></div>`;
}

/** Topics that are one national number: the sea zone is tinted for that number instead of drawing a grid. */
function nationalSection(layer, view, s) {
  const def = NATIONAL[view.step];
  if (!def || layer.mapLayer.type !== "national") return "";
  return `<section class="block">
    <h3 class="sec-title">On the map</h3>
    ${s.activeLayers.includes(layer.id) ? "" : `<button class="xchip" id="oceanShow">Show on the map</button>`}
    <p class="about">${esc(def.label)}. This is one number for the whole of Pakistan, so the map shows it in a balloon over the sea; the colour of the number follows this scale.</p>
    <div class="oramp" style="background:${NATIONAL_RAMP}"></div>
    <div class="oramp-scale"><span>0</span><span>${esc(def.unit)}</span><span>${def.max}</span></div>
    <p class="caveat">${def.period ? `The colour changes with the year on the timeline. Measured data covers ${def.period}. After that the colour follows the trend forecast to 2030 (chart below) and the balloon says so; beyond 2030 it stays at the 2030 forecast.` : "One fixed value: it does not change with the timeline."}</p>
    <p class="caveat">A national figure from reported catch: where the balloon sits says nothing about where in the sea anything happens.</p>
  </section>`;
}

function mapSection(layer, catalog, view, s) {
  const vars = mapVariables(catalog, view.step);
  if (!vars.length) return nationalSection(layer, view, s);
  const L = resolveLayer(catalog, view, s.oceanScenario);
  const current = L && vars.find((v) => v.id === variableOf(L));
  const opt = (v) => `<option value="${esc(v.id)}" ${v === current ? "selected" : ""}>${esc(v.title)}</option>`;
  const groups = [["Year by year (follows the timeline)", vars.filter((v) => v.yearly)], ["Main results", vars.filter((v) => v.primary && !v.yearly)], ["Other versions", vars.filter((v) => !v.primary && !v.yearly)]].filter(([, list]) => list.length);
  const onMap = s.activeLayers.includes(layer.id);
  return `<section class="block">
    <h3 class="sec-title">Map layer</h3>
    <div class="field"><div class="select"><select id="oceanVar" aria-label="Map layer">
      ${groups.length > 1 ? groups.map(([label, list]) => `<optgroup label="${label}">${list.map(opt).join("")}</optgroup>`).join("") : vars.map(opt).join("")}
    </select></div></div>
    ${current?.scenarios ? `<div class="xchips" role="group" aria-label="Emissions scenario">${SCENARIOS.map((sc) => `<button class="xchip ${sc.id === s.oceanScenario ? "active" : ""}" data-scenario="${sc.id}">${sc.label}</button>`).join("")}</div>` : ""}
    ${onMap ? "" : `<button class="xchip" id="oceanShow">Show on the map</button>`}
    ${L ? `${badges(L)}
      <p class="about">${esc(L.shows)}</p>
      ${legend(L)}
      ${L.overlay ? `<p class="caveat">${esc(L.overlay.legend)}. Test: ${esc(L.overlay.test)}.</p>` : ""}
      <p class="caveat">${L.type === "raster_series"
        ? `Changes with the year on the timeline. Data covers ${Math.max(FIRST_YEAR, L.years[0])}–${L.years.at(-1)}; later years show ${L.years.at(-1)}.`
        : `One fixed map${L.period ? ` for ${esc(L.period)}` : ""}: it does not change with the timeline.`}</p>
      <p class="caveat">Shown inside Pakistan's Exclusive Economic Zone only.${L.classes ? "" : " Smoothed between grid points for display; the data itself is on a 25 km or coarser grid."} Where the product stops short of the shore, the nearest value is carried in to the coast; narrow creeks are left out.</p>
      <dl class="meta ometa">
        ${L.period ? `<div><dt>Period</dt><dd>${esc(L.period)}</dd></div>` : ""}
        ${L.product ? `<div><dt>Source product</dt><dd>${esc(L.product)}</dd></div>` : ""}
        <div><dt>Method</dt><dd>${esc(L.justification)}</dd></div>
      </dl>
      ${L.status ? `<p class="caveat">${esc(L.status)}</p>` : ""}` : ""}
  </section>`;
}

/* ---- charts and tables: filled in by bindOceanPanel once the topic's data has loaded ---- */
const dataSection = (catalog, step) => (panelLayers(catalog, step).length ? `<div id="oceanFigures"><section class="block"><p class="caveat">Loading charts…</p></section></div>` : "");

/** Returns the panel HTML for a layer with layer.ocean, or null when the data API is not running. */
export async function oceanPanelHtml(layer, s) {
  const catalog = await loadCatalog();
  if (!catalog) return null;
  const view = viewOf(layer, s);
  return `<section class="block">
      <div class="field"><label class="field-label" for="oceanStep">Topic</label>
        <div class="select"><select id="oceanStep">${layer.ocean.steps.map((st) => `<option value="${st}" ${st === view.step ? "selected" : ""}>${esc(catalog.steps[st] ?? `Step ${st}`)}</option>`).join("")}</select></div>
      </div>
    </section>
    ${mapSection(layer, catalog, view, s)}
    ${dataSection(catalog, view.step)}`;
}

/** Wire the controls after the HTML is in the page, then load and draw the topic's charts and tables. `scroll` puts the reader back in place once they are in. */
export async function bindOceanPanel(body, layer, scroll = 0) {
  const catalog = await loadCatalog();
  const setView = (patch) => setState({ oceanView: { ...getState().oceanView, [layer.id]: { ...viewOf(layer, getState()), ...patch } } });
  body.querySelector("#oceanStep")?.addEventListener("change", (e) => setView({ step: +e.target.value, variable: null }));
  body.querySelector("#oceanVar")?.addEventListener("change", (e) => setView({ variable: e.target.value }));
  body.querySelectorAll("[data-scenario]").forEach((b) => b.addEventListener("click", () => setState({ oceanScenario: b.dataset.scenario })));
  body.querySelector("#oceanShow")?.addEventListener("click", () => toggleLayer(layer.id, true));

  const box = body.querySelector("#oceanFigures");
  if (!box) return;
  const items = panelLayers(catalog, viewOf(layer, getState()).step);
  const [fc, ...data] = await Promise.all([layer.mapLayer.type === "national" ? forecastFigure(viewOf(layer, getState()).step) : null, ...items.map((l) => loadDoc(`data/${l.id}`))]);
  if (!box.isConnected) return; // the panel was redrawn while the data loaded
  const group = (kind) => items.map((l, i) => (kindOf(l, data[i]) === kind ? figureCard(l, data[i]) : "")).join("");
  const section = (title, cls, html) => (html ? `<section class="block"><h3 class="sec-title">${title}</h3><div class="${cls}">${html}</div></section>` : "");
  box.innerHTML = section("Key figures", "ocards", group("stat")) + section("Charts", "ocards", (fc ? figureCard(fc.l, fc.data) : "") + group("chart")) + section("Data tables", "otiles", group("table"));
  syncTimeCharts();
  if (scroll) body.scrollTop = scroll;
}
