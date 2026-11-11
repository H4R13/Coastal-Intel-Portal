/**
 * Hela investigates: "investigate the mangrove trend", "what could explain the salinity rise, and what do the papers say?".
 *   wantsResearch(question, earlier)            true when the question asks for hypotheses, theories, evidence or the literature
 *   research(history, model, usage)             → { answer, tools } or null
 * What the local model does and does not do (CLAUDE.md: it moves numbers and invents effects, so it is boxed in):
 *   1. Facts: the figures come from answerDirect(), written from the database, shown first, as always.
 *   2. Hypotheses: the model proposes up to three candidate explanations in a fixed JSON format, no numbers, and the keywords to
 *      search for them. They are labelled as hypotheses, never as facts.
 *   3. Literature: literature.mjs fetches real papers (OpenAlex). The model reads each abstract and returns a stance plus ONE sentence
 *      copied from it. Code checks that sentence really occurs in the abstract and shares a content word with the hypothesis;
 *      a stance without a verified quote counts for nothing.
 *   4. Verdict: counted by code from the verified quotes, in words ("supported by 2 papers", "contested"), never "confirmed":
 *      abstracts are not proof, and the answer says so. Every quote is shown with its authors, year, journal and link.
 */
import { answerDirect } from "./answers.mjs";
import { tidy } from "./understand.mjs";
import { trends } from "./opinion.mjs";
import { searchPapers, online } from "./literature.mjs";

const OLLAMA_URL = () => (process.env.OLLAMA_URL || "http://localhost:11434").replace(/\/$/, "");
const THREADS = () => Number(process.env.OLLAMA_THREADS) || 0;
const PAPERS_PER_HYPOTHESIS = 4;
const BUDGET_MS = 150000; // one investigation never takes longer; what is not read in time is said to be unread

/* Asking for explanations to be tested, evidence, or what the research says. Plain "why is X rising?" stays with the ready-made answers. */
const RESEARCH = /\b(hypothes[ie]s|theor(y|ies)|investigat\w*|research (it|this|that|the|into)|what (does|do) (the )?(research|literature|science|scientific|papers?|stud(y|ies)|scientists?) (say|show|suggest|know)|(any|what|which) (research|papers?|stud(y|ies)|literature|evidence)|according to (the )?(research|papers?|stud(y|ies)|literature|scientists?)|scientific (evidence|explanation|basis)|evidence (for|that|of|behind|supporting)|(back|backed|support|confirm|prove|verify|test) (it|this|that|the (theory|idea|claim)) (up )?(with|using|against|from|in) (the )?(research|papers?|stud(y|ies)|literature|science)|what (could|might|may) (explain|be (causing|behind|driving|responsible)|cause)|explain (this|that|the) (trend|change|rise|fall|decline|increase)|is there (a |any )?(link|relationship|connection|correlation) between|(confirm|verify|test) (this|that|your|the) (theory|idea|hypothesis|claim|guess))\b/;
const AGAIN = /^\s*(and (the )?(papers|research|studies|literature)|what about (the )?(papers|research|studies|literature)|check (it|that|this)|look (it|that|this) up|confirm (it|that|this)|investigate (it|that|this)|go on|do it)\b/;
export const wantsResearch = (question, earlier = []) => {
  const q = tidy(question);
  return RESEARCH.test(q) || (q.length < 70 && AGAIN.test(q) && earlier.length > 0);
};

