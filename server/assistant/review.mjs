/**
 * What to teach Hela next, from what people actually asked:
 *   node --env-file=.env server/assistant/review.mjs [days]      (default: the last 30 days)
 * It lists (1) the answers marked unhelpful (thumbs down), with the comment, and (2) the questions that had no ready-made
 * answer and went to the language model, most asked first. Under each it says how Hela would answer the same question
 * now: from the data (answers.mjs) or still by the model. Questions that keep landing with the model are the ones worth
 * a sentence in answers.mjs, and a case in eval-cases.mjs so the fix stays fixed.
 */
import { query } from "../db.mjs";
import { answerDirect } from "./answers.mjs";
import { smallTalk, unaddressed } from "./chat.mjs";

const days = Math.min(Math.max(+process.argv[2] || 30, 1), 365);
const now = async (asked) => { const question = unaddressed(asked) || asked; if (smallTalk(unaddressed(asked))) return "now answered at once (small talk)"; const d = await answerDirect(question, []).catch(() => null); return d ? `now answered from the data: ${d.answer.split("\n")[0].slice(0, 150)}` : "still left to the model"; };
const clip = (s, len = 160) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, len);

const down = (await query(
  `select c.question, c.answer, c.model, c.ts, f.comment from assistant_feedback f join assistant_chat c on c.id = f.chat_id
   where f.rating = -1 and f.ts > now() - make_interval(days => $1) order by f.ts desc limit 50`, [days])).rows;
console.log(`\n== Marked unhelpful in the last ${days} days: ${down.length} ==`);
for (const r of down) console.log(`\nQ: ${clip(r.question, 200)}\n   comment: ${r.comment ?? "(none)"}\n   was (${r.model}): ${clip(r.answer)}\n   ${await now(r.question)}`);

const model = (await query(
  `select lower(trim(question)) as question, count(*)::int as times, round(avg(ms) / 1000)::int as seconds, bool_and(ok) as ok
   from assistant_chat where model not like 'data:%' and ts > now() - make_interval(days => $1) group by 1 order by times desc, max(ts) desc limit 60`, [days])).rows;
const left = [];
for (const r of model) { const how = await now(r.question); if (how.startsWith("still")) left.push(r); }
console.log(`\n== Went to the language model in the last ${days} days: ${model.length} different questions, ${left.length} of them would still go there ==`);
for (const r of left) console.log(`  ${String(r.times).padStart(3)} x  ~${r.seconds}s  ${r.ok ? "" : "(failed) "}${clip(r.question, 140)}`);

const share = (await query(`select count(*) filter (where model like 'data:%')::int as data, count(*)::int as all from assistant_chat where ts > now() - make_interval(days => $1)`, [days])).rows[0];
console.log(`\n${share.all} questions in all; ${share.data} answered from the data without the model.\n`);
process.exit(0);
