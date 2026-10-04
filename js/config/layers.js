/**
 * Layer registry — the single source of truth for every environmental layer.
 *
 * To connect real data later, fill in:
 *   - mapLayer.endpoint   → GeoJSON / tile URL rendered by js/map/renderers.js
 *   - charts[].endpoint   → JSON consumed by js/components/chart.js
 *   - indicators[].value  → real values (null renders "—")
 *   - dataSource          → { name, url, citation, coverage }
 * No component needs to change.
 * focus = [[west, south], [east, north]]: where the map goes when the layer's dock icon is clicked.
 */
import { NATIONAL_RAMP } from "../ocean/national.js";

const icon = (body) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const indicators = (labels) => labels.map(([id, label, unit]) => ({ id, label, unit: unit ?? null, value: null }));

export const LAYERS = [
  {
    id: "sealevel",
    title: "Sea Level Rise",
    descriptor: "Historical change & projections",
    color: "#3fb6ae",
    lead: "Observed coastal change and future projections",
    availability: ["Historical observations","Projection data to 2050"],
    icon: icon('<path d="M3 9c2.2 0 2.2-1.6 4.5-1.6S9.8 9 12 9s2.2-1.6 4.5-1.6S18.8 9 21 9"/><path d="M3 14c2.2 0 2.2-1.6 4.5-1.6S9.8 14 12 14s2.2-1.6 4.5-1.6S18.8 14 21 14"/><path d="M12 20v-4m0 0-2 2m2-2 2 2"/>'),
    about: "Sea-level rise represents changes in mean sea surface elevation relative to a defined historical baseline.",
    mapLayer: { type: "raster", label: "Coastal elevation exposure", planned: ["Raster surface", "Elevation exposure", "Projection overlay"], endpoint: null },
    legend: { kind: "ramp", label: "Elevation exposure", unit: "m" },
    charts: [
      { id: "trend", title: "Sea level through time", type: "line", xLabel: "Year", yLabel: "Sea level", unit: "mm", placeholder: "Historical observations will appear here", endpoint: null },
      { id: "projection", title: "Projection to 2050", type: "projection", xLabel: "Year", yLabel: "Projected sea level", unit: "mm", placeholder: "Projections will appear here", endpoint: null },
      { id: "scenarios", title: "Scenario comparison", type: "multiline", xLabel: "Year", yLabel: "Sea level", unit: "mm", placeholder: "Scenario comparison will appear here", endpoint: null },
    ],
    indicators: indicators([["hist", "Historical change", "mm"], ["status", "Current status"], ["proj", "Projection", "mm"], ["cov", "Coverage"]]),
    meta: { source: null, temporal: null, spatial: null, updated: null },
    endpoint: null,
    focus: [[66.4, 23.5], [68.9, 25.3]],
    amib: { products: ["D"] }, // sea-level rise felt at the coast, including land sinking (js/amib)
  },
  {
    id: "intrusion",
    title: "Saltwater Intrusion",
    descriptor: "Coastal groundwater exposure",
    color: "#4e9fc0",
    lead: "Groundwater conditions along the coast",
    availability: ["Groundwater samples","Intrusion evidence zones"],
    icon: icon('<path d="M12 3.5 6.5 10a6.2 6.2 0 1 0 11 0Z"/><path d="M9 14.5c.8.9 1.9 1.3 3 1.3"/>'),
    about: "Saltwater intrusion describes the landward movement of saline water into coastal aquifers, affecting groundwater quality and freshwater availability.",
    mapLayer: { type: "points", label: "Groundwater sampling points", planned: ["Sampling points", "Intrusion evidence zones", "Coastal aquifer indicators"], endpoint: null },
    legend: { kind: "categorical", label: "Intrusion evidence", unit: null },
    charts: [
      { id: "trend", title: "Groundwater salinity trend", type: "line", xLabel: "Year", yLabel: "Salinity", unit: "mg/L", placeholder: "Groundwater observations will appear here", endpoint: null },
      { id: "params", title: "EC / TDS / chloride", type: "multiline", xLabel: "Sampling date", yLabel: "Concentration", unit: "—", placeholder: "Parameter observations will appear here", endpoint: null },
      { id: "spatial", title: "Spatial distribution", type: "bar", xLabel: "Area", yLabel: "Share of samples", unit: "%", placeholder: "Spatial statistics will appear here", endpoint: null },
    ],
    indicators: indicators([["samples", "Sampling points"], ["status", "Current status"], ["trend", "Trend"], ["cov", "Coverage"]]),
    meta: { source: null, temporal: null, spatial: null, updated: null },
    endpoint: null,
    focus: [[67.1, 23.6], [68.95, 25.2]],
    amib: { products: ["C", "B", "GH"] }, // fresh groundwater, salt moving up the river, salt-water boundary under the coast
  },
  {
    id: "salinity",
    title: "Salinity Index",
    descriptor: "Marine & groundwater salinity",
    color: "#7acfd0",
    lead: "Salt content of coastal waters",
    availability: ["Marine salinity","Groundwater salinity"],
    icon: icon('<path d="M4 18 9 6l3.5 8 2.5-4 5 8"/><path d="M4 21h16"/>'),
    about: "The salinity index summarises dissolved salt content across marine and coastal groundwater environments.",
    mapLayer: { type: "heatmap", label: "Salinity surface", planned: ["Continuous raster / heatmap", "Sampling points"], endpoint: null },
    legend: { kind: "ramp", label: "Salinity index", unit: "—" },
    charts: [
      { id: "series", title: "Salinity time series", type: "line", xLabel: "Date", yLabel: "Salinity", unit: "PSU", placeholder: "Salinity observations will appear here", endpoint: null },
      { id: "spatial", title: "Spatial distribution", type: "bar", xLabel: "Zone", yLabel: "Salinity", unit: "PSU", placeholder: "Spatial distribution will appear here", endpoint: null },
      { id: "anomaly", title: "Anomaly", type: "bar", xLabel: "Year", yLabel: "Anomaly", unit: "PSU", placeholder: "Anomalies will appear here", endpoint: null },
    ],
    indicators: indicators([["current", "Current"], ["trend", "Trend"], ["anom", "Anomaly"], ["cov", "Coverage"]]),
    meta: { source: null, temporal: null, spatial: null, updated: null },
    endpoint: null,
    focus: [[66.9, 23.6], [68.6, 25.1]],
    amib: { products: ["A", "G", "H"] }, // salty soils, sea-surface salinity and fresh-water signs, future ocean
  },
  {
    id: "mangroves",
    title: "Mangroves",
    descriptor: "Ecosystem extent & change",
    color: "#7fb069",
    lead: "Where mangrove forests stand, and how that is changing",
    availability: ["Extent maps","Historical change"],
    icon: icon('<path d="M12 3c-3 2.4-4.6 5-4.6 7.6a4.6 4.6 0 0 0 9.2 0C16.6 8 15 5.4 12 3Z"/><path d="M12 15v6M9 21h6M8 18l-3 3M16 18l3 3"/>'),
    about: "Mangrove extent maps the area of coastal mangrove forest and how it has changed over time, including the Indus Delta and Balochistan coast.",
    // served from the database by server/api.mjs; without that API running the layer falls back to its placeholders
    // the map shows each year against the first mapped year (kept / gained / lost): pictures from server/mangrove-change.mjs
    mapLayer: { type: "mangrovechange", label: "Mangrove change", planned: ["Polygon extent", "Historical change"], endpoint: "api/mangroves/change/", manifest: "api/layers/mangroves" },
    legend: { kind: "categorical", label: "Mangrove change", unit: null },
    focus: [[67.0, 23.95], [67.95, 24.95]], // the Indus Delta creeks, where most of the change is
    charts: [
      { id: "area", title: "Mangrove area through time", type: "line", xLabel: "Year", yLabel: "Area", unit: "km²", placeholder: "Historical extent will appear here", endpoint: "api/layers/mangroves/series" },
      { id: "change", title: "Gain / loss", type: "bar", xLabel: "Period", yLabel: "Net change", unit: "ha", placeholder: "Gain and loss will appear here", endpoint: null },
      { id: "compare", title: "Extent comparison", type: "bar", xLabel: "Region", yLabel: "Area", unit: "ha", placeholder: "Extent comparison will appear here", endpoint: null },
    ],
    indicators: indicators([["area", "Current extent", "ha"], ["change", "Net change", "ha"], ["proj", "2050"], ["cov", "Coverage"]]),
    meta: { source: null, temporal: null, spatial: null, updated: null },
    endpoint: null,
    amib: { products: ["F"], match: "mangrove", optional: true }, // raster mangrove cover, offered beside the shapefile extent
  },
  {
    id: "erosion",
    title: "Coastal Erosion",
    descriptor: "Land lost to the sea",
    color: "#d98272",
    lead: "Where the coast has been eroded, period by period",
    availability: ["Eroded area by period","Projection to 2050"],
    icon: icon('<path d="M3 16c3-1 4-5 7-5s3 3 6 3 3-2 5-3"/><path d="M3 20h18"/><path d="M14 5l3 3 3-3"/>'),
    about: "Coastal erosion maps the land lost to the sea in each period since 1985. Areas after the last mapped period are a projection to 2050.",
    // served from the database by server/api.mjs; without that API running the layer falls back to its placeholders
    mapLayer: { type: "periodtiles", label: "Eroded area by period", planned: ["Eroded area by period", "Projection to 2050"], endpoint: "api/tiles/erosion/", manifest: "api/layers/erosion" },
    legend: { kind: "categorical", label: "Eroded area", unit: null },
    charts: [
      { id: "movement", title: "Eroded area through time", type: "line", xLabel: "Year", yLabel: "Area lost since 1985", unit: "km²", placeholder: "Eroded area will appear here", endpoint: "api/layers/erosion/series" },
      { id: "rate", title: "Eroded area by period", type: "bar", xLabel: "Period", yLabel: "Area lost", unit: "km²", placeholder: "Area per period will appear here", endpoint: "api/layers/erosion/periods" },
      { id: "length", title: "Affected coastline length", type: "bar", xLabel: "Class", yLabel: "Length", unit: "km", placeholder: "Coastline statistics will appear here", endpoint: null },
    ],
    indicators: indicators([["rate", "Mean rate", "m/yr"], ["length", "Affected length", "km"], ["proj", "2050"], ["cov", "Coverage"]]),
    meta: { source: null, temporal: null, spatial: null, updated: null },
    endpoint: null,
    focus: [[66.9, 23.6], [68.3, 24.95]],
    amib: { products: ["F"], exclude: "mangrove", optional: true }, // raster land lost to / gained from the sea, beside the shapefile areas
  },
  {
    id: "microplastics",
    title: "Plastics",
    descriptor: "Debris & biomagnification",
    color: "#d8a85a",
    lead: "Plastic debris on the coast, and how contaminants build up the food chain",
    availability: ["Beach debris surveys","Scenarios to 2050"],
    icon: icon('<circle cx="8" cy="9" r="2.4"/><circle cx="16" cy="7" r="1.6"/><circle cx="15" cy="15" r="3"/><circle cx="7" cy="17" r="1.4"/>'),
about: "Plastic debris counted on beaches from Karachi to Jiwani, scenarios for those beaches to 2050, and two illustrations: a debris pressure index and biomagnification in the food chain.",
    mapLayer: { type: "plastics", label: "Beach debris surveys", planned: [], endpoint: "api/dmjm/" },
    legend: { kind: "ramp", label: "Beach debris", unit: "items per 100 m" },
    focus: [[61.5, 24.3], [67.4, 25.7]],
    plastics: true, // panel: js/plastics/plasticsPanel.js; data: server/load-dmjm.mjs
    charts: [
      { id: "location", title: "Concentration by location", type: "bar", xLabel: "Sampling location", yLabel: "Concentration", unit: "—", placeholder: "Site concentrations will appear here", endpoint: null },
      { id: "trend", title: "Historical trend", type: "line", xLabel: "Year", yLabel: "Concentration", unit: "—", placeholder: "Historical trend will appear here", endpoint: null },
      { id: "types", title: "Particle type distribution", type: "bar", xLabel: "Particle type", yLabel: "Share", unit: "%", placeholder: "Particle types will appear here", endpoint: null },
    ],
    indicators: indicators([["sites", "Sampling sites"], ["current", "Current"], ["trend", "Trend"], ["cov", "Coverage"]]),
    meta: { source: null, temporal: null, spatial: null, updated: null },
    endpoint: null,
  },
  {
    id: "fisheries",
    title: "Fisheries",
    descriptor: "Marine resources & activity",
    color: "#5b8fd0",
    lead: "Marine resources and fishing activity",
    availability: ["Catch and activity records","Species distribution"],
    icon: icon('<path d="M3 12c2.5-4 6-5.5 10-5 3 .4 5.4 2.2 7 5-1.6 2.8-4 4.6-7 5-4 .5-7.5-1-10-5Z"/><circle cx="16.5" cy="11" r=".7" fill="currentColor"/><path d="M3 12 1.5 8.5M3 12l-1.5 3.5"/>'),
    about: "Fisheries information covers marine resources, fishing activity and species distribution along the coast.",
    mapLayer: { type: "national", label: "National fisheries indicator", planned: ["Fishing activity", "Fishing grounds", "Species / distribution"], endpoint: null },
    legend: { kind: "ramp", label: "National fisheries indicator", unit: "—", gradient: NATIONAL_RAMP },
    focus: [[61.4, 21.0], [68.8, 25.6]],
    charts: [
      { id: "catch", title: "Catch / activity trend", type: "line", xLabel: "Year", yLabel: "Catch", unit: "t", placeholder: "Catch and activity trends will appear here", endpoint: null },
      { id: "species", title: "Species composition", type: "bar", xLabel: "Species", yLabel: "Share", unit: "%", placeholder: "Species composition will appear here", endpoint: null },
      { id: "region", title: "Activity by region & time", type: "bar", xLabel: "Region", yLabel: "Activity", unit: "—", placeholder: "Regional activity will appear here", endpoint: null },
    ],
    indicators: indicators([["catch", "Reported catch", "t"], ["trend", "Trend"], ["species", "Species recorded"], ["cov", "Coverage"]]),
    meta: { source: null, temporal: null, spatial: null, updated: null },
    endpoint: null,
    // catch and stock status, shell-building animals, national index: topics 9-11 of the ocean package (charts and tables;
    // on the map, a balloon stating the national value of the year)
    ocean: { steps: [9, 10, 11] },
  },
  {
    id: "ocean",
    title: "Ocean",
    descriptor: "Acidity, warming & oxygen",
    color: "#9a86d1",
    lead: "How the sea itself is changing: acidity, heat, oxygen and the outlook to 2050",
    availability: [],
    icon: icon('<path d="M12 3.5c-2.6 3-4 5.3-4 7.3a4 4 0 0 0 8 0c0-2-1.4-4.3-4-7.3Z"/><path d="M3 18c2.2 0 2.2-1.5 4.5-1.5S9.8 18 12 18s2.2-1.5 4.5-1.5S18.8 18 21 18"/>'),
    about: "Ocean conditions in Pakistan's Exclusive Economic Zone: surface pH, shell-building conditions, sea temperature and marine heatwaves, dissolved oxygen, combined climate exposure and the outlook to 2050.",
    mapLayer: { type: "ocean", label: "Ocean conditions", planned: [], endpoint: "api/ocean/" },
    focus: [[61.4, 21.0], [68.8, 25.6]], // Pakistan's Exclusive Economic Zone
    legend: { kind: "categorical", label: "Ocean layer", unit: null },
    charts: [],
    indicators: [],
    meta: { source: null, temporal: null, spatial: null, updated: null },
    endpoint: null,
    // topics of the ocean package (server/load-ocean.mjs); the panel is js/ocean/oceanPanel.js
    ocean: { steps: [4, 5, 6, 7, 8, 13] },
  },
];

