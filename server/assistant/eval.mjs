/**
 * Scores the assistant on the questions in eval-cases.mjs, against the running portal and the real database.
 *   node --env-file=.env server/assistant/eval.mjs            ask every question, write the report, print the score
 *   ... eval.mjs --dry                                        no model: only check that the look-up finds each expected figure
 *   ... eval.mjs --direct                                     no server, no model: only the ready-made answers (answers.mjs); the rest are skipped
 *   ... eval.mjs --only=pl-karachi,oc-ph                      some cases;  --out=file.md  where the report goes
 * A case passes when the answer holds every expected figure, none of the forbidden text, stays within its length, and
 * (unless the case is `loose`) contains no number that is not in the facts looked up for it: an invented figure fails.
 * Start the server with ASSISTANT_PER_MINUTE=1000 so the per-visitor limit does not slow the run.
 */
import fs from "node:fs";
import { CASES } from "./eval-cases.mjs";
import { retrieve } from "./tools.mjs";
import { answerDirect } from "./answers.mjs";

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}`))?.split("=")[1];
const DRY = process.argv.includes("--dry"), DIRECT = process.argv.includes("--direct"), ONLY = arg("only")?.split(","), OUT = arg("out") ?? "eval-report.md", URL_ = arg("url") ?? "http://localhost:5173";

/** Every number written in a text, as written ("1,216.46" → "1216.46"). Digits glued to letters (o2_0_100, IND-01, ssp245) are names, not figures. */
const numbers = (text) => [...String(text).replace(/(\d),(?=\d{3}\b)/g, "$1").matchAll(/(?<![A-Za-z_\d.-])-?\d+(?:\.\d+)?(?![\d_]|[A-Za-z]{3,})/g)].map((m) => m[0]);
/** Is `written` (a number as the answer wrote it) the figure `target`, allowing for rounding to the digits written? */
function same(written, target) {
  const a = Math.abs(parseFloat(written)), t = Math.abs(target), decimals = (written.split(".")[1] ?? "").length;
  if (a === t) return true;
  return Math.abs(a - t) <= 0.5 * 10 ** -decimals + 1e-9 && Math.abs(a - t) <= Math.max(0.011 * t, 0.0006);
}
const holds = (answer, want) => (want instanceof RegExp ? want.test(answer) : typeof want === "number" ? numbers(answer).some((n) => same(n, want)) : answer.toLowerCase().includes(String(want).toLowerCase()));
const words = (s) => s.trim().split(/\s+/).filter(Boolean).length;
const show = (w) => (w instanceof RegExp ? String(w) : w);

async function ask(c) {
  if (DIRECT && (c.opinion || c.research)) return { answer: "", tools: [], seconds: 0, mode: "skipped" }; // her own view needs the model
  if (DIRECT) { const d = await answerDirect(c.q.replace(/^\s*((hey|hi|hello)[\s,]+)?hela\b[\s,!.:;-]*/i, "") || c.q, c.before ?? [], { short: /\b(short(er)?|brief(ly)?|concise|summar\w*)\b/i.test(c.q) }); return { answer: d?.answer ?? "", tools: d?.tools ?? [], seconds: 0, mode: d ? "data" : "skipped" }; }
  const messages = [...(c.before ?? []).flatMap((q) => [{ role: "user", content: q }, { role: "assistant", content: "(answered)" }]), { role: "user", content: c.q }];  const started = Date.now();
  try {
    const r = await fetch(`${URL_}/api/assistant/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages }), signal: AbortSignal.timeout(330000) });
    const j = await r.json();
    return { answer: j.answer ?? j.error ?? "", tools: j.tools ?? [], seconds: (Date.now() - started) / 1000, mode: j.mode };
  } catch (e) { return { answer: `REQUEST FAILED: ${e.message}`, tools: [], seconds: (Date.now() - started) / 1000 }; }
}

