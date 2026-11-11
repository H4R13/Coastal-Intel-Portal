/**
 * Pakistan's border for the map (src/components/MapView.jsx), split into its land and coastal stretches.
 *
 *   node server/build-boundaries.mjs <boundary.shp | boundary.geojson> [--srid=<EPSG>]
 *   node server/build-boundaries.mjs --neighbours <ne_10m_admin_0_countries_pak.geojson>
 *
 * The boundary is the Survey of Pakistan's file (Jammu and Kashmir inside Pakistan). Polygons (one country, or
 * provinces/districts, which are merged) or lines both work. Its projection is read from the .prj next to the .shp
 * (WGS84, UTM 41-43N, Web Mercator are recognised); for anything else give --srid. PostGIS does the reprojection and
 * the split, so the database must be reachable (settings in .env).
 *
 * Land or coast: a stretch of border within 3 km of a neighbouring country is land, the rest is coast. Neighbours come
 * from server/neighbours.geojson (Natural Earth admin-0, Pakistan point of view, public domain), which --neighbours
 * rebuilds. Until the Survey's file arrived, Natural Earth's Pakistan was the boundary too (same command, its file).
 *
 * Writes public/boundaries/pakistan.geojson: MultiLineString features with properties { kind: "land" | "coast" }.
 */
import fs from "node:fs"; import path from "node:path";
import * as shp from "shapefile";
const shapefile = shp.default ?? shp;
try { process.loadEnvFile(path.join(process.cwd(), ".env")); } catch { /* settings may come from the environment */ }

const args = process.argv.slice(2), opt = (k) => args.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
const file = args.find((a) => !a.startsWith("--"));
const NEIGHBOURS = new URL("./neighbours.geojson", import.meta.url);
const OUT = path.resolve("public/boundaries/pakistan.geojson");
if (!file || !fs.existsSync(file)) { console.error("Give the boundary file (.shp or .geojson)"); process.exit(1); }

