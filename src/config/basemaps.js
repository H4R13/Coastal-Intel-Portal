/**
 * Map backdrops and ocean overlays — all free to use without an API key.
 * Raster basemaps replace the dark vector map's land/sea fills; the coastline stays on top.
 * `thumb` is one tile over Karachi / the Indus Delta, used as the picker preview.
 */
const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const modisDay = daysAgo(2); // latest daily mosaics lag by a day or so

export const BASEMAPS = [
  {
    id: "satellite", label: "Satellite", sub: "High-resolution imagery", credit: "Imagery © Esri",
    type: "raster", tileSize: 256, maxzoom: 17,
    tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
    thumb: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/7/54/87",
    paint: { "raster-saturation": -0.2, "raster-brightness-max": 0.88 }, water: 0.1, coast: "#8fd0cb",
  },
  {
    id: "sentinel", label: "Sentinel-2", sub: "Cloudless 10 m mosaic", credit: "Sentinel-2 cloudless © EOX (CC BY-NC-SA 4.0), contains modified Copernicus Sentinel data 2021",
    type: "raster", tileSize: 256, maxzoom: 13,
    tiles: ["https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2021_3857/default/g/{z}/{y}/{x}.jpg"],
    thumb: "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2021_3857/default/g/7/54/87.jpg",
    paint: { "raster-saturation": 0.05, "raster-contrast": 0.08 }, water: 0, coast: "#a8e0d8",
  },
  {
    id: "bluemarble", label: "Relief & bathymetry", sub: "NASA Blue Marble", credit: "Blue Marble © NASA GIBS / Earthdata",
    type: "raster", tileSize: 256, maxzoom: 8,
    tiles: [`${GIBS}/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg`],
    thumb: `${GIBS}/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/6/27/43.jpeg`,
    paint: {}, water: 0, coast: "#c9eef0",
  },
  {
    id: "live", label: "Live from space", sub: "NASA MODIS, daily", credit: `MODIS Terra true colour (${modisDay}) © NASA GIBS / Earthdata`,
    type: "raster", tileSize: 256, maxzoom: 9,
    tiles: [`${GIBS}/MODIS_Terra_CorrectedReflectance_TrueColor/default/${modisDay}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`],
    thumb: `${GIBS}/MODIS_Terra_CorrectedReflectance_TrueColor/default/${modisDay}/GoogleMapsCompatible_Level9/6/27/43.jpg`,
    paint: { "raster-saturation": 0.1 }, water: 0, coast: "#c9eef0",
  },
  {
    id: "night", label: "Night lights", sub: "NASA Black Marble", credit: "Black Marble © NASA GIBS / Earthdata",
    type: "raster", tileSize: 256, maxzoom: 8,
    tiles: [`${GIBS}/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png`],
    thumb: `${GIBS}/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/6/27/43.png`,
    paint: { "raster-brightness-max": 1, "raster-contrast": 0.1 }, water: 0, coast: "#5a9e9c", keepCoast: true, // black land and sea look alike, so keep the coastline
  },
  {
    id: "topo", label: "Topographic", sub: "Contours & relief", credit: "Map data © OpenStreetMap contributors, SRTM | Style © OpenTopoMap (CC-BY-SA)",
    type: "raster", tileSize: 256, maxzoom: 17,
    tiles: ["https://a.tile.opentopomap.org/{z}/{x}/{y}.png", "https://b.tile.opentopomap.org/{z}/{x}/{y}.png", "https://c.tile.opentopomap.org/{z}/{x}/{y}.png"],
    thumb: "https://a.tile.opentopomap.org/6/43/27.png",
    paint: { "raster-saturation": -0.35, "raster-brightness-max": 0.92 }, water: 0, coast: "#5a9e9c",
  },
  {
    id: "dark", label: "Dark map", sub: "Minimal vector basemap", credit: "© OpenStreetMap contributors © CARTO",
    type: "vector", thumb: null,
  },
];

/** Live ocean overlays drawn above the basemap. */
export const OVERLAYS = [
  {
    id: "sst", label: "Sea surface temperature", sub: "NASA MUR, 1 km, daily", credit: "SST: NASA JPL MUR via GIBS / Earthdata",
    tiles: [`${GIBS}/GHRSST_L4_MUR_Sea_Surface_Temperature/default/default/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png`],
    tileSize: 256, maxzoom: 7, opacity: 0.75,
  },
];
