/**
 * Panel section for layers backed by the saltwater intrusion / salinity package (layer.amib, see amibData.js):
 * pick a topic, a group and a map layer, read its legend and notes, and see the topic's year-by-year charts.
 * Charts plot every scenario of an indicator together, so the low, medium and high emissions lines can be compared.
 */
import { getState, setState, toggleLayer } from "../state.js";
import { loadAmibCatalog, loadAmibDoc, resolveView, scenarioName, hiddenStops } from "./amibData.js";
import { timeChart, syncTimeCharts, POP_BUTTON, FIRST_YEAR } from "../components/timeChart.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const viewOf = (layer, s) => s.amibView[layer.id] ?? {};
const options = (list, value, label = (x) => x, id = (x) => x) => list.map((x) => `<option value="${esc(id(x))}" ${id(x) === value ? "selected" : ""}>${esc(label(x))}</option>`).join("");

function legend(l, layer) {
  const hidden = hiddenStops(layer, l), stops = (l.legend ?? []).filter((c) => !hidden.includes(c));
  if (!stops.length) return "";
  if (l.kind === "categorical") return `<ul class="oclasses">${stops.map((c) => `<li><i style="background:${esc(c.color)}"></i>${esc(c.label ?? l.classes?.[c.value] ?? c.value)}</li>`).join("")}</ul>`;
  return `<div class="oramp" style="background:linear-gradient(to right, ${stops.map((c) => esc(c.color)).join(", ")})"></div>
    <div class="oramp-scale"><span>${esc(stops[0].value)}</span><span>${esc(l.units ?? "")}</span><span>${esc(stops.at(-1).value)}</span></div>`;
}

function mapSection(layer, catalog, v, s) {
  const L = v.current, onMap = s.activeLayers.includes(layer.id);
  return `<section class="block">
    <h3 class="sec-title">${layer.amib.optional ? "Raster layers" : "Map layer"}</h3>
    ${v.products.length > 1 ? `<div class="field"><label class="field-label" for="amibProduct">Topic</label><div class="select"><select id="amibProduct">${options(v.products, v.product, (p) => p.title, (p) => p.id)}</select></div></div>` : ""}
    <div class="field"><label class="field-label" for="amibGroup">Group</label><div class="select"><select id="amibGroup">${options(v.subgroups, v.subgroup)}</select></div></div>
    <div class="field"><label class="field-label" for="amibLayer">Layer</label><div class="select"><select id="amibLayer">
      ${layer.amib.optional || layer.amib.mapOff ? `<option value="" ${L ? "" : "selected"}>None</option>` : ""}${options(v.layers, L?.id, (l) => l.name, (l) => l.id)}
    </select></div></div>
    ${L && !onMap ? `<button class="xchip" id="amibShow">Show on the map</button>` : ""}
    ${L ? `<div class="obadges"><span class="obadge" title="${esc(catalog.labels[L.label] ?? "")}">${esc(L.label ?? "")}</span>${L.scenario ? `<span class="obadge">${esc(scenarioName(L.scenario))}</span>` : ""}</div>
      <p class="about">${esc(L.what ?? L.name)}</p>
      ${legend(L, layer)}
      ${hiddenStops(layer, L).length ? `<p class="caveat">Not drawn on the map: ${hiddenStops(layer, L).map((c) => esc(c.label ?? L.classes?.[c.value])).join(", ")}.</p>` : ""}
      ${layer.amib.clearBackground && L.kind !== "categorical" ? `<p class="caveat">The most common value fills most of the map as one flat colour, so it is left clear; colour marks where the value differs.</p>` : ""}
      <p class="caveat">${L.steps ? `Changes with the year on the timeline. Covers ${Math.max(FIRST_YEAR, L.steps[0].t)}–${L.steps.at(-1).t}.` : `One fixed map${L.year ? ` for ${L.year}` : ""}: it does not change with the timeline.`}</p>
      ${catalog.labels[L.label] ? `<p class="caveat">${esc(L.label)}: ${esc(catalog.labels[L.label])}.</p>` : ""}
      ${L.note ? `<p class="caveat">${esc(L.note)}</p>` : ""}` : ""}
  </section>`;
}

/** Returns the section HTML for a layer with layer.amib, or null when the data API is not running. */
export async function amibPanelHtml(layer, s) {
  const catalog = await loadAmibCatalog();
  if (!catalog) return null;
  const v = resolveView(catalog, layer, viewOf(layer, s));
  if (!v.products.length) return null;
  const indicators = await loadAmibDoc(`series/${v.product}`);
  const names = Object.keys(indicators ?? {});
  return `${mapSection(layer, catalog, v, s)}
    ${names.length ? `<section class="block">
      <h3 class="sec-title">Charts by year</h3>
      ${names.map((name, i) => `<details class="oitem amib-chart" data-product="${esc(v.product)}" data-name="${esc(name)}" ${i === 0 ? "open" : ""}><summary>${esc(name)}</summary><div class="oitem-body"></div></details>`).join("")}
    </section>` : ""}`;
}

/** One indicator: a chart of every scenario for one zone, with chips to switch zone. */
function indicatorHtml(name, ind, zone) {
  const zones = [...new Set(ind.series.map((x) => x.zone))], z = zones.includes(zone) ? zone : zones[0];
  const groups = ind.series.filter((x) => x.zone === z)
    .map((x) => ({ name: scenarioName(x.scenario), points: x.year.map((y, i) => ({ x: y, y: x.p50[i] })).filter((p) => p.y != null) }))
    .filter((g) => g.points.length);
  if (!groups.length) return `<p class="caveat">No values.</p>`;
  return `${zones.length > 1 ? `<div class="xchips">${zones.map((x) => `<button class="xchip ${x === z ? "active" : ""}" data-zone="${esc(x)}">${esc(String(x).replace(/_/g, " "))}</button>`).join("")}</div>` : ""}
    <figure class="chart" data-popbox><figcaption><span class="chart-title">${esc(name)}</span>${POP_BUTTON}</figcaption>${timeChart(groups, { yLabel: name, unit: ind.unit })}</figure>`;
}

export function bindAmibPanel(body, layer) {
  const setView = (patch) => setState({ amibView: { ...getState().amibView, [layer.id]: { ...viewOf(layer, getState()), ...patch } } });
  body.querySelector("#amibProduct")?.addEventListener("change", (e) => setView({ product: e.target.value, subgroup: undefined, layer: undefined }));
  body.querySelector("#amibGroup")?.addEventListener("change", (e) => setView({ subgroup: e.target.value, layer: undefined }));
  body.querySelector("#amibLayer")?.addEventListener("change", (e) => { setView({ layer: e.target.value || null }); if (e.target.value) toggleLayer(layer.id, true); });
  body.querySelector("#amibShow")?.addEventListener("click", () => toggleLayer(layer.id, true));

  async function fill(details, zone) {
    const ind = (await loadAmibDoc(`series/${details.dataset.product}`))?.[details.dataset.name], box = details.querySelector(".oitem-body");
    box.innerHTML = ind ? indicatorHtml(details.dataset.name, ind, zone) : `<p class="caveat">Data not available.</p>`;
    box.querySelectorAll("[data-zone]").forEach((b) => b.addEventListener("click", () => fill(details, b.dataset.zone)));
    syncTimeCharts();
  }
  body.querySelectorAll(".amib-chart").forEach((d) => {
    if (d.open) fill(d);
    d.addEventListener("toggle", () => { if (d.open && !d.querySelector(".oitem-body").innerHTML) fill(d); });
  });
}
