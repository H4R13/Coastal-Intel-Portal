/**
 * Reading the question before anything is looked up:
 *   tidy(text)                 lower case, with near-miss spellings of the portal's own words put right ("mangroov" → "mangrove")
 *   subject(question, earlier) the text to match topics against: the question, plus the questions before it when it is a follow-up
 * Shared by the look-up for the model (tools.mjs retrieve) and by the ready-made answers (answers.mjs).
 */

/** The words that say what a question is about. A question with none of them is a follow-up to the ones before it. */
export const TOPIC = /mangrove|erosion|erod|shoreline|plastic|polymer|debris|metal|cadmium|chromium|station|oyster|crab|prawn|species|seafood|heat ?wave|hot spell|temperature|warm|acid|\bph\b|aragonite|oxygen|fish|\bstocks?\b|\bcatch|salin|salt|intrusion|groundwater|aquifer|sea.?level|flood|subsid|kotri|river|layer|portal|database|map|earthquake|seismic|shelf|bathymetr/;

/* The portal's own vocabulary: a word one or two letters off one of these is taken to be it. */
const WORDS = ["mangrove", "mangroves", "erosion", "plastic", "plastics", "microplastic", "microplastics", "salinity", "saltwater", "groundwater", "oxygen", "heatwave", "heatwaves", "temperature",
  "earthquake", "earthquakes", "karachi", "thatta", "sujawal", "korangi", "cadmium", "chromium", "acidic", "acidification", "aragonite", "fisheries", "oyster", "oysters", "station", "stations",
  "intrusion", "polymer", "seafood", "sediment", "shoreline", "bathymetry", "database", "projection", "scenario"];
const KNOWN = new Set(WORDS);

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

export function tidy(text) {
  return String(text).toLowerCase().replace(/[a-z]{5,}/g, (w) => {
    if (KNOWN.has(w)) return w;
    const max = w.length >= 8 ? 2 : 1; // short words: one slip only, or "nation" becomes "station"
    return WORDS.find((k) => k[0] === w[0] && distance(w, k, max) <= max) ?? w;
  });
}

/* Words that point back at what was just said. Without one of them, a question with no topic is a new, unknown subject, not a follow-up. */
const REFERS = /\b(it|its|this|that|these|those|they|them|there|same|above|previous|earlier|last (one|two|answers?|questions?)|the (change|increase|decrease|rise|fall|trend|reason|cause|effects?)|shorter|short|brief|concise|summar\w*|simpler|again|more detail|what about|how about|what else|else)\b|^\s*(and|why|so|then|but|ok|okay|also)\b/;

/**
 * { q, s, followUp }: q is this question (tidied); s is what to match topics on. A follow-up ("why is that?", "and by 2050?",
 * "make it shorter") names no topic of its own and points back, so s also carries the two questions before it.
 */
export function subject(question, earlier = []) {
  const q = tidy(question), back = earlier.slice(-2).map(tidy).reverse(); // back: the questions before this one, the latest first
  /* "and the metals there?" names a topic and still leans on the question before; "is it safe to eat oysters?" does not */
  const leans = /\b(there|same|those|these|them|they)\b|^\s*(and|also|what about|how about)\b/.test(q);
  const followUp = back.length > 0 && REFERS.test(q) && (!TOPIC.test(q) || leans);
  return { q, s: followUp ? `${[...back].reverse().join(" ")} ${q}` : q, followUp, back: followUp ? back : [] };
}
