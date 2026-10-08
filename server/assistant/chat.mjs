/**
 * The portal assistant: a language model answers by calling the tools in tools.mjs and nothing else, so every figure
 * comes from the portal's own datasets. Chats, ratings and the API access log are kept in PostgreSQL (see ensureTables).
 *   POST /api/assistant/chat      { messages: [{ role, content }] } → { id, answer, tools, ok }
 *   POST /api/assistant/feedback  { id, rating: 1 | -1, comment? } → { ok }
 *   GET  /api/assistant/status    → { ready, provider, model, hint? }
 *
 * Two ways to run the model (ASSISTANT_PROVIDER, or chosen automatically):
 *   ollama     (default) an open model running on this machine or your own server through Ollama: no key, no per-question cost,
 *              nothing leaves your network. OLLAMA_MODEL (default qwen3:4b, else the best installed), OLLAMA_URL (default http://localhost:11434).
 *   anthropic  Claude over the API: stronger, but needs ANTHROPIC_API_KEY and costs per question. ASSISTANT_MODEL, ASSISTANT_EFFORT.
 * With an ANTHROPIC_API_KEY present and no ASSISTANT_PROVIDER, Claude is used; otherwise Ollama.
 */
import Anthropic from "@anthropic-ai/sdk";
import crypto from "node:crypto";
import { query } from "../db.mjs";
import { toolDefs, runTool, retrieve } from "./tools.mjs";

const hasKey = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
const PROVIDER = () => process.env.ASSISTANT_PROVIDER || (hasKey() ? "anthropic" : "ollama");
const CLAUDE = () => process.env.ASSISTANT_MODEL || "claude-opus-5-5";
const EFFORT = () => process.env.ASSISTANT_EFFORT || "medium";
const OLLAMA_URL = () => (process.env.OLLAMA_URL || "http://localhost:11434").replace(/\/$/, "");
const THREADS = () => +process.env.OLLAMA_THREADS || 0; // processor threads the local model may use; 0 = Ollama's own choice
const MAX_TURNS = 8;          // tool rounds per question
const MAX_HISTORY = 12;       // messages sent back with a question
const MAX_QUESTION = 2000;    // characters
const PER_MINUTE = 8;         // questions per visitor per minute
const LOCAL_TOOL_CHARS = 6000; // a small model has a small context: keep each tool answer shorter than for Claude
const LOCAL_TIMEOUT = 5 * 60 * 1000;

export const NAME = "Hela"; // what the assistant is called, in the portal and when it speaks of itself; "Hey Hela, ..." addresses it
const SYSTEM = `Your name is ${NAME}. You are the assistant of the Coastal Environmental Intelligence portal for the coast of Pakistan (Indus Delta, Sindh and Balochistan coast, the Exclusive Economic Zone). You answer questions about its datasets, and you can tell whether the portal's layers are working.

Rules:
1. Facts come from tools only. Before stating any number, year, trend or finding about the Pakistan coast, call a tool and read the result. Never fill a gap from memory or invent a value. If tools return nothing relevant, say plainly that the portal's datasets do not hold it.
2. State where each figure came from (dataset or document key), its year or period, its units, and whether it is observed or projected / modelled. Keep observed and projected apart and never present a projection as a measurement.
3. Not in the database: earthquake and seismic records, continental-shelf depth change, and raw Google Earth Engine exports. If asked about those, say they are not loaded, and offer only clearly labelled general background ("General background, not from the portal's data:"), kept short, with no Pakistan-specific numbers.
4. Questions about whether the portal or a layer works: call system_health (and access_summary for load failures or slow maps) and report each check's status and detail as returned.
5. Where datasets conflict or are uncertain, say so. Report the stated uncertainty (ranges, scenarios) when it is in the data.
6. Be brief and clear: short paragraphs or "-" lists, no headings, no tables. Give the figure first, then one line of context. If a question is ambiguous, answer the most likely reading and name the assumption.
7. Answer every part of the question. For a part the data does not cover, say "not loaded in the portal" for that part. Copy figures exactly as given; do not move a figure from one item to another, and if a record is cut off say so instead of guessing the rest.
8. People may address you as "${NAME}" or "Hey ${NAME}". If asked who you are: you are ${NAME}, the portal's assistant, and you look facts up in the portal's database.
Start with list_datasets if you do not know where something lives; ocean:catalog and amib:catalog describe every dataset in those packages, and ocean:findings and dmjm:literature hold written findings and references.`;

