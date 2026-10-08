import { useSyncExternalStore } from "react";
import { MODES, PRESENT_YEAR } from "./config/layers.js";

/**
 * Minimal observable store, shared by the React components (useStore) and the map code (getState / subscribe).
 * primaryLayer = the layer whose panel is open (dock icons); activeLayers = layers drawn on the map (toggles).
 * year is the single time cursor that the timeline, the map layers and the charts all follow.
 * Every change makes a new state object, so React can tell that something changed.
 */
let state = {
  mode: "normal",
  year: PRESENT_YEAR,
  playing: false,
  speed: 1, // timeline playback: 1 or 2 (twice as fast)
  loop: false, // start over when playback reaches the last year
  ssp: "ssp245", // emissions scenario chosen with the SSP keys in the panel (src/panels/SspKeys.jsx); setSsp keeps the next two and oceanScenario in step
  scenario: "normal", // which projection scenario forecast years use, for layers that have scenarios
  oceanView: {}, // per ocean-package layer id: { step, variable } chosen in its panel (src/panels/OceanPanel.jsx)
  amibView: {}, // per portal layer id: { hazard, variant, measure, raw, product, subgroup } chosen in its package section (src/panels/AmibPanel.jsx)
  oceanScenario: "ssp245", // emissions scenario for the ocean outlook layers
  plasticsView: {}, // { topic, growth, tmf, after } chosen in the plastics panel (src/panels/PlasticsPanel.jsx)
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
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn(state));
}

/** The whole state, or one part of it: const year = useStore((s) => s.year). The component redraws when that part changes. */
export const useStore = (pick = (s) => s) => useSyncExternalStore(subscribe, () => pick(state));

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

/** The team's mangrove scenarios are labelled by the emissions path they follow ("Good (SSP1-2.6)" ...). */
export const SSP_SCENARIO = { ssp126: "good", ssp245: "normal", ssp585: "worst" };

/** Choose the emissions scenario once for every layer: package maps, mangrove projections and ocean outlook. */
export function setSsp(id) {
  if (!SSP_SCENARIO[id]) return;
  setState({ ssp: id, scenario: SSP_SCENARIO[id], oceanScenario: id });
}

/** Bring the map to a layer's area (src/components/MapView.jsx listens). */
export const focusLayer = (id) => window.dispatchEvent(new CustomEvent("layerfocus", { detail: id }));
