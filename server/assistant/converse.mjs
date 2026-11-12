/**
 * Ordinary conversation for Hela: what a question gets when it is not about a dataset ("what's new since your update?", "tell me a joke",
 * "what is a storm surge?", "what day is it?"). Before this, such questions got "that is outside what I can answer".
 *   today()              today's date in Pakistan, as words
 *   quick(question)      answers written in code, no model: the date and time, and what is new in Hela herself
 *   converse(history, model, usage)   the model chats freely, as itself, with today's date and what Hela can do
 * What stays fixed (CLAUDE.md): the portal's FIGURES come only from answerDirect(); here the model is told not to quote any, and an answer that
 * contains a number is marked as general knowledge, not from the portal.
 */
const OLLAMA_URL = () => (process.env.OLLAMA_URL || "http://localhost:11434").replace(/\/$/, "");
const THREADS = () => Number(process.env.OLLAMA_THREADS) || 0;

export const today = () => new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Karachi" }).format(new Date());
const clock = () => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Karachi" }).format(new Date());

/** What Hela can do now. Keep this true when she changes: it is what she says about herself. Newest first. */
export const WHATS_NEW = [
  "I can keep a normal conversation now: ask me anything, and if it isn't about the portal's data I'll just talk it through, saying when it's general knowledge.",
  "I can fetch today's coastal news: ask \"what's new today in coastal hazards?\" for headlines from Pakistan and around the world.",
  "I can investigate: ask \"what could explain the rise in saline intrusion, and what do the papers say?\" and I'll test a few explanations against published research, with quotes you can check.",
  "The portal can now update itself from the internet. Earthquakes (USGS, 468 events since 1973) and the Karachi tide gauge (PSMSL, 1916 to 2016) are in, checked and approved by a person before I use them, and always labelled as external.",
  "A weekly literature watcher lists new papers on the portal's topics for the team to read.",
  "I know the field data now: ask \"how much phosphate is in the sea?\", \"what plankton is found off Pakistan?\" or \"how much chlorophyll was measured in the lab?\" for ship, float and laboratory measurements from open databases, with where they come from and how near the coast they are.",
];
const SELF = /\b(update[ds]?|retrain\w*|upgrad\w*|(what'?s|whats|what is) (new|different|changed) (with|about|in|for) you|(what'?s|whats|what is) (new|different|changed) (after|since)|new (feature|abilit|skill|thing)s?|what can you do (now|new|today)|what have you learn\w*|what did they (add|change))\b/; // a bare "what's new today in coastal hazards?" is a news question, not this

/** Answers that need no model. Returns { answer, tools } or null. */
export function quick(question) {
  const s = question.toLowerCase().replace(/[^a-z0-9' ]/g, " ").replace(/\s+/g, " ").trim();
  if (/\b(what|which)('s| is)? (the )?(todays? )?(date|day)( is it| today| now)?\b|\bwhat day is (it|today)\b|\btodays? date\b|\bwhat('s| is) the date\b/.test(s)) return { answer: `Today is ${today()}.`, tools: ["date"] };
  if (/\bwhat time is it\b|\bwhat('s| is) the time\b|\bcurrent time\b/.test(s)) return { answer: `It is ${clock()} in Pakistan on ${today()}.`, tools: ["date"] };
  if (SELF.test(s) && !/\b(portal|data|layer|map|mangrove|sea level|salin)/.test(s.replace(/updated? (the )?(portal|data)/, "")))
    return { answer: `I wasn't retrained: my weights haven't changed. What has changed is what I can do around the model. As of ${today()}:\n\n${WHATS_NEW.map((w) => `- ${w}`).join("\n")}\n\nI still write every figure from the portal's database, never from memory.`, tools: ["whats_new"] };
  return null;
}

const SYSTEM = () => `You are Hela, the friendly assistant of PCOP (Pakistan Coastal Observation & Projection), the coastal portal for Pakistan's coast. Talk the way a knowledgeable, relaxed colleague would: natural, warm, direct, short (at most about 80 words unless asked for more). Today is ${today()}, ${clock()} in Pakistan.
You can talk about anything, including coastal science, hazards, the sea, climate, and everyday things. Use your general knowledge freely, and say plainly when something is general knowledge or when you are unsure.
Never say "that's not in my database" or "I can only answer from the portal": that is unhelpful. If a question is about the portal's own data, tell the user to ask it as a question (for example "how has mangrove area changed since 1990?") and the portal will answer with exact figures.
Do not quote numbers, years or statistics about the portal's data or about Pakistan's coast from memory. You cannot browse the web yourself in this reply, so do not claim to know today's news: if asked for news, tell the user to ask "what's new today in coastal hazards" and you will fetch headlines.
What you can do: ${WHATS_NEW.join(" ")}`;

export async function converse(history, model, usage) {
  const msgs = [{ role: "system", content: SYSTEM() }, ...history.slice(-8).map((m) => ({ role: m.role, content: String(m.content).slice(0, 1200) }))];
  const r = await fetch(`${OLLAMA_URL()}/api/chat`, {
    method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(90000),
    body: JSON.stringify({ model, messages: msgs, stream: false, think: false, options: { num_ctx: 6144, temperature: 0.6, num_predict: 260, ...(THREADS() ? { num_thread: THREADS() } : {}) } }),
  });
  if (!r.ok) throw new Error(`Ollama ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  usage.in += j.prompt_eval_count ?? 0; usage.out += j.eval_count ?? 0;
  let text = (j.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").replace(/\*\*/g, "").trim();
  if (!text) return null;
  if (/\d/.test(text.replace(new RegExp(`${today()}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), ""))) text += "\n\n(General knowledge, not from the portal's data.)";
  return text;
}
