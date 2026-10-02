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