/** Last observed year: everything after it on the timeline is forecast. */
export const PRESENT_YEAR = 2026;

/** Each mode is a year range on the one shared timeline. */
export const MODES = [
  { id: "historical", label: "Historical", from: 1990, to: 2025 },
  { id: "normal", label: "Normal", from: 1990, to: 2050 },
  { id: "forecast", label: "Forecast", from: 2027, to: 2050 },
];

/** Reference places (locations only — no environmental values). */
export const PLACES = [
  { name: "Karachi", lngLat: [67.01, 24.86], rank: 1 },
  { name: "Gwadar", lngLat: [62.32, 25.12], rank: 1 },
  { name: "Keti Bandar", lngLat: [67.45, 24.14], rank: 2 },
  { name: "Sonmiani", lngLat: [66.58, 25.43], rank: 2 },
  { name: "Ormara", lngLat: [64.64, 25.21], rank: 2 },
  { name: "Pasni", lngLat: [63.47, 25.26], rank: 2 },
  { name: "Jiwani", lngLat: [61.75, 25.05], rank: 2 },
];

export const REGION_LABELS = [
  { name: "Indus Delta", lngLat: [68.0, 23.7] },
  { name: "Sindh Coast", lngLat: [68.3, 24.55] },
  { name: "Makran Coast (Balochistan)", lngLat: [63.9, 25.55] },
  { name: "Arabian Sea", lngLat: [65.5, 23.6] },
];

export const MAP_VIEW = { center: [65.4, 24.9], zoom: 6.3, bounds: [[60.6, 22.6], [69.6, 26.9]] };
