/**
 * The saltwater intrusion / salinity package (AMIB) as a short list of hazards, so a reader picks "Fresh groundwater
 * shrinking" instead of one of 520 raw layers. Every id below is a layer of the package's own catalog; nothing is
 * computed here. The Coastal Hazards dock button shows all of them; Sea Level Rise, Saltwater Intrusion and Salinity
 * Index each show their own few (layer.amib.hazards in js/config/layers.js).
 *
 * A hazard has one or more variants (a place, or a river-flow assumption). A variant names its map either as
 *   layer: "<id>"                         one observed map, no emissions scenarios
 *   ssp: { ssp126, ssp245, ssp585 }       the map for each emissions scenario the package ran (some runs are missing)
 * An ssp entry may be a list of fixed maps for different years (the climate-model outlook): the newest one at or
 * before the timeline year is drawn. "{m}" in an id is replaced by the chosen measure (hazard.measures).
 * charts: indicators of timeseries.json shown under the map, by product (variant.charts, when given, replaces them for
 * that variant); variant.chartKeep keeps only matching series
 * (the river-salt charts carry twelve flow × climate runs otherwise).
 */

const yearsOf = (fmt) => [2030, 2050, 2070, 2090].map(fmt);

export const SSPS = [
  { id: "ssp126", key: "1", short: "SSP1-2.6", label: "Low emissions" },
  { id: "ssp245", key: "2", short: "SSP2-4.5", label: "Medium emissions" },
  { id: "ssp585", key: "3", short: "SSP5-8.5", label: "High emissions" },
];

export const HAZARD_GROUPS = [
  { id: "sea", title: "Sea and land" },
  { id: "salt", title: "Salt in water and soil" },
  { id: "ocean", title: "Sea conditions" },
  { id: "coast", title: "Coast and ecosystems" },
];

