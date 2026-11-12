/**
 * Published research for Hela's hypotheses (research.mjs).
 *   searchPapers(keywords, { limit })   → [{ title, authors, year, venue, doi, url, abstract, cited }] (only papers that have an abstract)
 *   online()                            true unless RESEARCH_ONLINE=0 in .env
 * Source: OpenAlex (https://api.openalex.org, free, no key). The only thing sent out is the search words, never portal data.
 * Answers are cached in the `literature_cache` table for a week, so asking again is instant and the same papers come back.
 */
import { query } from "../db.mjs";

const API = "https://api.openalex.org/works";
const WEEK = 7 * 24 * 3600 * 1000;
export const online = () => process.env.RESEARCH_ONLINE !== "0";

let ready;
const ensure = () => (ready ??= query("create table if not exists literature_cache (q text primary key, body jsonb not null, fetched timestamptz not null default now())"));

/** OpenAlex ships an abstract as { word: [positions] }; put the words back in order. */
function abstractOf(index) {
  if (!index) return "";
  const words = [];
  for (const [w, at] of Object.entries(index)) for (const i of at) words[i] = w;
  return words.filter((w) => w !== undefined).join(" ").replace(/\s+/g, " ").trim();
}

function shape(w) {
  const authors = (w.authorships ?? []).map((a) => a.author?.display_name).filter(Boolean);
  const doi = w.doi ? w.doi.replace(/^https?:\/\/doi\.org\//, "") : "";
  return {
    title: String(w.title ?? "").replace(/<[^>]+>/g, "").trim(),
    authors: authors.length > 3 ? `${authors[0].split(" ").at(-1)} et al.` : authors.map((a) => a.split(" ").at(-1)).join(", "),
    year: w.publication_year ?? null,
    venue: w.primary_location?.source?.display_name ?? "",
    doi, url: doi ? `https://doi.org/${doi}` : (w.primary_location?.landing_page_url ?? w.id),
    abstract: abstractOf(w.abstract_inverted_index), cited: w.cited_by_count ?? 0,
  };
}

export async function searchPapers(keywords, { limit = 5 } = {}) {
  const q = String(keywords).toLowerCase().replace(/[^a-z0-9 -]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  if (q.length < 6) return [];
  await ensure();
  const hit = (await query("select body from literature_cache where q = $1 and fetched > now() - ($2 || ' milliseconds')::interval", [q, String(WEEK)])).rows[0];
  if (hit) return hit.body.slice(0, limit);
  if (!online()) return [];
  const url = `${API}?search=${encodeURIComponent(q)}&filter=has_abstract:true,type:article,from_publication_date:1995-01-01&per-page=${Math.max(limit * 2, 8)}`
    + "&select=id,doi,title,publication_year,authorships,primary_location,abstract_inverted_index,cited_by_count";
  const r = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { "User-Agent": "PCOP-Hela/1.0 (coastal research portal)" } });
  if (!r.ok) throw new Error(`OpenAlex ${r.status}`);
  const papers = ((await r.json()).results ?? []).map(shape).filter((p) => p.title && p.abstract.length > 200 && p.year)
    .sort((a, b) => b.cited - a.cited || b.year - a.year); // the most cited first: a claim backed by well-read work counts for more
  await query("insert into literature_cache (q, body) values ($1, $2) on conflict (q) do update set body = $2, fetched = now()", [q, JSON.stringify(papers)]);
  return papers.slice(0, limit);
}
