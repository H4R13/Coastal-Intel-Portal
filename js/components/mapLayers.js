import { BASEMAPS, OVERLAYS } from "../config/basemaps.js";
import { getState, subscribe, setState } from "../state.js";

const LAYERS_ICON = '<path d="m12 3 9 5-9 5-9-5Z"/><path d="m3 13 9 5 9-5"/><path d="m3 17.500 9 5 9-5" opacity=".55"/>';
const ico = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;

/** "Map layers" picker: basemap gallery + live ocean overlays. */
export function MapLayers(mapArea) {
  const tools = mapArea.querySelector(".map-tools");
  const sep = document.createElement("span");
  sep.className = "tool-sep";
  const btn = document.createElement("button");
  btn.className = "tool";
  btn.dataset.tip = "Map layers";
  btn.setAttribute("aria-label", "Map layers");
  btn.innerHTML = ico(LAYERS_ICON);
  tools.append(sep, btn);

  const pop = document.createElement("div");
  pop.className = "popover layers-pop";
  pop.hidden = true;
  pop.innerHTML = `
    <h3 class="side-title">Basemap</h3>
    <div class="bm-grid">
      ${BASEMAPS.map((b) => `
        <button class="bm" data-id="${b.id}" aria-pressed="false">
          <span class="bm-thumb ${b.thumb ? "" : "bm-dark"}" ${b.thumb ? `style="background-image:url('${b.thumb}')"` : ""}></span>
          <span class="bm-name">${b.label}</span>
          <span class="bm-sub">${b.sub}</span>
        </button>`).join("")}
    </div>
    <h3 class="side-title ov-title">Ocean overlays</h3>
    ${OVERLAYS.map((o) => `
      <div class="ov" data-id="${o.id}">
        <label class="ov-row">
          <input type="checkbox" />
          <span class="switch"></span>
          <span class="ov-text"><b>${o.label}</b><small>${o.sub}</small></span>
        </label>
        <label class="ov-opacity"><span>Opacity</span><input type="range" min="0.15" max="1" step="0.05" value="${o.opacity}" /></label>
      </div>`).join("")}
    <p class="bm-note">Free, open sources. Credits appear under the ⓘ on the map.</p>`;
  mapArea.appendChild(pop);

  // popovers close each other
  const closeOthers = () => document.dispatchEvent(new CustomEvent("popover-open", { detail: pop }));
  document.addEventListener("popover-open", (e) => { if (e.detail !== pop) pop.hidden = true; });
  btn.addEventListener("click", (e) => { e.stopPropagation(); pop.hidden = !pop.hidden; if (!pop.hidden) closeOthers(); });
  document.addEventListener("click", (e) => { if (!pop.contains(e.target)) pop.hidden = true; });

  const cards = [...pop.querySelectorAll(".bm")];
  cards.forEach((c) => c.addEventListener("click", () => setState({ basemap: c.dataset.id })));

  pop.querySelectorAll(".ov").forEach((row) => {
    const id = row.dataset.id, check = row.querySelector("input[type=checkbox]"), range = row.querySelector("input[type=range]");
    const update = (patch) => setState({ overlays: { ...getState().overlays, [id]: { ...getState().overlays[id], ...patch } } });
    check.addEventListener("change", () => update({ on: check.checked }));
    range.addEventListener("input", () => update({ opacity: +range.value }));
  });

  function render(s) {
    cards.forEach((c) => {
      const on = c.dataset.id === s.basemap;
      c.classList.toggle("active", on);
      c.setAttribute("aria-pressed", String(on));
    });
    pop.querySelectorAll(".ov").forEach((row) => {
      const st = s.overlays[row.dataset.id];
      row.querySelector("input[type=checkbox]").checked = !!st?.on;
      row.classList.toggle("on", !!st?.on);
    });
  }
  subscribe(render);
  render(getState());
}
