/**
 * Download the NASA SeaBASS in-situ files that have data inside the NDMA box (60-70 E, 20-27 N).
 *
 *   node server/fetch-seabass.mjs [--list]        (npm run fetch:seabass)
 *
 * 1. Runs SeaBASS's public file search (no login) for the products Chl, HPLC, nutrients, fluorescence, CTD.
 * 2. Downloads every file found with the owner's Earthdata token (EARTHDATA_TOKEN in .env), sent only to NASA hosts.
 * Writes data/ndma-field/seabass/: search.json (the list), raw/<provider path>/<file>.sb (unchanged), manifest.json (sha256, bytes).
 * Nothing is parsed, screened or loaded into the portal here: the sub agent screens the raw files into the intake table.
 * --list stops after the search.
 */
import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto";

const BOX = { north: 27, south: 20, west: 60, east: 70 };
const PRODUCTS = ["Chl", "HPLC", "nutrients", "fluorescence", "CTD"];
const BASE = "https://seabass.gsfc.nasa.gov/";
const OUT = path.resolve("data", "ndma-field", "seabass");
const NASA = /(^|\.)(nasa\.gov)$/i; // the token never leaves these hosts

function token() {
  const env = fs.existsSync(".env") ? fs.readFileSync(".env", "utf8") : "";
  const m = env.match(/^EARTHDATA_TOKEN=(.+)$/m);
  const t = (process.env.EARTHDATA_TOKEN ?? m?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
  if (!t) { console.error("EARTHDATA_TOKEN is not set in .env"); process.exit(1); }
  return t;
}

async function search() {
  const today = new Date().toISOString().slice(0, 10);
  const q = new URLSearchParams({ searchType: "bio", search_type: "Perform File Search", startdate: "1930-01-01", enddate: today, startarcdate: "2000-01-01", endarcdate: today,
    north: BOX.north, south: BOX.south, west: BOX.west, east: BOX.east, bio_sdepth: 0, bio_edepth: 10000, bio_spectrum: "all",
    bio_include_optically_shallow: 0, bio_include_experimental: 0, bio_productType: "any" });
  PRODUCTS.forEach((p) => q.append("bio_products", p));
  const html = await (await fetch(`${BASE}search_results?${q}`)).text();
  const id = html.match(/myID\s*=\s*['"]([^'"]+)/)?.[1];
  if (!id) throw new Error("SeaBASS search returned no result id");
  const list = (await (await fetch(`${BASE}output/bio/${id}.json`)).json()).aaData.map((r) => ({ dir: r[1], file: r[2], docs: r[4]?.[0] ?? null }));
  return { searched_at: new Date().toISOString(), box: BOX, products: PRODUCTS, query: `${BASE}search_results?${q}`, files: list };
}

/** GET with the token, following redirects only between NASA hosts (fetch would drop or leak the header otherwise). */
async function get(url, tok, hops = 0) {
  const u = new URL(url);
  if (!NASA.test(u.hostname)) throw new Error(`refusing to send the token to ${u.hostname}`);
  const r = await fetch(u, { headers: { Authorization: `Bearer ${tok}` }, redirect: "manual" });
  if (r.status >= 300 && r.status < 400 && r.headers.get("location") && hops < 6) return get(new URL(r.headers.get("location"), u).href, tok, hops + 1);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return Buffer.from(await r.arrayBuffer());
}

const s = await search();
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "search.json"), JSON.stringify(s, null, 1));
console.log(`SeaBASS search: ${s.files.length} files in the box`);
if (process.argv.includes("--list")) { s.files.forEach((f) => console.log(`  ${f.dir}/${f.file}`)); process.exit(0); }

const tok = token(), manifest = [];
for (const f of s.files) {
  const rel = path.join("raw", f.dir.replace(/\/archive$/, ""), f.file), dest = path.join(OUT, rel);
  try {
    const buf = await get(`${BASE}archive/${f.dir}/${f.file}`, tok);
    const head = buf.subarray(0, 200).toString("utf8");
    if (!head.startsWith("/begin_header")) throw new Error(`not a SeaBASS file (starts "${head.slice(0, 40).replace(/\s+/g, " ")}")`);
    fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, buf);
    manifest.push({ ...f, path: rel.replace(/\\/g, "/"), bytes: buf.length, sha256: crypto.createHash("sha256").update(buf).digest("hex") });
    console.log(`  ok  ${f.file} (${buf.length} bytes)`);
  } catch (e) { manifest.push({ ...f, error: e.message }); console.log(`  ERR ${f.file}: ${e.message}`); }
}
fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify({ downloaded_at: new Date().toISOString(), files: manifest }, null, 1));
console.log(`Downloaded ${manifest.filter((m) => !m.error).length} of ${manifest.length}; see ${path.join(OUT, "manifest.json")}`);
