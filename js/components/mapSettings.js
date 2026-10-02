import { getState, setState } from "../state.js";

const ico = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const SETTINGS = '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>';
const INFO = '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>';

/** Map settings + About, as extra buttons on the map's control stack. */
export function MapSettings(mapArea) {
  const tools = mapArea.querySelector(".map-tools");
  const mk = (tip, path, id) => {
    const b = document.createElement("button");
    b.className = "tool";
    b.id = id;
    b.dataset.tip = tip;
    b.setAttribute("aria-label", tip);
    b.innerHTML = ico(path);
    return b;
  };
  const btnSettings = mk("Map settings", SETTINGS, "btnSettings");
  const btnInfo = mk("About this portal", INFO, "btnInfo");
  tools.append(btnSettings, btnInfo);

  const pop = document.createElement("div");
  pop.className = "popover";
  pop.hidden = true;
  pop.innerHTML = `
    <h3 class="side-title">Map settings</h3>
    <label class="row"><input type="checkbox" id="setTerrain" checked /> 3D terrain</label>
    <label class="row"><input type="checkbox" id="setPlaces" checked /> Reference places &amp; regions</label>
    <label class="row"><input type="checkbox" id="setCoords" checked /> Cursor coordinates</label>`;
  mapArea.appendChild(pop);

  const s = getState();
  pop.querySelector("#setTerrain").checked = s.terrain;
  pop.querySelector("#setPlaces").checked = s.showPlaces;
  pop.querySelector("#setCoords").checked = s.showCoords;

  pop.querySelector("#setTerrain").addEventListener("change", (e) => setState({ terrain: e.target.checked }));
  pop.querySelector("#setPlaces").addEventListener("change", (e) => setState({ showPlaces: e.target.checked }));
  pop.querySelector("#setCoords").addEventListener("change", (e) => setState({ showCoords: e.target.checked }));

  document.addEventListener("popover-open", (e) => { if (e.detail !== pop) pop.hidden = true; });
  btnSettings.addEventListener("click", (e) => {
    e.stopPropagation();
    pop.hidden = !pop.hidden;
    if (!pop.hidden) document.dispatchEvent(new CustomEvent("popover-open", { detail: pop }));
  });
  document.addEventListener("click", (e) => { if (!pop.contains(e.target)) pop.hidden = true; });
  btnInfo.addEventListener("click", () => document.getElementById("aboutDialog").showModal());
}
