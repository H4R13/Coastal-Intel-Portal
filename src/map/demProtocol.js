/**
 * "dem://{z}/{x}/{y}" tile protocol for MapLibre terrain / hillshade.
 *
 *  1. Project DEM  (data/terrain, built by tools/build-terrain.mjs): 12.5 m source, heights above mean sea level.
 *  2. Fallback     global Terrarium terrain, with negative values (sea-floor depth) clamped to 0 so the sea is flat,
 *                  matching the local tiles where sea is also exactly 0 m.
 * Both are Terrarium-encoded PNGs, so the map treats them identically.
 */
const LOCAL_BASE = "data/terrain";
const GLOBAL_TILES = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

let localTiles = null; // Set("z/x/y") of tiles that exist locally; stays empty if no local data has been built
const ready = fetch(`${LOCAL_BASE}/manifest.json`)
  .then((r) => (r.ok ? r.json() : null))
  .then((m) => { localTiles = new Set(m ? Object.entries(m.tiles).flatMap(([z, list]) => list.map((t) => `${z}/${t}`)) : []); })
  .catch(() => { localTiles = new Set(); });

/** Clamp sub-sea-level values to 0 m in a Terrarium PNG. Alpha is always 255 so nothing is premultiplied. */
async function clampToSeaLevel(blob) {
  const bmp = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) if (d[i] < 128) { d[i] = 128; d[i + 1] = 0; d[i + 2] = 0; } // 128*256 = 32768 → 0 m
  ctx.putImageData(img, 0, 0);
  return (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer();
}

/**
 * dem://    terrain  — global fallback is flattened at sea (costs a few ms of main-thread time per tile)
 * demhs://  hillshade — global fallback is used as-is: the shading sits under the water layer, so sea depth never shows
 */
export function registerDemProtocol(maplibregl) {
  for (const scheme of ["dem", "demhs"]) {
    maplibregl.addProtocol(scheme, async (params, abort) => {
      const [, z, x, y] = params.url.match(/^dem(?:hs)?:\/\/(\d+)\/(\d+)\/(\d+)/);
      await ready;
      if (localTiles.has(`${z}/${x}/${y}`)) {
        const r = await fetch(`${LOCAL_BASE}/${z}/${x}/${y}.png`, { signal: abort.signal });
        if (r.ok) return { data: await r.arrayBuffer() };
      }
      const r = await fetch(GLOBAL_TILES.replace("{z}", z).replace("{x}", x).replace("{y}", y), { signal: abort.signal });
      if (!r.ok) throw new Error(`terrain tile ${z}/${x}/${y}: ${r.status}`);
      return { data: scheme === "dem" ? await clampToSeaLevel(await r.blob()) : await r.arrayBuffer() };
    });
  }
}