export const HAZARDS = [
  {
    id: "sea-rise", group: "sea", product: "D", title: "Sea-level rise at the coast",
    insight: "Sea rising plus land sinking, felt at each stretch of coast",
    variants: [{ label: "Best estimate", ssp: { ssp126: "D:annual:ssp126__median", ssp245: "D:annual:ssp245__median", ssp585: "D:annual:ssp585__median" } }],
    charts: [{ product: "D", name: "relative sea-level rise (AR6 climate + InSAR land motion)" }, { product: "D", name: "climate sea-level rise only (AR6, Karachi)" }, { product: "D", name: "Karachi tide gauge mean sea level" }],
  },
  {
    id: "inundation", group: "sea", product: "GH", title: "Land falling below sea level",
    insight: "Land newly below mean sea level and open to the sea",
    variants: [{ label: "Connected to the sea", ssp: { ssp126: "GH:annual:ssp126__inundated", ssp245: "GH:annual:ssp245__inundated", ssp585: "GH:annual:ssp585__inundated" } }],
    charts: [{ product: "GH", name: "land newly below MSL since 2020 (connected to sea)" }],
  },
  {
    id: "sinking", group: "sea", product: "D", title: "Land sinking",
    insight: "How fast the ground is going down, measured by satellite radar",
    variants: [{ label: "Measured 2016–2024", layer: "D:vlm_up_mm_yr:up" }],
    charts: [],
  },
  {
    id: "saltwedge", group: "salt", product: "GH", title: "Saline water rising under the coast",
    insight: "How deep the boundary between fresh and salt groundwater lies",
    variants: [{ label: "Depth to saline water", ssp: { ssp126: "GH:annual:ssp126__interface", ssp245: "GH:annual:ssp245__interface", ssp585: "GH:annual:ssp585__interface" } }],
    charts: [{ product: "GH", name: "median GH interface depth" }, { product: "GH", name: "area with GH interface < 10 m (head-controlled)" }],
  },
  {
    id: "groundwater", group: "salt", product: "C", title: "Fresh groundwater shrinking",
    insight: "The fresh water layer the delta drinks from, and how it thins",
    measures: [{ id: "median", label: "Thickness" }, { id: "class", label: "Water type" }, { id: "prob5m", label: "Chance ≥ 5 m" }],
    variants: [
      { label: "Today's river flow", ssp: { ssp245: "C:annual:current_ssp245__{m}", ssp585: "C:annual:current_ssp585_subs__{m}" } },
      { label: "Water Accord flow", ssp: { ssp245: "C:annual:accord_ssp245__{m}" } },
      { label: "Less flow, lined canals", ssp: { ssp585: "C:annual:degraded_lining_ssp585_subs__{m}" } },
    ],
    charts: [{ product: "C", name: "usable fresh-lens area (P >= 0.7)" }, { product: "C", name: "mean usable lens thickness (land)" }, { product: "C", name: "saline, probable marine (top-down) area" }],
  },
  {
    id: "river-salt", group: "salt", product: "B", title: "Sea salt moving up the Indus",
    insight: "How far saline water reaches up the river in the dry season",
    variants: [
      { label: "Today's river flow", chartKeep: /^current flow|^historical best/, ssp: { ssp245: "B:annual:current_ssp245__median", ssp585: "B:annual:current_ssp585_subs__median" } },
      { label: "Water Accord flow", chartKeep: /^accord flow|^historical best/, ssp: { ssp245: "B:annual:accord_ssp245__median" } },
      { label: "River flow −40 %", chartKeep: /^degraded flow|^historical best/, ssp: { ssp245: "B:annual:degraded_ssp245__median" } },
    ],
    charts: [{ product: "B", name: "salt intrusion length L1 (1 psu), dry-season mean" }, { product: "B", name: "days with L1 > 60 km" }],
  },
  {
    id: "salty-soils", group: "salt", product: "A", title: "Salt-affected soils",
    insight: "Land turned salty, mapped each year from Landsat",
    variants: [{ label: "Keti Bandar coast", layer: "A:annual:ketibandar_coast__class" }, { label: "Sujawal", layer: "A:annual:sujawal__class" }],
    charts: [{ product: "A", name: "salt-affected area (classes 5+6)" }, { product: "A", name: "salt-affected share of inland land (classes 5+6)" }],
  },
  {
    id: "sea-salinity", group: "ocean", product: "G", title: "Sea-surface salinity",
    insight: "Salt in the shelf sea, which falls where the Indus still reaches it",
    variants: [
      { label: "Yearly mean (satellite)", layer: "G:annual:annual__sss" },
      // the climate models' change since 1995-2014 for each year 1985-2100, per emissions scenario (not the satellite's absolute psu)
      { label: "Change by year (climate models)", ssp: Object.fromEntries(SSPS.map(({ id }) => [id, `H:annual:sos_${id}`])), charts: [{ product: "H", name: "CMIP6 sea-surface salinity anomaly" }] },
    ],
    charts: [{ product: "G", name: "shelf sea-surface salinity (annual mean)" }],
  },
  {
    id: "future-ocean", group: "ocean", product: "H", title: "Warmer, saltier, more acidic sea",
    insight: "Climate-model change of the sea by 2030 and 2050",
    measures: [
      { id: "tos", label: "Temperature", chart: "CMIP6 sea-surface temperature anomaly" },
      { id: "ph", label: "Acidity", chart: "CMIP6 surface pH anomaly" },
      { id: "sos", label: "Salinity", chart: "CMIP6 sea-surface salinity anomaly" },
      { id: "zos", label: "Sea level", chart: "CMIP6 dynamic sea-level anomaly" },
    ],
    variants: [{ label: "Model median", ssp: Object.fromEntries(["ssp126", "ssp245", "ssp585"].map((s) => [s, yearsOf((y) => `H:{m}_${s}_${y}_anom_median:anom`)])) }],
    charts: [], // the chart of the chosen measure (measures[].chart)
  },
  {
    id: "shoreline", group: "coast", product: "F", title: "Land lost to the sea",
    insight: "Where water has replaced land, or land has built out",
    variants: ["indus_delta", "karachi", "sonmiani_miani_hor", "ormara_kalmat", "pasni_gwadar", "jiwani_dasht"].map((r) => ({ label: placeName(r), layer: `F:${r}_water_change_30m:change` })),
    charts: [],
  },
  {
    // The INJA team's Landsat waterline package (2026-11-10, server/load-inja.mjs): the whole coast Jiwani to Sir Creek, in 5-year steps 1986-2025 and
    // to 2050 under each scenario. Each map is the share of the surrounding 1 km that eroded (or accreted) in that step.
    id: "erosion-accretion", group: "coast", product: "J", title: "Coast eroding and building out",
    insight: "Where the shoreline retreated or grew, five years at a time since 1986, and the outlook to 2050",
    measures: [
      { id: "erosion", label: "Land lost", chart: "Land lost to the sea (erosion), km² per year" },
      { id: "accretion", label: "Land gained", chart: "Land gained from the sea (accretion), km² per year" },
      { id: "net", label: "Net change", chart: "Net change (gain minus loss), km² per year" },
    ],
    variants: [
      { label: "Every 5 years", ssp: Object.fromEntries(SSPS.map(({ id }) => [id, `J:interval:{m}_${id}`])) },
      { label: "Whole period since 1986", ssp: Object.fromEntries(SSPS.map(({ id }) => [id, [`J:total:{m}_obs`, `J:total:{m}_${id}`]])) },
    ],
    charts: [], // the chart of the chosen measure (measures[].chart)
  },
];

