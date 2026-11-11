/**
 * Literature watcher: looks for new papers on the portal's topics (OpenAlex, via assistant/literature.mjs) and lists the ones not seen before.
 *
 *   npm run watch:papers                 search every topic, remember what is new, print the digest
 *   npm run watch:papers -- --digest     print what was found in the last 30 days without searching
 * Papers are only recorded and listed (title, authors, year, journal, link). Nothing is added to Hela's answers, the map or the data: a person reads the
 * digest and decides what matters. Only the search words leave the machine. Safe to schedule weekly.
 */
import path from "node:path";
try { process.loadEnvFile(path.join(process.cwd(), ".env")); } catch { /* settings may come from the environment */ }
const { pool, query, redis } = await import("./db.mjs");
const { searchPapers, online } = await import("./assistant/literature.mjs");

/** The topics: each is a search an academic engine understands. Add a line to watch another subject. */
export const TOPICS = {
  "mangroves": "mangrove extent change Indus delta Pakistan",
  "saline intrusion": "seawater intrusion salinity Indus delta groundwater",
  "sea level": "sea level rise Karachi Indus delta subsidence",
  "erosion": "coastal erosion shoreline change Pakistan Sindh",
  "plastics": "microplastics marine debris Karachi Sindh coast",
  "fisheries": "fisheries Arabian Sea Pakistan catch decline",
  "earthquakes and tsunami": "Makran subduction earthquake tsunami hazard",
  "ocean warming": "Arabian Sea warming marine heatwave oxygen minimum zone",
};

const day = (d) => new Date(d).toISOString().slice(0, 10);
const arg = (name) => process.argv.includes(`--${name}`);

try {
  await query("create table if not exists lit_watch (doi text primary key, topic text not null, title text not null, authors text, year int, venue text, url text, cited int, first_seen timestamptz not null default now())");
  if (!arg("digest")) {
    if (!online()) throw new Error("RESEARCH_ONLINE=0: the watcher needs internet access");
    const first = (await query("select count(*)::int as n from lit_watch")).rows[0].n === 0; // the first run records what exists; only later runs count as "new"
    for (const [topic, words] of Object.entries(TOPICS)) {
      try {
        for (const p of await searchPapers(words, { limit: 8 })) {
          const key = p.doi || p.url;
          if (!key) continue;
          await query("insert into lit_watch (doi, topic, title, authors, year, venue, url, cited) values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict do nothing", [key, topic, p.title, p.authors, p.year, p.venue, p.url, p.cited]);
        }
      } catch (e) { console.warn(`${topic}: ${e.message}`); process.exitCode = 1; }
    }
    if (first) console.log("First run: recorded the papers that exist now as the starting point.");
  }
  const rows = (await query("select * from lit_watch where first_seen > now() - interval '30 days' order by topic, year desc, cited desc")).rows;
  const total = (await query("select count(*)::int as n from lit_watch")).rows[0].n;
  console.log(`${total} papers recorded; ${rows.length} first seen in the last 30 days.\n`);
  let last = "";
  for (const r of rows) {
    if (r.topic !== last) console.log(`\n== ${r.topic} ==`), (last = r.topic);
    console.log(`- ${r.authors || "Anon."} (${r.year}) ${r.title}${r.venue ? `, ${r.venue}` : ""}${r.cited ? ` [cited ${r.cited}]` : ""}\n  ${r.url}  (seen ${day(r.first_seen)})`);
  }
  console.log("\nThese are listings, not endorsements: open a paper before relying on it.");
} catch (e) { console.error(e.message); process.exitCode = 1; }
finally { await pool.end(); redis.disconnect(); }
