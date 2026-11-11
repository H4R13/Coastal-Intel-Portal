/**
 * Update the portal's data from the internet. Nothing shown on the portal changes until a person approves a staged batch.
 *
 *   npm run update:data                       show each source, when it was fetched, and what waits for a decision
 *   npm run update:data -- --fetch            fetch every source that is due and stage what changed
 *   npm run update:data -- --fetch=usgs-earthquakes     fetch one source now, due or not
 *   npm run update:data -- --approve=3        look at batch 3, then promote it into the portal
 *   npm run update:data -- --reject=3         discard it
 *   ... --force                               approve a batch that failed its checks (only after reading why)
 * To run it every week, schedule `npm run update:data -- --fetch` (Windows Task Scheduler); approving stays manual.
 */
import path from "node:path";
try { process.loadEnvFile(path.join(process.cwd(), ".env")); } catch { /* settings may come from the environment */ }
const { pool, redis } = await import("./db.mjs");
const { SOURCES, fetchSource, approve, reject, status, due } = await import("./external.mjs");

const arg = (name) => { const a = process.argv.find((x) => x === `--${name}` || x.startsWith(`--${name}=`)); return a === undefined ? undefined : (a.split("=")[1] ?? true); };
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "never");

try {
  const fetchArg = arg("fetch"), ok = arg("approve"), no = arg("reject");
  if (fetchArg !== undefined) {
    const ids = typeof fetchArg === "string" ? [fetchArg] : await due();
    if (!ids.length) console.log("No source is due.");
    for (const id of ids) {
      try {
        const r = await fetchSource(id);
        if (r.skipped) { console.log(`${id}: ${r.skipped}`); continue; }
        console.log(`${id}: staged batch #${r.staged} (${r.status}). ${r.diff.after} records now in the feed; ${r.diff.added} new, ${r.diff.changed} revised, ${r.diff.removed} gone compared with what the portal holds (${r.diff.before}).`);
        for (const c of r.checks) console.log(`   ${c.ok ? "ok  " : "FAIL"} ${c.name}: ${c.detail}`);
        console.log(r.status === "pending" ? `   Approve with: npm run update:data -- --approve=${r.staged}` : "   It failed its checks, so it cannot be approved without --force.");
      } catch (e) { console.error(`${id}: ${e.message}`); process.exitCode = 1; }
    }
  } else if (ok !== undefined) {
    const r = await approve(Number(ok), { force: arg("force") === true });
    console.log(`Batch #${r.batch} promoted: ${r.rows} records are now in the portal. Cleared ${r.cleared} cached answers.`);
  } else if (no !== undefined) {
    console.log(`Batch #${(await reject(Number(no))).batch} rejected.`);
  } else {
    for (const s of await status()) {
      console.log(`${s.id}  ${s.name}\n   covers: ${s.covers}\n   provider: ${s.provider}; licence: ${s.licence}`);
      console.log(`   holds ${s.held.n} records${s.held.n ? ` (${day(s.held.first)} to ${day(s.held.last)})` : ""}; last checked ${day(s.last_checked)}, last approved fetch ${day(s.last_fetched)}; refresh every ${s.every_days} days`);
      if (s.last_error) console.log(`   last error: ${s.last_error}`);
      for (const w of s.waiting) console.log(`   waiting: batch #${w.id} (${w.status}), fetched ${day(w.fetched)}: ${w.diff.added} new, ${w.diff.changed} revised, ${w.diff.removed} gone`);
    }
    console.log(`\nSources known: ${Object.keys(SOURCES).join(", ")}`);
  }
} catch (e) { console.error(e.message); process.exitCode = 1; }
finally { await pool.end(); redis.disconnect(); }