let claude = null;
const claudeClient = () => (claude ??= new Anthropic()); // reads ANTHROPIC_API_KEY (or a profile) from the environment

/* ---------- which model answers ---------- */
let installed = { at: 0, names: null };
async function ollamaModels() {
  if (installed.names && Date.now() - installed.at < 20000) return installed.names;
  const r = await fetch(`${OLLAMA_URL()}/api/tags`, { signal: AbortSignal.timeout(3000) });
  if (!r.ok) throw new Error(`Ollama answered ${r.status}`);
  installed = { at: Date.now(), names: (await r.json()).models.map((m) => m.name) };
  return installed.names;
}
const PREFERRED = ["qwen3:8b", "qwen3:4b", "qwen2.5:7b", "qwen2.5:3b", "llama3.1:8b", "llama3.2:3b", "qwen3:1.7b"]; // all can call tools

/** { name, ready, model?, hint? } for the provider in use. */
export async function provider() {
  const name = PROVIDER();
  if (name === "anthropic") return hasKey() ? { name, ready: true, model: CLAUDE() } : { name, ready: false, hint: "ASSISTANT_PROVIDER is anthropic but ANTHROPIC_API_KEY is not set in .env." };
  try {
    const have = await ollamaModels();
    const wanted = process.env.OLLAMA_MODEL;
    const model = wanted ? have.find((n) => n === wanted || n.startsWith(`${wanted}:`)) : PREFERRED.find((n) => have.includes(n)) ?? have[0];
    if (!model) return { name, ready: false, hint: wanted ? `Ollama is running but model "${wanted}" is not installed. Run: ollama pull ${wanted}` : "Ollama is running but has no model. Run: ollama pull qwen3:4b" };
    return { name, ready: true, model };
  } catch {
    return { name, ready: false, hint: "Ollama is not running. Start it (or install it from ollama.com), then run: ollama pull qwen3:4b" };
  }
}
export const assistantStatus = async () => { const p = await provider(); return { ready: p.ready, provider: p.name, model: p.model, hint: p.hint }; };

/* ---------- storage ---------- */
let tablesReady = null;
export function ensureTables() {
  tablesReady ??= query(`
    create table if not exists assistant_chat (
      id uuid primary key, ts timestamptz not null default now(), question text not null, answer text, tools jsonb not null default '[]',
      model text, input_tokens int, output_tokens int, ms int, ok boolean not null default true);
    create table if not exists assistant_feedback (
      id bigserial primary key, chat_id uuid references assistant_chat(id) on delete cascade, ts timestamptz not null default now(),
      rating int not null check (rating in (-1, 1)), comment text);
    create index if not exists assistant_feedback_chat on assistant_feedback (chat_id);
    create table if not exists access_log (ts timestamptz not null default now(), route text not null, status int not null, ms int not null);
    create index if not exists access_log_ts on access_log (ts);
    delete from access_log where ts < now() - interval '14 days';
  `).catch((e) => { tablesReady = null; throw e; });
  return tablesReady;
}

/** One line per API request that is not a map tile; lets the assistant (and you) see failing or slow answers. */
export function logAccess(route, status, ms) {
  ensureTables().then(() => query("insert into access_log (route, status, ms) values ($1, $2, $3)", [route.slice(0, 200), status, Math.round(ms)])).catch(() => {});
}

/* ---------- limits ---------- */
const hits = new Map();
export function allowed(who) {
  const now = Date.now(), recent = (hits.get(who) ?? []).filter((t) => now - t < 60000);
  if (recent.length >= PER_MINUTE) { hits.set(who, recent); return false; }
  recent.push(now); hits.set(who, recent);
  if (hits.size > 500) for (const [k, v] of hits) if (!v.some((t) => now - t < 60000)) hits.delete(k);
  return true;
}

/* ---------- the conversation ---------- */
function clean(messages) {
  const out = (Array.isArray(messages) ? messages : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_QUESTION) }))
    .slice(-MAX_HISTORY);
  while (out.length && out[0].role !== "user") out.shift();
  return out.at(-1)?.role === "user" ? out : [];
}

