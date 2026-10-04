/**
 * Analysis panel for the plastics layer (layer.plastics): a topic picker over the three parts of the DMJM material
 * (beach surveys and their scenarios, the debris index, the biomagnification model), the controls of the chosen
 * part, and its charts. Charts are drawn by js/ocean/oceanFigures.js.
 */
import { getState, setState, toggleLayer } from "../state.js";
import { loadPlastics, viewOf, surveyFigures, indexFigures, biomagFigures, scaleMax, PLASTIC_RAMP, INDEX_CLASSES, METRICS } from "./plastics.js";
import { figureCard, kindOf } from "../ocean/oceanFigures.js";
import { syncTimeCharts } from "../components/timeChart.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const TOPICS = [["surveys", "Beach debris: surveys and scenarios to 2050"], ["index", "Debris pressure index (illustration)"], ["biomag", "Biomagnification in the food chain (illustration)"]];
const chips = (name, list, current) => `<div class="xchips" role="group">${list.map(([id, label]) => `<button class="xchip ${String(id) === String(current) ? "active" : ""}" data-set="${name}" data-value="${esc(id)}">${esc(label)}</button>`).join("")}</div>`;

function controls(layer, d, v, s) {
  const onMap = s.activeLayers.includes(layer.id), p = d.projection;
  if (v.topic === "surveys") {
    return `<section class="block">
      <h3 class="sec-title">On the map</h3>
      ${onMap ? "" : `<button class="xchip" id="plasticShow">Show on the map</button>`}
      <p class="about">One dot per surveyed beach, coloured by ${esc(METRICS.plastic_items_per_100m.toLowerCase())}. Click a dot for its value.</p>
      <div class="oramp" style="background:${PLASTIC_RAMP}"></div>
      <div class="oramp-scale"><span>0</span><span>items per 100 m</span><span>${scaleMax(d)}</span></div>
      <span class="field-label">Scenario after ${p.years[0]}</span>
      ${chips("scenario", p.scenarios.map((sc) => [sc.id, sc.label]), v.scenario)}
      <p class="caveat">${esc(p.scenarios.find((sc) => sc.id === v.scenario)?.note ?? "")}</p>
      <p class="caveat">The dots change with the year on the timeline: surveys for ${esc(p.baseline.period.replace(" to ", " – "))}, then the chosen scenario to ${p.years.at(-1)}. Before the first survey the dots are empty: nothing was measured.</p>
      <p class="caveat">The survey file is a demo dataset and does not record its sources. The scenarios are a simulation of "what if", not a forecast.</p>
    </section>`;
  }
  if (v.topic === "index") {
    return `<section class="block">
      <h3 class="sec-title">How to read it</h3>
      <p class="about">A relative index of plastic debris pressure for the Indus Delta. It starts at 100 in 2020 and grows by an assumed share every year; the chart shows the three rates side by side.</p>
      <ul class="oclasses">${INDEX_CLASSES.map(([c, label]) => `<li><i style="background:${c}"></i>${esc(label)}</li>`).join("")}</ul>
      <p class="caveat">The classes are bands of increase since 2020 chosen for the illustration, not official limits. No measured data goes into this index, so it is not drawn on the map.</p>
    </section>`;
  }
  return `<section class="block">
    <h3 class="sec-title">Assumptions</h3>
    <span class="field-label">Source grows each year by</span>
    ${chips("growth", [[2, "2 %"], [4, "4 %"], [6, "6 %"]], v.growth)}
    <span class="field-label">From 2027</span>
    ${chips("after", [["continue", "Keeps growing"], ["0", "Levels off"], ["-2", "Falls 2 % a year"]], v.after)}
    <div class="field"><label class="field-label" for="plasticTmf">Magnification per food-chain step: <b id="plasticTmfValue">${v.tmf}×</b></label>
      <input class="orange" id="plasticTmf" type="range" min="0.8" max="3" step="0.1" value="${v.tmf}" /></div>
    <p class="caveat">Above 1 the contaminant builds up at each step; at 1 it stays level; below 1 it thins out. No measured data goes into this model, so it is not drawn on the map.</p>
  </section>`;
}

/** Returns the panel HTML, or null when the data API is not running. */
export async function plasticsPanelHtml(layer, s) {
  const d = await loadPlastics();
  if (!d) return null;
  const v = viewOf(s);
  return `<section class="block">
      <div class="field"><label class="field-label" for="plasticTopic">Topic</label>
        <div class="select"><select id="plasticTopic">${TOPICS.map(([id, label]) => `<option value="${id}" ${id === v.topic ? "selected" : ""}>${esc(label)}</option>`).join("")}</select></div>
      </div>
    </section>
    ${controls(layer, d, v, s)}
    <div id="plasticFigures"></div>`;
}

export async function bindPlasticsPanel(body, layer, scroll = 0) {
  const d = await loadPlastics(), v = viewOf(getState());
  const set = (patch) => setState({ plasticsView: { ...viewOf(getState()), ...patch } });
  body.querySelector("#plasticTopic")?.addEventListener("change", (e) => set({ topic: e.target.value }));
  body.querySelectorAll("[data-set]").forEach((b) => b.addEventListener("click", () => set({ [b.dataset.set]: /^-?[\d.]+$/.test(b.dataset.value) && b.dataset.set !== "after" ? +b.dataset.value : b.dataset.value })));
  body.querySelector("#plasticShow")?.addEventListener("click", () => toggleLayer(layer.id, true));
  const tmf = body.querySelector("#plasticTmf");
  tmf?.addEventListener("input", () => (body.querySelector("#plasticTmfValue").textContent = `${tmf.value}×`));
  tmf?.addEventListener("change", () => set({ tmf: +tmf.value }));

  const box = body.querySelector("#plasticFigures");
  if (!box || !d) return;
  const figures = v.topic === "surveys" ? surveyFigures(d) : v.topic === "index" ? indexFigures() : biomagFigures(v);
  const group = (kind) => figures.map((f) => (kindOf(f.l, f.data) === kind ? figureCard(f.l, f.data) : "")).join("");
  const section = (title, cls, html) => (html ? `<section class="block"><h3 class="sec-title">${title}</h3><div class="${cls}">${html}</div></section>` : "");
  box.innerHTML = section("Key figures", "ocards", group("stat")) + section("Charts", "ocards", group("chart")) + section("Data tables", "otiles", group("table"));
  syncTimeCharts();
  if (scroll) body.scrollTop = scroll;
}
