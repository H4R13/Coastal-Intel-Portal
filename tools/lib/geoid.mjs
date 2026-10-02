import { fromFile } from "geotiff";

/**
 * EGM2008 geoid undulation N (metres): height of the geoid (≈ mean sea level) above the WGS84 ellipsoid.
 * Orthometric height (above mean sea level)  H = h_ellipsoidal − N.
 * Grid: PROJ's us_nga_egm08_25.tif (2.5′ nodes, global). Only a regional window is loaded.
 */
export async function loadGeoid(path, { w = 55, e = 75, s = 18, n = 33 } = {}) {
  const img = await (await fromFile(path)).getImage();
  const step = 1 / 24; // degrees
  const col0 = Math.floor((w + 180) / step), col1 = Math.ceil((e + 180) / step) + 1;
  const row0 = Math.floor((90 - n) / step), row1 = Math.ceil((90 - s) / step) + 1;
  const width = col1 - col0, height = row1 - row0;
  const data = await img.readRasters({ window: [col0, row0, col1, row1], interleave: true });
  return {
    /** bilinear undulation at lon/lat (degrees) */
    at(lon, lat) {
      const x = (lon + 180) / step - col0, y = (90 - lat) / step - row0;
      const x0 = Math.floor(x), y0 = Math.floor(y);
      if (x0 < 0 || y0 < 0 || x0 + 1 >= width || y0 + 1 >= height) return NaN;
      const fx = x - x0, fy = y - y0;
      const v = (cx, cy) => data[cy * width + cx];
      return (v(x0, y0) * (1 - fx) + v(x0 + 1, y0) * fx) * (1 - fy) + (v(x0, y0 + 1) * (1 - fx) + v(x0 + 1, y0 + 1) * fx) * fy;
    },
  };
}
