/**
 * Reading the question before anything is looked up:
 *   tidy(text)                 lower case, with near-miss spellings of the portal's own words put right ("mangroov" → "mangrove")
 *   subject(question, earlier) the text to match topics against: the question, plus the questions before it when it is a follow-up
 * Shared by the look-up for the model (tools.mjs retrieve) and by the ready-made answers (answers.mjs).
 */

/** The words that say what a question is about. A question with none of them is a follow-up to the ones before it. */
export const TOPIC = /mangrove|erosion|erod|shoreline|plastic|polymer|debris|pollut|garbage|rubbish|trash|korangi|thatta|sujawal|\btemps?\b|metal|cadmium|chromium|station|oyster|crab|prawn|species|seafood|heat ?wave|hot spell|temperature|warm|acid|\bph\b|aragonite|oxygen|fish|\bstocks?\b|\bcatch|salin|salt|intrusion|groundwater|aquifer|sea.?level|flood|subsid|kotri|river|layer|portal|database|map|earthquake|seismic|shelf|bathymetr/;

/* The portal's own vocabulary: a word one or two letters off one of these is taken to be it. */
const WORDS = ["mangrove", "mangroves", "erosion", "plastic", "plastics", "microplastic", "microplastics", "salinity", "saltwater", "groundwater", "oxygen", "heatwave", "heatwaves", "temperature",
  "earthquake", "earthquakes", "karachi", "thatta", "sujawal", "korangi", "cadmium", "chromium", "acidic", "acidification", "aragonite", "fisheries", "oyster", "oysters", "station", "stations",
  "intrusion", "polymer", "seafood", "sediment", "shoreline", "bathymetry", "database", "projection", "scenario"];
const KNOWN = new Set([...WORDS, "fishermen", "fisherman", "fisherfolk", "protection", "sentiment", "temperate", "intrusive", "elastic", "nation", "national", "stationed", "acidity", "scenery"]); // the last ones are ordinary words that sit close to the portal's, and must be left alone

/** Edit distance, stopping early once it is clearly more than `max`. */
function distance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (Math.min(...row) > max) return max + 1;
    prev = row;
  }
  return prev[b.length];
}

/* Roman Urdu, as people here type it: the words that carry the question, put into the English the rest of the code reads. */
const URDU = [[/\bsab ?se zyada\b|\bsabse zyada\b/g, "most"], [/\bsab ?se kam\b/g, "least"], [/\bkitn[aei]\b/g, "how much"], [/\bky[uo]+n?\b/g, "why"], [/\bkab\b/g, "when"], [/\bkaha+n?\b/g, "where"],
  [/\bab(hi)?\b/g, "now"], [/\bsamand[ae]r\b/g, "sea"], [/\bpaani\b|\bpani\b/g, "water"], [/\bmach+h?li(yan)?\b/g, "fish"], [/\bzam[ei]+n\b/g, "land"], [/\bgara?m\b/g, "warmer"], [/\bnamak(een)?\b|\bkhara\b/g, "salt"],
  [/\bkachra\b|\bgandagi\b/g, "garbage"], [/\bdarya\b/g, "river flow"], [/\bzalzal[ae]\b/g, "earthquake"], [/\bjungle?\b|\bdarakht\b/g, "mangrove"], [/\bkata[ou]\b/g, "erosion"], [/\bsaal\b/g, "year"],
  [/\b(theek|sahi) (chal|kaam)\b|\bchal raha\b/g, "working"], [/\bkharab\b/g, "broken"], [/\baisa\b|\bwoh?\b/g, "that"], [/\bye+h?\b|\bis ?ka\b/g, "this"], [/\bwaha+n?\b/g, "there"], [/^\s*aur\b/g, "and"], [/\bmukhtasar\b|\bchota\b/g, "short"]];

export function tidy(text) {
  const english = URDU.reduce((t, [re, word]) => t.replace(re, word), String(text).toLowerCase());
  return english.replace(/[a-z]{5,}/g, (w) => {
    if (KNOWN.has(w)) return w;
    const max = w.length >= 8 ? 2 : 1; // short words: one slip only, or "nation" becomes "station"
    return WORDS.find((k) => k[0] === w[0] && distance(w, k, max) <= max) ?? w;
  });
}

/* Words that point back at what was just said. Without one of them, a question with no topic is a new, unknown subject, not a follow-up. */
const REFERS = /\b(it|its|this|that|these|those|they|them|there|same|above|previous|earlier|last (one|two|answers?|questions?)|the (change|increase|decrease|rise|fall|trend|reason|cause|effects?)|shorter|short|brief|concise|summar\w*|simpler|again|more detail|what about|how about|what else|else|which ones?|ones)\b|^\s*(and|why|so|then|but|ok|okay|also)\b/;
/* A few words led by a question word, with no topic ("who is affected?", "how sure?"): in the middle of a chat that is about what came before. */
const BRIEF = /^\s*(who|whom|whose|where|when|why|how|which|what|is|are|was|were|does|do|did|can|will|should)\b/;

/**
 * { q, s, followUp, back }: q is this question (tidied); s is what to match topics on; back holds the questions before it
 * (latest first) when this one leans on them, for the details it leaves out (the place, the year).
 *   "why is that?", "and by 2050?", "make it shorter"   no topic of its own: s also carries the two questions before it
 *   "and the metals there?", "what about erosion?"      its own topic: s is the question alone, back supplies the place
 *   "what is the capital of France?"                    no topic and nothing pointing back: a new subject, not a follow-up
 */
export function subject(question, earlier = []) {
  const q = tidy(question), before = earlier.slice(-2).map(tidy).reverse(), own = TOPIC.test(q);
  const leans = /\b(there|same|those|these|them|they)\b|^\s*(and|also|what about|how about)\b/.test(q);
  const brief = !own && BRIEF.test(q) && q.trim().split(/\s+/).length <= 4;
  const followUp = before.length > 0 && (own ? leans : REFERS.test(q) || brief);
  return { q, s: followUp && !own ? `${[...before].reverse().join(" ")} ${q}` : q, followUp, back: followUp ? before : [] };
}
