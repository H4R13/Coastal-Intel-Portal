/**
 * Hela's own views: "what do you think of the layout?", "how would you arrange the charts?", "should we worry about salinity?".
 *   wantsView(question)                         true when the question asks for her opinion, advice or a suggestion
 *   opinion(history, model, usage, { voice })   → { answer, tools } or null when the model gave nothing usable
 * The view is written by the local model, so it carries no figures: every sentence with a digit in it is dropped before it is
 * shown (the model moves numbers between items, see CLAUDE.md). When the question also names one of the portal's subjects,
 * the figures come first, from answers.mjs as always, and the view follows them, marked as a view.
 */
import { answerDirect } from "./answers.mjs";
import { tidy, TOPIC } from "./understand.mjs";

const OLLAMA_URL = () => (process.env.OLLAMA_URL || "http://localhost:11434").replace(/\/$/, "");

/* Asking for her view, advice or ideas. "do you think" and "should" questions are views; "what does the map show" is not. */
const VIEW = /\b(your|ur|you|yr) (own |personal |honest )?(opinion|opinions|view|views|thoughts?|take|advice|suggestions?|recommendations?|ideas?|favou?rite|verdict|impression)\b|\b(give|share|tell|say|want|ask for|hear|got|have) (me |us )?(an |any |some )?opinions?\b|\bwhat (do|would) (you|u) (think|feel|reckon|suggest|recommend|make of|change|add|do|prefer)\b|\bdo (you|u) (think|feel|like|believe|prefer|agree|recommend|suggest)\b|\bhow (do|would) (you|u) (feel|rate|judge|improve|arrange|organi[sz]e|redesign|present|display|lay|change|explain)\b|\bwould (you|u) (change|add|improve|arrange|recommend|suggest|remove|move)\b|\bif (you|u) (were|could|had to)\b|\bin your (view|opinion)\b|\b(any|some|give me|got) (ideas|suggestions?|advice|recommendations?|tips)\b|\bwhat should (we|i|the team|be done)\b|\bshould (we|i|the team|it|they|the portal)\b|\bhow (can|could|should|would)\b[^?.]{0,50}\b(improv|better|arrang|rearrang|organi[sz]|present|display|redesign|lay ?out|laid out|show)\w*|\bcan be (arranged|organi[sz]ed|laid out|improved|presented|displayed|shown) better\b|\bis (it|this|that) a good idea\b|\bwhat('?s| is) the best way to (show|present|display|arrange|explain|organi[sz]e|use)\b|\b(rate|review|critique|judge) (the|this) (portal|site|layout|design|map|dashboard|interface)\b/;
/* "why?", "like what?", "anything else?" straight after a question asking for her view: still a view */
const AGAIN = /^\s*(why|why not|how come|how so|really|are you sure|in what way|like what|such as|for example|anything else|what else|and|but|go on|explain|elaborate|tell me more|more|what about)\b/;
/** True when the question asks for her view, or follows one up ("why?"). `earlier`: the questions before it, latest last. */
export const wantsView = (question, earlier = []) => VIEW.test(tidy(question)) || (String(question).length < 70 && AGAIN.test(tidy(question)) && !TOPIC.test(tidy(question)) && earlier.length > 0 && VIEW.test(tidy(earlier.at(-1))));

/* Effects on people and nature the portal's data does not hold (CLAUDE.md: the model "listed effects (livestock, fish catch) that are not
   in the data"). A sentence naming one is dropped unless the facts given to the model name it too. */
const EFFECTS = /storms?|cyclones?|flood\w*|extreme weather|agricultur\w*|crops?|farm\w*|livestock|cattle|drinking|health|diseases?|tourism|incomes?|livelihoods?|econom\w*|migrat\w*|displace\w*|poverty|food security|biodiversity|marine life|wildlife|habitats?|corals?|turtles?|dolphins?|birds?|fish catch|catches|jobs|deaths?|casualt\w*|deforest\w*|logging|tree cutting|overfish\w*|dams?\b|sewage|industr\w*|more (frequent|severe|intense|common)|getting worse|becoming worse|worsening/gi; // causes the data does not hold, likewise

/* The portal as a visitor sees it, for views on its design. Written from the components and the guided tour (src/components/Tour.jsx); states no values. */
const PORTAL = `The portal (PCOP, Pakistan Coastal Observation & Projection) is one web page for Pakistan's coast, from Jiwani to the Indus Delta, 1990 to 2050:
- Left: a dock of nine layer icons that grow under the mouse (sea level, saline water intrusion, salinity index, coastal hazards, mangroves, coastal erosion, plastics, fisheries, ocean). Clicking an icon opens that layer and puts it on the map; one layer is on the map at a time, so another icon replaces it, and clicking the same icon again takes it off. Earth view and Reset view clear the map. Hela's robot button sits at the bottom, next to the legend.
- Ocean and Fisheries open the ocean monitoring package (acidity, shell-building conditions, oxygen, warming, fish stocks and shell-builders, climate exposure, the national index): the layer icons then lie in a row above its own year slider (observed years, then 2030, 2040 and 2050 under the chosen scenario), its layer list fills the left side above its legend, a title card and tools (opacity, compare with the normal side by side, measurement points) sit at the top, national numbers show as cards on the map, and the right panel holds its key findings, tables and charts (a chart opens in a movable window).
- Middle: the map (a globe that flies to the coast); it zooms and pans, and sampling points and areas can be clicked for their numbers. A legend on the map explains the colours of the layers that are on. Map tools sit on it, including the compass button for the guided tour. Both side panels can be hidden with handles.
- Right: the analysis panel for the selected layer: key indicators, charts (each can open full screen; mangroves has its area through time and the yearly gain / loss), short explanatory videos for some layers (mangroves, erosion, saline water), and for the saline water package ten hazards in four groups instead of hundreds of separate maps.
- Bottom: one timeline year for everything; maps and charts follow it. It runs from 1990 to 2050, and further for a layer whose chosen data goes further: to 2100 for sea-level rise, land falling below sea level and salt water under the coast, to 2090 for the future ocean. Years past the present are hatched: projections. Charts are bright up to the timeline year and faint after it. Playback steps a year every 0.7 seconds.
- Three emissions scenarios (low, medium, high) switch with keys 1, 2, 3 for every layer that has them.
- On start: an opening sequence, a terminal-style system check of the database, cache and layer data, then Hela's start-up warnings, each labelled measured, projected or modelled.
- Hela answers from the database in text or by voice call; figures always come from the data, never from the model.
Known weak points: during playback the timeline does not wait for a year's map picture to arrive, so maps can lag or stay blank on a slow server; failed pictures are not marked. The "About this portal" dialog still says no datasets are connected, which is out of date. The mangrove layer and the saline water package hold two mangrove datasets that disagree (one rising, one falling) and are not reconciled. The plastics material also exists as separate older pages.`;

const RULES = `You are Hela, the assistant of a coastal data portal for Pakistan. Here you give your own view, as asked: be direct and personal ("I'd...", "I think..."), take a position, and give the reason for it in plain words.
Rules:
1. No numbers at all: no figures, years, percentages, counts or units. Speak in words ("rising", "the larger of the two"). Any sentence with a number is deleted.
2. About the portal, only what is described below exists. Suggest changes freely, but never say the portal already has something that is not described.
3. About the coast, never state a fact that is not in the facts given with the question. Your view must agree with those facts: where two figures move in different directions, say so rather than calling the whole thing rising or falling. Name no effect on people or nature (storms, floods, crops, livestock, health, incomes, wildlife) unless the facts name it. If the facts are not enough to judge, say what you would want to know.
4. Be brief: at most three short sentences, or up to three "-" points for a list of suggestions. No headings, no bold, no closing offer of more help.
5. Do not say you are an AI or that you cannot have opinions: you were asked for yours, give it.`;

/**
 * Which way each figure in the facts moves, said in words for the model: it otherwise calls everything "rising" ("salinity is
 * rising" when the river's salt reaches further but the sea's salinity fell). Reads "from A ... to B" and "A in Y1 and B in Y2".
 */
export function trends(facts) {
  const said = [];
  for (const line of facts.split(/\n+/)) {
    const name = (line.match(/^(?:- )?([A-Z][^:]{2,60}):/)?.[1] ?? line.replace(/^- /, "").split(/[,(:]/)[0]).replace(/\s*\b(rose|fell|from|is|was)?\s*-?\d.*$/, "").trim().slice(0, 70);
    const nums = [...line.matchAll(/(-?\d[\d,]*(?:\.\d+)?)\s*(?:km²|km|psu|m|%|°C|pieces)?\s+in\s+(\d{4})|from\s+(-?\d[\d,]*(?:\.\d+)?)/g)].map((m) => +(m[1] ?? m[3]).replace(/,/g, ""));
    if (nums.length < 2 || !name) continue;
    const [a, b] = [nums[0], nums[1]];
    said.push(`${name}: ${b > a ? "goes up" : b < a ? "goes down" : "stays level"}`);
  }
  return said.length ? `${said.join("; ")}. Say which way each goes; do not call them all rising or all falling.` : "agree with them.";
}

/** One sentence each: the model's text cut at sentence ends, list items kept whole. */
const pieces = (text) => text.split(/\n+/).flatMap((line) => (/^\s*[-•*]\s/.test(line) ? [line.trim().replace(/^[•*]\s/, "- ")] : line.match(/[^.!?]+[.!?]+["')]*|[^.!?]+$/g) ?? [])).map((s) => s.trim()).filter(Boolean);

/**
 * The model's view, cleaned: markdown gone; dropped are sentences holding a digit (rule 1), sentences naming an effect that
 * `known` (the text the model was given) does not, and disclaimers; then cut to `most` sentences.
 */
export function clean(text, most = 3, known = "") {
  const plain = String(text).replace(/<think>[\s\S]*?<\/think>/g, "").replace(/\*\*|__|^#+\s*/gm, "").replace(/^\s*(my view|opinion|answer)\s*:\s*/i, "")
    .replace(/\be\.g\.,?/gi, "for example").replace(/\bi\.e\.,?/gi, "that is").replace(/\betc\./gi, "and so on").replace(/\bvs\./gi, "versus").trim(); // so the sentences are not cut at these dots
  const invented = (s) => (s.match(EFFECTS) ?? []).some((w) => !new RegExp(`\\b${w.slice(0, 5)}`, "i").test(known));
  const fine = (s) => (/^- /.test(s) || /[.!?]["')]*$/.test(s)) && !/\d/.test(s) && !invented(s) && !/\bas an ai\b|language model|i (do not|don'?t|cannot|can'?t) have (personal )?(opinions|views|feelings)/i.test(s); // finished, no figure, nothing invented, no disclaimer
  const all = pieces(plain);
  /* "This suggests..." after a dropped sentence points at nothing: it goes too */
  const kept = all.filter((s, i) => fine(s) && !(i > 0 && !fine(all[i - 1]) && /^(this|that|these|those|it|they|which)\b/i.test(s))).slice(0, most);
  if (kept.length && !/^- /.test(kept[0])) kept[0] = kept[0].replace(/^(however|but|additionally|also|moreover|furthermore|still|that said|on the other hand|in addition|in conclusion|overall|so)\b,?\s*/i, "").replace(/^./, (c) => c.toUpperCase()); // its first sentence was dropped
  const lines = []; // sentences of one paragraph run on; list items keep their own lines
  for (const s of kept) { if (/^- /.test(s) || !lines.length || /^- /.test(lines.at(-1))) lines.push(s); else lines[lines.length - 1] += ` ${s}`; }
  return lines.join("\n").trim();
}

/**
 * history: the chat so far ({ role, content }), the question last. The figures, when the question names a subject, come from
 * answerDirect; the model sees them, the portal description when the question is about the portal, and the last few turns.
 */
export async function opinion(history, model, usage, { voice = false } = {}) {
  const asked = history.at(-1).content, earlier = history.slice(0, -1).filter((m) => m.role === "user").map((m) => m.content);
  const q = tidy(asked);
  const about = /\b(portal|site|website|page|layout|design|interface|dashboard|screen|map|maps|layers?|dock|sidebar|panels?|charts?|graphs?|timeline|tour|intro|videos?|colou?rs?|legend|icons?|buttons?|menus?|hela|you|assistant|voice|data (is |are )?(shown|displayed|presented|arranged|laid out|organi[sz]ed))\b/.test(q) || /arrang|organi[sz]|layout|lay ?out|design|present|display/.test(q);
  /* a subject of the portal named, or carried over from the question before ("what should be done?" after one on plastics; answerDirect
     carries the topic): its figures, written from the database, are both the facts the view must agree with and the first part of the answer.
     Not the short form: it would drop a caveat such as the two mangrove datasets disagreeing. */
  const facts = (TOPIC.test(q) || (earlier.length && !about)) && !/^\s*(how|what|which)\b.*\b(arrang|organi[sz]|layout|design|display|present)/.test(q)
    ? await answerDirect(asked, earlier).catch(() => null) : null;
  const context = [about || !facts ? `The portal:\n${PORTAL}` : "", facts ? `Facts from the portal's database (the only facts you may rely on):\n${facts.answer}` : ""].filter(Boolean).join("\n\n");
  const turns = history.slice(-5, -1).map((m) => ({ role: m.role, content: m.content.length > 400 ? `${m.content.slice(0, 400)}…` : m.content }));
  const r = await fetch(`${OLLAMA_URL()}/api/chat`, {
    method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(90000),
    body: JSON.stringify({ model, stream: false, think: false, options: { num_ctx: 6144, temperature: 0.3, num_predict: voice ? 110 : 300 },
      messages: [{ role: "system", content: `${RULES}\n\n${context}` }, ...turns, { role: "user", content: `${asked}\n\n[Give your own view${voice ? " in two short sentences, to be spoken" : ""}. No numbers.${facts ? ` The figures are already on screen above your view: do not repeat or summarise them, give your judgement of them. Base it on the facts: ${trends(facts.answer)}` : ""}]` }] }),
  });
  if (!r.ok) throw new Error(`Ollama ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  usage.in += j.prompt_eval_count ?? 0; usage.out += j.eval_count ?? 0;
  const detail = /\b(details?|detailed|in depth|elaborate|everything|tell me more|explain (more|fully))\b/.test(q);
  const view = clean(j.message?.content ?? "", voice ? 2 : detail ? 6 : 3, `${context}\n${turns.map((m) => m.content).join("\n")}\n${asked}`);
  if (!view) return null;
  return facts
    ? { answer: `${facts.answer}\n\nMy view (not from the data): ${view}`, tools: [...facts.tools, "opinion"] }
    : { answer: view, tools: ["opinion"] };
}