function placeName(r) {
  return { indus_delta: "Indus Delta", karachi: "Karachi", sonmiani_miani_hor: "Sonmiani", ormara_kalmat: "Ormara", pasni_gwadar: "Pasni–Gwadar", jiwani_dasht: "Jiwani" }[r] ?? r;
}

/**
 * How the package's pictures of each product are drawn, set by the owner per subject: smooth fields that are nearly
 * one value across the box leave that even background clear (sea level, groundwater, river salt, salt boundary);
 * class maps of the salinity products do not draw open water.
 * The salt-affected soils and the land lost to the sea are a tint on the satellite picture, not a flat poster (owner request 2026-10-21): each class
 * is drawn only this opaque, so green land and tidal mud stay faint and the salty classes stand out.
 */
const SOIL_TINTS = { vegetation: 0.2, "sparse vegetation": 0.28, "bare, low salinity signal": 0.4, "bare, moderate salinity signal": 0.72, "bare, strong salinity / salt crust": 0.88, "tidal flat": 0.15 };
// Land lost to the sea (the six coastal areas): the sea faint, every change vivid, the two robust ones solid and outlined (crisp);
// the uncertain tidal class covers much of the Indus Delta, so it stays half see-through and does not bury the robust ones. The package's own
// brown and beige vanished on the desert sand (owner, 2026-10-21), so those classes get display colours, which the legend also shows.
const SHORE_TINTS = {
  "land -> water (robust)": { alpha: 1, color: "#ff1744" },
  "water -> land (robust)": { alpha: 1, color: "#e040fb" },
  "water increase, uncertain (tidal/obs. density)": { alpha: 0.5, color: "#ffe100" },
  "permanent -> seasonal": { alpha: 0.8, color: "#4fd8ff" },
  "stable permanent water": 0.12,
};
/**
 * Value ramps that replace the package's colours for some maps: drawn from the raw values (the .tif beside each
 * _rgba.tif, server/amib-render.mjs), each stop { value, color, alpha }, clamped at both ends; the legend shows the same.
 * The yearly sea-surface salinity change moves only within about ±0.1 psu (to −0.34 under SSP5-8.5 by 2100), which
 * the package's ±0.5 psu ramp drew as one near-white slab (owner, 2026-10-22: changes must show from afar). One fixed
 * ramp for every year and scenario, so years stay comparable: fresher in cool blues to violet (down to −0.3, where
 * SSP5-8.5 goes), saltier in warm colours (to +0.15, the most any run reaches), and little or no change faint.
 */
export const RAMPS = {
  "sos-change": [
    { value: -0.3, color: "#c040ff", alpha: 0.97 }, { value: -0.2, color: "#7b4dff", alpha: 0.95 }, { value: -0.1, color: "#2f6bff", alpha: 0.92 }, { value: -0.05, color: "#16c6ff", alpha: 0.82 },
    { value: -0.015, color: "#a6f0ff", alpha: 0.5 }, { value: 0, color: "#eef6f8", alpha: 0.32 }, { value: 0.015, color: "#fff2a6", alpha: 0.5 },
    { value: 0.05, color: "#ffcc00", alpha: 0.82 }, { value: 0.1, color: "#ff8800", alpha: 0.92 }, { value: 0.15, color: "#ff2d55", alpha: 0.95 },
  ],
};
export const LAYER_RAMPS = [{ match: /^H:annual:sos_ssp\d+$/, ramp: "sos-change" }];

export const PRODUCT_STYLE = { D: { clearBackground: true }, C: { clearBackground: true }, B: { clearBackground: true }, GH: { clearBackground: true }, A: { hideClasses: ["water"], softEdges: true, tints: SOIL_TINTS }, F: { softEdges: true, tints: SHORE_TINTS, crisp: true }, G: { hideClasses: ["water"], clipToSea: true }, H: { hideClasses: ["water"], clipToSea: true } }; // clipToSea: sea maps cut to Pakistan's EEZ (server/amib-render.mjs)