/* ---------- --neighbours: the countries around Pakistan, simplified (~1 km), for telling land border from coast ---------- */
if (args.includes("--neighbours")) {
  const BOX = [54, 14, 84, 41]; // west, south, east, north
  const inBox = ([x, y]) => x >= BOX[0] && x <= BOX[2] && y >= BOX[1] && y <= BOX[3];
  const polysOf = (g) => (g.type === "Polygon" ? [g.coordinates] : g.coordinates);
  const simplify = (ring, tol) => { // Douglas–Peucker
    if (ring.length < 5) return ring;
    const keep = new Uint8Array(ring.length); keep[0] = keep[ring.length - 1] = 1;
    const stack = [[0, ring.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop(), [ax, ay] = ring[a], [bx, by] = ring[b], dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
      let worst = -1, far = 0;
      for (let i = a + 1; i < b; i++) {
        const d = len ? Math.abs(dy * (ring[i][0] - ax) - dx * (ring[i][1] - ay)) / len : Math.hypot(ring[i][0] - ax, ring[i][1] - ay); // a closed ring starts and ends on one point
        if (d > far) { far = d; worst = i; }
      }
      if (far > tol) { keep[worst] = 1; stack.push([a, worst], [worst, b]); }
    }
    return ring.filter((_, i) => keep[i]);
  };
  const feats = JSON.parse(fs.readFileSync(file, "utf8")).features
    .filter((f) => f.properties.ADM0_A3 !== "PAK" && polysOf(f.geometry).some((p) => p[0].some(inBox)))
    .map((f) => ({
      type: "Feature", properties: { name: f.properties.ADMIN },
      geometry: { type: "MultiPolygon", coordinates: polysOf(f.geometry).filter((p) => p[0].some(inBox)).map((p) => p.map((r) => simplify(r, 0.01).map(([x, y]) => [+x.toFixed(4), +y.toFixed(4)])).filter((r) => r.length >= 4)).filter((p) => p.length) },
    }));
  fs.writeFileSync(NEIGHBOURS, JSON.stringify({ type: "FeatureCollection", features: feats }));
  console.log(`neighbours.geojson: ${feats.map((f) => f.properties.name).join(", ")}`);
  process.exit(0);
}

/* ---------- the boundary ---------- */
function sridOf(shpFile) {
  if (opt("srid")) return +opt("srid");
  const prj = shpFile.replace(/\.shp$/i, ".prj");
  if (!fs.existsSync(prj)) { console.log("No .prj next to the file: taking it as WGS84 longitude/latitude (EPSG:4326)"); return 4326; }
  const t = fs.readFileSync(prj, "utf8");
  const utm = t.match(/UTM[_ ]zone[_ ]?(4[123])N/i);
  if (/^PROJCS/i.test(t) && utm) return /Kalianpur/i.test(t) ? null : 32600 + +utm[1];
  if (/Mercator_Auxiliary_Sphere|Pseudo[_ ]Mercator|Web_Mercator/i.test(t)) return 3857;
  if (/^GEOGCS/i.test(t) && /WGS[_ ]?(19)?84/i.test(t)) return 4326;
  return null;
}

let geoms, srid = 4326;
if (/\.shp$/i.test(file)) {
  srid = sridOf(file);
  if (!srid) { console.error(`Projection not recognised; look up its EPSG code in ${file.replace(/\.shp$/i, ".prj")} and pass --srid=<code>`); process.exit(1); }
  geoms = [];
  const src = await shapefile.open(file);
  for (let r = await src.read(); !r.done; r = await src.read()) if (r.value.geometry) geoms.push(r.value.geometry);
} else {
  geoms = JSON.parse(fs.readFileSync(file, "utf8")).features.filter((f) => f.properties?.ADM0_A3 ? f.properties.ADM0_A3 === "PAK" : true).map((f) => f.geometry);
}
console.log(`${geoms.length} shape(s), EPSG:${srid}`);

const { pool, redis } = await import("./db.mjs");
try {
  const neighbours = JSON.parse(fs.readFileSync(NEIGHBOURS, "utf8")).features.map((f) => JSON.stringify(f.geometry));
  const { rows: [r] } = await pool.query(`
    with src as (
      select ST_MakeValid(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(j), $2::int), 4326)) as g from unnest($1::text[]) as j
    ), polys as (select ST_Union(ST_CollectionExtract(g, 3)) as g from src),
       lines as (select ST_Union(ST_CollectionExtract(g, 2)) as g from src),
    border as (
      -- polygons: their outline once merged (inner province lines disappear); lines: as given
      select ST_LineMerge(coalesce(ST_Boundary(nullif((select g from polys), ST_GeomFromText('POLYGON EMPTY', 4326))), (select g from lines))) as g
    ), near as (
      select ST_Buffer(ST_Union(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(j), 4326)))::geography, 3000)::geometry as g from unnest($3::text[]) as j
    )
    select ST_AsGeoJSON(ST_CollectionExtract(ST_Intersection(b.g, n.g), 2), 5) as land,
           ST_AsGeoJSON(ST_CollectionExtract(ST_Difference(b.g, n.g), 2), 5) as coast,
           ST_Length(ST_Intersection(b.g, n.g)::geography) / 1000 as land_km,
           ST_Length(ST_Difference(b.g, n.g)::geography) / 1000 as coast_km
    from border b, near n`, [geoms.map((g) => JSON.stringify(g)), srid, neighbours]);
  const fc = { type: "FeatureCollection", features: [["land", r.land], ["coast", r.coast]].map(([kind, g]) => ({ type: "Feature", properties: { kind }, geometry: JSON.parse(g) })) };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(fc));
  console.log(`Land border ${Math.round(r.land_km).toLocaleString()} km, coast ${Math.round(r.coast_km).toLocaleString()} km → ${path.relative(process.cwd(), OUT)} (${(fs.statSync(OUT).size / 1024).toFixed(0)} kB)`);
} catch (e) {
  console.error(`Failed: ${e.message}`);
  process.exitCode = 1;
} finally {
  await pool.end(); redis.disconnect();
}
