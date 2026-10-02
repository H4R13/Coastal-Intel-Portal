import { fromFile } from "geotiff";

const path = process.argv[2];
const tiff = await fromFile(path);
const img = await tiff.getImage();
const [w, h] = [img.getWidth(), img.getHeight()];
const bbox = img.getBoundingBox();
console.log({
  size: [w, h],
  bbox,
  resolution: img.getResolution(),
  samplesPerPixel: img.getSamplesPerPixel(),
  bitsPerSample: img.getBitsPerSample(),
  sampleFormat: img.getSampleFormat?.(),
  tileSize: [img.getTileWidth(), img.getTileHeight()],
  noData: img.getGDALNoData(),
  geoKeys: img.getGeoKeys(),
  imageCount: await tiff.getImageCount(),
});
