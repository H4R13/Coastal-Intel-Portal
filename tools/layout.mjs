import { fromFile } from "geotiff";
for (const f of process.argv.slice(2)) {
  const img = await (await fromFile(f)).getImage();
  console.log(f.split("/").pop(), { tile: [img.getTileWidth(), img.getTileHeight()], w: img.getWidth(), h: img.getHeight(), bytesPerPixel: img.getBytesPerPixel() });
}