/** One constrained call to the local model: JSON in the shape of `schema`, temperature 0. Returns the parsed object or null. */
async function ask(model, system, user, schema, usage, predict) {
  const r = await fetch(`${OLLAMA_URL()}/api/chat`, {
    method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(90000),
    body: JSON.stringify({ model, stream: false, think: false, format: schema,
      options: { num_ctx: 6144, temperature: 0, num_predict: predict, ...(THREADS() ? { num_thread: THREADS() } : {}) },
      messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
  });
  if (!r.ok) throw new Error(`Ollama ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  usage.in += j.prompt_eval_count ?? 0; usage.out += j.eval_count ?? 0;
  try { return JSON.parse(j.message?.content ?? "{}"); } catch { return null; }
}

const HYPOTHESES = { type: "object", required: ["hypotheses"], properties: { hypotheses: { type: "array", maxItems: 3, items: { type: "object", required: ["claim", "search"], properties: { claim: { type: "string" }, search: { type: "string" } } } } } };
const STANCE = { type: "object", required: ["stance", "quote"], properties: { stance: { type: "string", enum: ["supports", "contradicts", "unrelated"] }, quote: { type: "string" } } };

const GIVE_HYPOTHESES = `You help scientists interpret observed data on the coast of Pakistan. From the facts given, propose up to three different candidate explanations (hypotheses) for what the data show, each one testable against published research.
- "claim": one sentence, starting with "May" or "Might", naming a mechanism that could cause what the facts show. Use no numbers and no years. Do not claim it is true.
- "search": four to eight keywords an academic search engine would match, naming the mechanism and the setting (for example the Indus delta, the Arabian Sea, mangroves, a river), not a sentence.
Explain only what the facts show; add no other observations. Each hypothesis must be a different mechanism.`;

const JUDGE = `You check whether a scientific abstract bears on a hypothesis. Reply in JSON with two fields.
"stance": "supports" if the abstract reports a finding consistent with the hypothesis; "contradicts" if it reports a finding that goes against it; "unrelated" if it says nothing about it.
"quote": one sentence copied word for word from the abstract that shows the stance; "" when unrelated. Copy it exactly, never reword or shorten it.`;

const norm = (s) => String(s).toLowerCase().replace(/[‘’“”"'`]/g, "").replace(/\s+/g, " ").trim();
const words = (s) => new Set(norm(s).match(/[a-z]{5,}/g) ?? []);
const COMMON = new Set("which their there these those where while about between other could would study studies results showed shown found using based during after within across through because increase increased decrease decreased change changes changed related effect effects impact".split(" "));

/** A stance counts only with a quote that is really in the abstract and shares a content word with the hypothesis or its keywords. */
function verified(j, abstract, claim, search) {
  if (!j || j.stance === "unrelated") return null;
  const quote = String(j.quote ?? "").trim();
  if (quote.length < 40 || quote.length > 400 || !norm(abstract).includes(norm(quote))) return null;
  const want = new Set([...words(claim), ...words(search)].filter((w) => !COMMON.has(w)));
  if ([...words(quote)].filter((w) => want.has(w)).length < 2) return null; // one shared word is a coincidence: "rising" turns up everywhere
  return { stance: j.stance, quote };
}

/* A paper counts towards the verdict only when it is about this part of the world; one about Bangladesh or Florida is listed apart as "elsewhere". */
const LOCAL = /\b(pakistan\w*|indus|sindh|karachi|balochistan|makran|arabian sea|gulf of oman|north arabian|south asia\w*|keti bandar|sonmiani)\b/i;
const isLocal = (p) => LOCAL.test(`${p.title} ${p.abstract}`);

const cite = (p) => `${p.authors || "Anon."} (${p.year})${p.venue ? `, ${p.venue}` : ""}. ${p.url}`;

function verdict(read, yes, no) {
  if (!read) return "no paper could be read";
  if (yes.length >= 2 && !no.length) return `supported by ${yes.length} of the ${read} papers read`;
  if (yes.length && !no.length) return `some support (1 of the ${read} papers read)`;
  if (yes.length && no.length) return `contested: ${yes.length} paper${yes.length > 1 ? "s" : ""} lean towards it, ${no.length} against (of ${read} read)`;
  if (no.length) return `against: ${no.length} of the ${read} papers read contradict it`;
  return `no support found (none of the ${read} papers read bears on it)`;
}

export async function research(history, model, usage) {
  const asked = history.at(-1).content, earlier = history.slice(0, -1).filter((m) => m.role === "user").map((m) => m.content);
  const facts = await answerDirect(asked, earlier).catch(() => null);
  if (!facts) return { answer: "Tell me which subject to investigate, for example: \"Investigate the mangrove trend\" or \"What could explain the rise in saline water intrusion, and what do the papers say?\"", tools: ["research"] };
  const started = Date.now();
  const made = await ask(model, GIVE_HYPOTHESES, `Facts from the portal's database:\n${facts.answer}\n\nWhich way each moves: ${trends(facts.answer)}\n\n[Propose the hypotheses.]`, HYPOTHESES, usage, 400);
  const hyps = (made?.hypotheses ?? []).map((h) => ({ claim: String(h.claim ?? "").trim(), search: String(h.search ?? "").trim() }))
    .filter((h) => h.claim.length > 15 && h.search.length > 5 && !/\d/.test(h.claim)).slice(0, 3);
  if (!hyps.length) return { answer: `${facts.answer}\n\nI could not put forward a hypothesis that I could check against the research just now. Try asking again, or ask about one subject at a time.`, tools: [...facts.tools, "research"] };

  const lines = [facts.answer, "", "Hypotheses I tested against published research (my reasoning and a reading of abstracts, not from the portal's data):"];
  let offline = !online(), failed = false;
  for (const [n, h] of hyps.entries()) {
    let papers = [];
    if (!offline) try { papers = await searchPapers(LOCAL.test(h.search) ? h.search : `${h.search} Pakistan`, { limit: PAPERS_PER_HYPOTHESIS }); } catch (e) { console.warn(`assistant research: ${e.message}`); offline = true; }
    const yes = [], no = [], elsewhere = [];
    let read = 0;
    for (const p of papers) {
      if (Date.now() - started > BUDGET_MS) break;
      const j = await ask(model, JUDGE, `Hypothesis: ${h.claim}\n\nAbstract (${p.title}):\n${p.abstract.slice(0, 1800)}`, STANCE, usage, 160).catch((e) => { console.warn(`assistant research: ${e.message}`); failed = true; return null; });
      read++;
      const v = verified(j, p.abstract, h.claim, h.search);
      if (v) (isLocal(p) ? (v.stance === "supports" ? yes : no) : elsewhere).push({ ...v, p });
    }
    lines.push("", `${n + 1}. ${h.claim}`);
    lines.push(`   Literature: ${offline && !papers.length ? "the research service could not be reached" : verdict(read, yes, no)}${elsewhere.length ? `; ${elsewhere.length} more from other regions, listed below but not counted` : ""}.`);
    for (const x of [...yes.slice(0, 2), ...no.slice(0, 1)]) lines.push(`   - ${x.stance === "supports" ? "For" : "Against"}: "${x.quote}" ${cite(x.p)}`);
    for (const x of elsewhere.slice(0, 1)) lines.push(`   - Elsewhere (${x.stance === "supports" ? "for" : "against"}): "${x.quote}" ${cite(x.p)}`);
  }
  lines.push("", offline ? "The literature check needs internet access from this computer; the hypotheses above are untested." : "This is a reading of abstracts, not proof: open the papers before relying on a claim. Hypotheses are mine; the figures and the quotes are not.");
  if (failed) lines.push("(The model did not answer for some papers, so fewer were read.)");
  return { answer: lines.join("\n"), tools: [...new Set([...facts.tools, "research"])] };
}