const cases = CASES.filter((c) => !ONLY || ONLY.includes(c.id)), rows = [];
for (const c of cases) {
  const question = c.q.replace(/^\s*((hey|hi|hello)[\s,]+)?hela\b[\s,!.:;-]*/i, "") || c.q; // as the server strips the name before looking up
  const facts = (await retrieve(question, 6000, c.before ?? [])).map((f) => f.result).join("\n"), known = numbers(`${facts}\n${c.q}\n${(c.before ?? []).join("\n")}`).map(parseFloat);
  const problems = [];
  if (DRY) {
    for (const m of c.must ?? []) if (typeof m === "number" && !known.some((k) => same(String(m), k) || same(String(k), m))) problems.push(`look-up does not contain ${m}`);
    rows.push({ c, problems, answer: "", seconds: 0, tools: [] });
    continue;
  }
  const { answer, tools, seconds, mode } = await ask(c);
  if (mode === "skipped") { console.log(`skip  ${c.id.padEnd(18)} (left to the model)`); continue; }
  for (const m of c.must ?? []) if (!holds(answer, m)) problems.push(`missing ${show(m)}`);
  if (c.any && !c.any.some((m) => holds(answer, m))) problems.push(`none of ${c.any.map(show).join(" | ")}`);
  for (const m of c.not ?? []) if (holds(answer, m)) problems.push(`has forbidden ${show(m)}`);
  if (c.maxWords && words(answer) > c.maxWords) problems.push(`${words(answer)} words, limit ${c.maxWords}`);
  if (c.opinion && mode !== "opinion") problems.push(`answered as "${mode}", not as her view`);
  if (mode === "opinion" && /\d/.test(answer.split("My view (not from the data):").at(-1))) problems.push("her view has a figure in it"); // figures come from the data only
  if (c.research && mode !== "research") problems.push(`answered as "${mode}", not as an investigation`);
  if (mode === "research" && answer.split("\n").some((l) => /^\d\.\s/.test(l) && /\d/.test(l.replace(/^\d\.\s/, "")))) problems.push("a hypothesis has a figure in it"); // hypotheses carry no numbers; figures and quotes come from the data and the papers
  if (!c.loose && mode !== "data" && mode !== "opinion" && mode !== "research") { // a ready-made answer is written from the data itself; only the model can invent a figure (in a view it may write none: checked above)
    const invented = [...new Set(numbers(answer).filter((n) => { const v = Math.abs(parseFloat(n)); return !(Number.isInteger(v) && v <= 12) && !known.some((k) => same(n, k)); }))];
    if (invented.length) problems.push(`figures not in the looked-up facts: ${invented.join(", ")}`);
  }
  if (/REQUEST FAILED|could not answer|took too long/.test(answer)) problems.push("no answer");
  rows.push({ c, problems, answer, seconds, tools });
  console.log(`${problems.length ? "FAIL" : "pass"}  ${c.id.padEnd(18)} ${seconds.toFixed(0).padStart(3)}s ${mode === "data" ? "data " : "model"} ${problems.join("; ")}`);
}

const passed = rows.filter((r) => !r.problems.length).length, secs = rows.map((r) => r.seconds).sort((a, b) => a - b);
const summary = `${passed} of ${rows.length} passed${DRY ? " (look-up only, no model)" : ` · median ${secs[Math.floor(secs.length / 2)]?.toFixed(0)} s, slowest ${secs.at(-1)?.toFixed(0)} s, total ${(secs.reduce((a, b) => a + b, 0) / 60).toFixed(1)} min`}`;
if (DRY) for (const r of rows) if (r.problems.length) console.log(`FAIL  ${r.c.id.padEnd(18)} ${r.problems.join("; ")}`);
fs.writeFileSync(OUT, `# Hela evaluation, ${new Date().toISOString().slice(0, 16).replace("T", " ")}\n\n${summary}\n\n${rows.map((r) => `## ${r.problems.length ? "FAIL" : "pass"} · ${r.c.id}${DRY ? "" : ` · ${r.seconds.toFixed(0)} s · ${r.tools.join(", ") || "no look-up"}`}\n${(r.c.before ?? []).map((q) => `(earlier: ${q})\n`).join("")}**Q:** ${r.c.q}\n${r.problems.length ? `**Problems:** ${r.problems.join("; ")}\n` : ""}\n${r.answer}\n`).join("\n")}`);
console.log(`\n${summary}\nreport: ${OUT}`);
process.exit(0);
