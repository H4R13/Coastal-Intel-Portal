/**
 * Map layer renderers — one per visualization type.
 * Each implements { add(map, layer), remove(map, layer) }.
 * With no endpoint connected they add nothing, so the map stays honest.
 * To plug in data, set layer.mapLayer.endpoint (GeoJSON URL, or tile URL template for rasters).
 */
const srcId = (l) => `env-${l.id}`;
const lyrId = (l, s) => `env-${l.id}-${s}`;

function geojson(kind) {
  return {
    add(map, layer) {
      const url = layer.mapLayer.endpoint;
      if (!url || map.getSource(srcId(layer))) return;
      map.addSource(srcId(layer), { type: "geojson", data: url });
      const c = layer.color;
      if (kind === "points") map.addLayer({ id: lyrId(layer, "pts"), type: "circle", source: srcId(layer), paint: { "circle-radius": 5, "circle-color": c, "circle-stroke-color": "#04121f", "circle-stroke-width": 1 } });
      if (kind === "polygons") map.addLayer({ id: lyrId(layer, "fill"), type: "fill", source: srcId(layer), paint: { "fill-color": c, "fill-opacity": 0.45, "fill-outline-color": c } });
      if (kind === "lines") map.addLayer({ id: lyrId(layer, "line"), type: "line", source: srcId(layer), paint: { "line-color": c, "line-width": 1.5 } });
      if (kind === "heatmap") map.addLayer({ id: lyrId(layer, "heat"), type: "heatmap", source: srcId(layer), paint: { "heatmap-opacity": 0.7 } });
    },
    remove(map, layer) {
      ["pts", "fill", "line", "heat"].forEach((s) => map.getLayer(lyrId(layer, s)) && map.removeLayer(lyrId(layer, s)));
      map.getSource(srcId(layer)) && map.removeSource(srcId(layer));
    },
  };
}

const raster = {
  add(map, layer) {
    const url = layer.mapLayer.endpoint;
    if (!url || map.getSource(srcId(layer))) return;
    map.addSource(srcId(layer), { type: "raster", tiles: [url], tileSize: 256 });
    map.addLayer({ id: lyrId(layer, "r"), type: "raster", source: srcId(layer), paint: { "raster-opacity": 0.75, "raster-fade-duration": 300 } });
  },
  remove(map, layer) {
    map.getLayer(lyrId(layer, "r")) && map.removeLayer(lyrId(layer, "r"));
    map.getSource(srcId(layer)) && map.removeSource(srcId(layer));
  },
};

export const RENDERERS = {
  raster,
  points: geojson("points"),
  polygons: geojson("polygons"),
  lines: geojson("lines"),
  heatmap: geojson("heatmap"),
};