/** Claude: ask, run the tools it calls, repeat until it answers. Returns { answer, ok }. */
async function viaClaude(messages, used, usage) {
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await claudeClient().messages.create({
      model: CLAUDE(), max_tokens: 16000, system: SYSTEM, tools: toolDefs, messages,
      thinking: { type: "adaptive" }, output_config: { effort: EFFORT() },
    });
    usage.in += response.usage?.input_tokens ?? 0; usage.out += response.usage?.output_tokens ?? 0;
    const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    if (response.stop_reason === "refusal") return { answer: "I can't help with that one.", ok: false };
    if (response.stop_reason === "pause_turn") { messages.push({ role: "assistant", content: response.content }); continue; }
    if (response.stop_reason !== "tool_use") {
      const cut = response.stop_reason === "max_tokens" ? "\n\n(The answer was cut off at the length limit.)" : "";
      return { answer: (text || "I couldn't put an answer together. Please try rephrasing.") + cut, ok: true };
    }
    messages.push({ role: "assistant", content: response.content }); // whole turn, thinking blocks included
    const calls = response.content.filter((b) => b.type === "tool_use");
    const results = await Promise.all(calls.map(async (c) => { used.push(c.name); return { type: "tool_result", tool_use_id: c.id, content: await runTool(c.name, c.input) }; }));
    messages.push({ role: "user", content: results }); // every result of the turn in one message
  }
  return null;
}

/**
 * When every look-up came back as ready statements (whole sentences written from the data by tools.mjs), the answer's
 * figures are those sentences, shown as they are: a small model swaps numbers between scenarios when it rewrites them.
 * The model adds only the opening line, in words, and any sentence of its with a number in it is dropped.
 * Returns { answer, ok }, or null when the facts are not in statement form (the model then answers as usual).
 */
