/**
 * Coastal news for Hela: "what's new today about coastal hazards in Pakistan?", "any cyclone news?".
 *   wantsNews(question)   true when the question asks for news / what is happening now
 *   news(question)        → { answer, tools } : headlines fetched live, listed as they were published
 * Source: Google News RSS search (a public feed, one request per query, cached 30 minutes). The only thing sent out is the search words.
 * The headlines are copied as published, with outlet, date and link; nothing is rewritten or summarised by the model, and nothing here is portal data.
 */
const FEED = "https://news.google.com/rss/search";
const HAZARD = /\b(coast\w*|hazards?|cyclones?|hurricanes?|typhoons?|floods?\w*|tsunamis?|storm\w*|surge|sea[- ]?level|erosion|mangroves?|marine|ocean\w*|sea|heat ?waves?|fisher\w*|climate|pakistan|karachi|sindh|balochistan|indus|world|global|earthquakes?|monsoon|rain\w*|weather|warning|disaster)\b/i;
const NEWSY = /\b(news|headlines?|latest (news|headlines?|updates?|reports?|on)|what'?s (new|happening|going on)|whats (new|happening|going on)|what is (new|happening|going on)|happening (today|now|lately|this week)|current events|any (new|updates?)\b)/i;
const ABOUT_ME = /\b(update[ds]?|retrain\w*|upgrad\w*|since (the|i|you|we)|new (feature|abilit|skill|thing)s?|what can you do|changed|with you|about you)\b/i;
/** Any news-style question is a news question (a bare "what's new today?" included): left to the chat model it would invent headlines. */
export const wantsNews = (q) => NEWSY.test(q) && !ABOUT_ME.test(q) && !/\b(date|day is it|time is it)\b/i.test(q);

const cache = new Map();
const decode = (s) => s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/<[^>]+>/g, "").trim();

async function feed(query, region) {
  const key = `${query}|${region}`, hit = cache.get(key);
  if (hit && Date.now() - hit.at < 30 * 60000) return hit.items;
  const url = `${FEED}?${new URLSearchParams({ q: `${query} when:7d`, hl: "en", gl: region, ceid: `${region}:en` })}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { "User-Agent": "PCOP-Hela/1.0 (coastal research portal)" } });
  if (!r.ok) throw new Error(`news feed ${r.status}`);
  const xml = await r.text();
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
    const g = (tag) => decode((m[1].match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) ?? [])[1] ?? "");
    return { title: g("title"), link: g("link"), date: new Date(g("pubDate")), outlet: g("source") };
  }).filter((x) => x.title && !isNaN(x.date)).sort((a, b) => b.date - a.date);
  cache.set(key, { at: Date.now(), items });
  return items;
}

const PAKISTAN = '(Pakistan OR Karachi OR Sindh OR Balochistan OR Gwadar OR "Arabian Sea") (coast OR coastal OR cyclone OR flood OR flooding OR tsunami OR "sea level" OR erosion OR mangrove OR mangroves OR fishermen OR "heat wave" OR monsoon)';
const WORLD = '(cyclone OR hurricane OR typhoon OR tsunami OR "storm surge" OR "coastal flooding" OR "sea level rise" OR "coral bleaching" OR "coastal erosion")';
const OFF_TOPIC = /\b(terror\w*|BLA|ambush\w*|drugs?|narcotics?|smuggl\w*|cricket|match|election|dolphins? spotted|cyber\w*|zero-day|SD-WAN|volt typhoon|AI|artificial intelligence|bitcoin|crypto\w*|stocks?|sandy|wreckage|musical|ride the cyclone|cyclone alert|247sports|football|basketball|recruit\w*|nfl|nba|concert)\b/i; // the search words also catch security, tech and sport stories
const WEEK_MS = 8 * 86400000;
const dedupe = (items) => { const seen = new Set(); return items.filter((x) => { const k = x.title.toLowerCase().slice(0, 60); return Date.now() - x.date < WEEK_MS && !OFF_TOPIC.test(x.title) && !seen.has(k) && seen.add(k); }); }; // "when:7d" is not always honoured, so the date is checked here too
const line = (x) => `- ${x.title}${x.outlet && !x.title.endsWith(x.outlet) ? ` (${x.outlet})` : ""}, ${x.date.toISOString().slice(0, 10)} ${x.link}`; // one line: the chat panel lists "- " lines and puts every other line above the list

export async function news(question) {
  const today = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Karachi" }).format(new Date());
  const wantPk = /pakistan|karachi|sindh|balochistan|indus|gwadar|local/i.test(question), wantWorld = /world|global|international|around|everywhere|other countries/i.test(question) || !wantPk;
  const parts = [];
  try {
    if (wantPk || wantWorld) { const pk = dedupe(await feed(PAKISTAN, "PK")).slice(0, 5); parts.push(pk.length ? `Pakistan and the Arabian Sea, last 7 days:\n${pk.map(line).join("\n")}` : "Pakistan and the Arabian Sea: no coastal-hazard headlines in the last 7 days."); }
    if (wantWorld) { const w = dedupe(await feed(WORLD, "US")).slice(0, 6); parts.push(w.length ? `Around the world, last 7 days:\n${w.map(line).join("\n")}` : "Around the world: no coastal-hazard headlines in the last 7 days."); }
  } catch (e) {
    console.warn(`assistant news: ${e.message}`);
    return { answer: `Today is ${today}. I tried to fetch the latest coastal news but couldn't reach the news service from this computer just now (${e.message}). Ask again in a minute, or check it has internet access.`, tools: ["news"] };
  }
  return { answer: `Today is ${today}. Here are the latest coastal-hazard headlines, as the news outlets published them:\n\n${parts.join("\n\n")}\n\nThese are headlines from news outlets, not data from the portal; open a story before relying on it.`, tools: ["news"] };
}
