import { MODES, PRESENT_YEAR } from "./config/layers.js";

/**
 * Minimal observable store.
 * primaryLayer = the layer whose panel is open (dock icons); activeLayers = layers drawn on the map (toggles).
 * year is the single time cursor that the timeline, the map layers and the charts all follow.
 */
const state = {
  mode: "normal",
  year: PRESENT_YEAR,
  playing: false,
  speed: 1, // timeline playback: 1 or 2 (twice as fast)
  loop: false, // start over when playback reaches the last year
  scenario: "normal", // which projection scenario forecast years use, for layers that have scenarios
  oceanView: {}, // per ocean-package layer id: { step, variable } chosen in its panel (js/ocean/oceanPanel.js)
  amibView: {}, // per portal layer id: { product, subgroup, layer } chosen in its intrusion/salinity section (js/amib)
  oceanScenario: "ssp245", // emissions scenario for the ocean outlook layers
  plasticsView: {}, // { topic, scenario, growth, tmf, after } chosen in the plastics panel (js/plastics)
  primaryLayer: "sealevel",
  activeLayers: [],
  chartIndex: 0,
  showPlaces: true,
  showCoords: true,
  basemap: "satellite",
  overlays: { sst: { on: false, opacity: 0.75 } },
  floodId: null, // selected sea-level exposure set (data/sealevel/<id>), or null for none
  terrain: true,
};

const listeners = new Set();

export const getState = () => state;
export const subscribe = (fn) => (listeners.add(fn), () => listeners.delete(fn));

export function setState(patch) {
  Object.assign(state, patch);
  listeners.forEach((fn) => fn(state));
}

/** Open a layer's analysis panel. Does not change what is drawn on the map. */
export function selectLayer(id) {
  setState({ primaryLayer: id, chartIndex: 0 });
}

/** Show or hide a layer on the map. */
export function toggleLayer(id, on) {
  const has = state.activeLayers.includes(id);
  if (on === has) return;
  setState({ activeLayers: on ? [...state.activeLayers, id] : state.activeLayers.filter((x) => x !== id) });
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const modeRange = (id = state.mode) => MODES.find((m) => m.id === id) ?? MODES[0];

/** Switch the time range; the year cursor is pulled inside the new range. */
export function setMode(id) {
  const m = modeRange(id);
  setState({ mode: m.id, playing: false, year: clamp(state.year, m.from, m.to) });
}

export function setYear(year) {
  const m = modeRange();
  setState({ year: clamp(Math.round(year), m.from, m.to) });
}
