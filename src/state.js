import { useSyncExternalStore } from "react";
import { LAYERS, TIME_RANGE, PRESENT_YEAR } from "./config/layers.js";

/**
 * Minimal observable store, shared by the React components (useStore) and the map code (getState / subscribe).
 * primaryLayer = the layer whose panel is open (dock icons); activeLayers = layers drawn on the map (toggles).
 * year is the single time cursor that the timeline, the map layers and the charts all follow.
 * Every change makes a new state object, so React can tell that something changed.
 */
let state = {
  year: PRESENT_YEAR,
  yearTo: TIME_RANGE.to, // where the timeline ends for the open layer: 2050, or later when its data goes further (setYearTo)
  playing: false,
  speed: 1, // timeline playback: 1 or 2 (twice as fast); the showcase plays at 3 or 4
  loop: false, // start over when playback reaches the last year
  ssp: "ssp245", // emissions scenario chosen with the SSP keys in the panel (src/panels/SspKeys.jsx); setSsp keeps the next two and oceanScenario in step
  scenario: "normal", // which projection scenario the mangrove forecast years use (kept in step by setSsp)
  oceanView: {}, // per ocean-package layer id: { step, variable } chosen in its panel (src/panels/OceanPanel.jsx)
  amibView: {}, // per portal layer id: { hazard, variant, measure, raw, product, subgroup } chosen in its package section (src/panels/AmibPanel.jsx)
  oceanScenario: "ssp245", // emissions scenario for the ocean outlook layers
  plasticsView: {}, // { topic, growth, tmf, after } chosen in the plastics panel (src/panels/PlasticsPanel.jsx)
  primaryLayer: "sealevel",
  activeLayers: [],
  hiddenLayers: [], // layer ids left out of the dock with the terminal's hide command (setHiddenLayers)
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

/** Show or hide a layer on the map. Only one is shown at a time: showing one takes the others off. */
export function toggleLayer(id, on) {
  const has = state.activeLayers.includes(id);
  if (on === has && (!on || state.activeLayers.length === 1)) return;
  setState({ activeLayers: on ? [id] : state.activeLayers.filter((x) => x !== id) });
}

/**
 * A click on a layer's tile in the dock (there are no separate map switches). One layer is on the map at a time:
 * another tile opens its layer, puts it on the map in place of the previous one and flies to it; the layer that is
 * on, clicked again, comes off. Returns true when the map should fly to the layer.
 */
export function pickLayer(id) {
  if (state.activeLayers.includes(id) && state.primaryLayer === id) { toggleLayer(id, false); return false; }
  if (state.primaryLayer !== id) selectLayer(id);
  const flies = !state.activeLayers.includes(id);
  toggleLayer(id, true);
  return flies;
}

/**
 * Leave layers out of the dock (the terminal's hide / show; the list is kept on the server, server/terminal.mjs).
 * A hidden layer that is on the map comes off; when its panel is open, the first layer still shown opens instead.
 */
export function setHiddenLayers(ids) {
  const patch = { hiddenLayers: ids, activeLayers: state.activeLayers.filter((id) => !ids.includes(id)) };
  const next = ids.includes(state.primaryLayer) && LAYERS.find((l) => !ids.includes(l.id));
  if (next) Object.assign(patch, { primaryLayer: next.id, chartIndex: 0 });
  setState(patch);
}

/** Take every layer off the map (Earth view and Reset view do this). */
export const clearLayers = () => setState({ activeLayers: [] });

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function setYear(year) {
  setState({ year: clamp(Math.round(year), TIME_RANGE.from, state.yearTo) });
}

/** Where the timeline ends (TIME_RANGE.to up to TIME_RANGE.max); a year past the new end comes back to it. */
export function setYearTo(to) {
  to = clamp(Math.round(to), TIME_RANGE.to, TIME_RANGE.max);
  if (to !== state.yearTo) setState({ yearTo: to, year: Math.min(state.year, to) });
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