async function factsFirst(question, found, short, model, usage) {
  const facts = found.map((f) => { try { return JSON.parse(f.result); } catch { return null; } });
  if (!facts.every((r) => r && Array.isArray(r.statements))) return null;
  const parts = facts.filter((r) => r.statements.length), per = short ? 1 : parts.length >= 3 ? 2 : parts.length === 2 ? 3 : 4;
  if (!parts.length) return null;
  const sections = parts.map((r) => ({ title: r.title, lines: r.statements.slice(0, Math.min(per, r.core || per)) })); // the main measure at the place asked about; side measures only add noise
  const body = sections.map((s) => `${sections.length > 1 && s.title ? `${s.title}:\n` : ""}${s.lines.map((l) => `- ${l}`).join("\n")}`).join("\n\n");
  const missing = facts.map((r) => r.not_loaded).filter(Boolean), notes = parts.map((r) => r.note).filter(Boolean).join(" ");
  const why = /\bwhy\b|reason|cause|driver|due to|because|behind/i.test(question), driver = facts.map((r) => r.driver).find(Boolean);
  let lead = parts.every((r) => r.gist) ? `In short, ${parts.map((r) => r.gist).join("; ")}.${why && driver ? ` ${driver}` : ""}` : ""; // the tool worked the gist out itself: nothing for the model to get wrong
  if (!lead) try {
    const r = await fetch(`${OLLAMA_URL()}/api/chat`, {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(LOCAL_TIMEOUT),
      body: JSON.stringify({ model, stream: false, think: false, options: { num_ctx: 4096, temperature: 0, num_predict: 90, ...(THREADS() ? { num_thread: THREADS() } : {}) }, messages: [
        { role: "system", content: `You are ${NAME}, the assistant of a coastal data portal for Pakistan. You write short, plain, careful sentences and never state anything the given statements do not say.` },
        { role: "user", content: `Question: ${question}\n\nStatements from the portal's data (these will be shown to the user as they are, right under your reply):\n${body}\n\nHow to read them: ${notes || "each statement is complete as written."}${missing.length ? `\nNot in the portal's data: ${missing.join("; ")}` : ""}\n\nWrite ${short ? "ONE sentence" : "one or two sentences"} that answer the question directly, using only what the statements say. Rules: no numbers or years at all; say "projected" for projections and "measured" for observations; name no cause or effect that is not in the statements; no greeting.` },
      ] }),
    });
    if (r.ok) {
      const j = await r.json();
      usage.in += j.prompt_eval_count ?? 0; usage.out += j.eval_count ?? 0;
      lead = (j.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").replace(/\*\*/g, "").split(/(?<=[.!?])\s+/).filter((s) => s.trim() && !/\d/.test(s) && /[.!?]$/.test(s.trim())).slice(0, 2).join(" ").trim();
    }
  } catch (e) { console.warn(`assistant lead: ${e.message}`); } // the statements stand on their own
  const sources = [...new Set(facts.map((r) => r.source).filter(Boolean))].join(", ");
  return { answer: [lead, body, missing.length ? `Not loaded in the portal: ${missing.join("; ")}` : "", sources ? `Source: ${sources}.` : ""].filter(Boolean).join("\n\n"), ok: true };
}

/** Ollama: the same loop against its /api/chat. A small model sometimes answers from memory; it is sent back once to look it up. */
async function viaOllama(history, model, used, usage) {
  const tools = toolDefs.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } }));
  const msgs = [{ role: "system", content: SYSTEM }, ...history];
  let nudged = false;
  const asked = history.at(-1).content, earlier = history.slice(0, -1).filter((m) => m.role === "user").map((m) => m.content);
  const short = /\b(short(er)?|brief(ly)?|concise|summar\w*|in (one|a) (line|sentence)|tl;?dr|quick(ly)?)\b/i.test(asked);
  const redo = short && earlier.length && asked.length < 160; // "make that shorter": the real questions are the ones before it
  const length = short ? "The user wants it short: at most 3 short sentences, the key figures only." : "Lead with the direct answer. At most 6 short sentences or \"-\" lines (about 110 words) unless the user asks for detail.";
  for (let i = 1; i < msgs.length - 1; i++) if (msgs[i].role === "assistant" && msgs[i].content.length > 500) msgs[i] = { ...msgs[i], content: `${msgs[i].content.slice(0, 500)}…` }; // old answers are context, not facts: keep them small
  const found = await retrieve(asked, LOCAL_TOOL_CHARS, earlier); // look up first: the model only has to read and explain
  if (found.length) {
    for (const f of found) used.push(f.name);
    const ready = await factsFirst(redo ? earlier.slice(-2).join(" ") : asked, found, short, model, usage);
    if (ready) return ready;
    msgs[msgs.length - 1] = { role: "user", content: `${history.at(-1).content}\n\n[Facts just looked up in the portal's data. Answer only from these. Give the figures that bear on the question with their source, year and units exactly as written, and whether each is observed or projected. Use the ready-made lowest / highest / average values; do no arithmetic of your own. If the facts answer only part of the question, give that part and name what is missing. Every claim must come from a statement below: name no cause, effect or impact that is not written there. Where a statement is a full sentence, use its figures and its condition together, in your own short wording. Add no general background and no closing disclaimer. Do not repeat field names.${earlier.length ? " If this is a follow-up, it refers to the earlier questions in this chat; answer it from the facts below." : ""}]\n${found.map((f) => `# ${f.name} ${JSON.stringify(f.input)}\n${f.result}`).join("\n\n")}\n\n[Now answer${redo ? ` these earlier questions again, briefly: ${earlier.slice(-2).join(" / ")}` : `: ${asked}`}\n${length}]` }; // the question and the length limit come last: a small model follows what it read most recently
  }
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const r = await fetch(`${OLLAMA_URL()}/api/chat`, {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(LOCAL_TIMEOUT),
      // with the facts already looked up, the tool definitions are left out: a shorter prompt, and one pass instead of several
      body: JSON.stringify({ model, messages: msgs, ...(found.length ? {} : { tools }), stream: false, think: false, options: { num_ctx: 6144, temperature: 0, num_predict: short ? 170 : 380, ...(THREADS() ? { num_thread: THREADS() } : {}) } }),
    });
    if (!r.ok) throw new Error(`Ollama ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json(), m = j.message ?? {};
    usage.in += j.prompt_eval_count ?? 0; usage.out += j.eval_count ?? 0;
    if (m.tool_calls?.length) {
      msgs.push(m);
      for (const c of m.tool_calls) {
        const name = c.function?.name, args = typeof c.function?.arguments === "string" ? JSON.parse(c.function.arguments || "{}") : c.function?.arguments;
        used.push(name);
        msgs.push({ role: "tool", tool_name: name, content: await runTool(name, args, LOCAL_TOOL_CHARS) });
      }
      continue;
    }
    const text = (m.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").replace(/\*\*/g, "").trim();
    if (!used.length && !nudged) { // no lookup at all: not allowed to answer from memory
      nudged = true;
      msgs.push({ role: "assistant", content: text }, { role: "user", content: "Do not answer from memory. Call a tool to look this up in the portal's data (start with list_datasets if unsure), then answer from what it returns." });
      continue;
    }
    return { answer: text || "I couldn't put an answer together. Please try rephrasing.", ok: !!text };
  }
  return null;
}

/** A greeting or a thank-you is answered here, at once: there is nothing to look up, and a local model takes a minute to say so. */
function smallTalk(question) {
  const s = question.toLowerCase().replace(/[^a-z' ]/g, " ").replace(/\s+/g, " ").trim();
  const topics = "mangroves, coastal erosion, ocean health, saltwater intrusion, sea level and plastics, or whether a layer is working";
  if (!s || /^(hi+|hello+|hey+|yo|salam|salaam|assalam ?o? ?alaikum|aoa|good (morning|afternoon|evening))( there| again)?( how are you| how r u)?$/.test(s) || /^how are you$/.test(s))
    return `Hello, I'm ${NAME}. I can look things up in the portal's data: ${topics}. What would you like to know?`;
  if (/^(who|what) (are|r) (you|u)( exactly| really)?$|^(what is|what's|whats|tell me) your name|^who is hela|^what is hela|^what are you called|^(are you|r u) (a |an )?(robot|ai|bot|human)|^who (made|built|created) you/.test(s))
    return `I'm ${NAME}, the assistant of this portal. I answer from the portal's own datasets (${topics}): I look each fact up in the database and say where it came from, instead of answering from memory. I run on an open language model on the team's own machine.`;
  if (/^what can you do|^help$|^what (do|can) (you|i) (know|ask)/.test(s)) return `I can look things up in the portal's data: ${topics}. Try "How has mangrove area changed since 1990?" or "What are the plastics levels at the Karachi stations?"`;
  if (/^(thanks|thank you|thankyou|thx|shukria|ok thanks|great thanks)( a lot| so much)?( hela)?$/.test(s)) return "You're welcome. Ask me anything else about the portal's data.";
  return null;
}
/** "Hey Hela, how are the mangroves?" → "how are the mangroves?": the name addresses the assistant and is not part of the question. */
const unaddressed = (q) => q.replace(new RegExp(`^\\s*((hey|hi|hello|ok|okay|yo|dear)[\\s,]+)?${NAME}\\b[\\s,!.:;-]*`, "i"), "").replace(new RegExp(`[\\s,]+${NAME}\\s*([?!.]*)\\s*$`, "i"), "$1");

export async function chat(rawMessages) {
  const messages = clean(rawMessages);
  if (!messages.length) return { status: 400, body: { ok: false, error: "Ask a question first." } };
  const p = await provider();
  if (!p.ready) return { status: 503, body: { ok: false, error: `The assistant is not switched on: ${p.hint}` } };

  const id = crypto.randomUUID(), started = Date.now(), used = [], usage = { in: 0, out: 0 };
  const question = messages.at(-1).content, asked = unaddressed(question);
  messages[messages.length - 1] = { ...messages.at(-1), content: asked || question };
  let answer = smallTalk(asked) ?? "", ok = true;
  if (!answer) try {
    const r = p.name === "anthropic" ? await viaClaude(messages, used, usage) : await viaOllama(messages, p.model, used, usage);
    if (r) ({ answer, ok } = r);
    else { answer = "That needed more lookups than I'm allowed in one question. Try asking about one dataset at a time."; ok = false; }
  } catch (e) {
    ok = false;
    answer = e instanceof Anthropic.AuthenticationError ? "The assistant's API key was rejected. Check ANTHROPIC_API_KEY in .env."
      : e instanceof Anthropic.RateLimitError ? "The assistant is busy right now. Try again in a minute."
      : e instanceof Anthropic.APIError ? `The assistant service returned an error (${e.status}). Try again shortly.`
      : e.name === "TimeoutError" ? "The local model took too long to answer. Try a shorter question, or a smaller / faster model."
      : "The assistant could not answer just now.";
    console.warn(`assistant: ${e.message}`);
  }
  try {
    await ensureTables();
    await query("insert into assistant_chat (id, question, answer, tools, model, input_tokens, output_tokens, ms, ok) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [id, question, answer, JSON.stringify(used), `${p.name}:${p.model}`, usage.in, usage.out, Date.now() - started, ok]);
  } catch (e) { console.warn(`assistant log: ${e.message}`); }
  return { status: 200, body: { ok, id, answer, tools: [...new Set(used)] } };
}

export async function feedback({ id, rating, comment }) {
  if (!/^[0-9a-f-]{36}$/.test(String(id)) || ![1, -1].includes(rating)) return { status: 400, body: { ok: false } };
  await ensureTables();
  const r = await query("insert into assistant_feedback (chat_id, rating, comment) select $1, $2, $3 where exists (select 1 from assistant_chat where id = $1)", [id, rating, String(comment ?? "").slice(0, 1000) || null]);
  return { status: r.rowCount ? 200 : 404, body: { ok: !!r.rowCount } };
}
