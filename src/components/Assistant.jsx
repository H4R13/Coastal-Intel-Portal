/**
 * The assistant button (a robot face under the map toggles) and the warnings it raises when the portal opens.
 *   <AssistantButton />   the button; clicking it opens the chat above it (see Chat, and server/assistant for how it answers)
 *   announce()            lights the button up and shows three warnings for 4.1 seconds
 * The warnings are worked out from the portal's own data at that moment (see WARNINGS): each is a number the team's
 * datasets already contain, with its year and what kind of number it is. A warning whose data is not available is
 * left out; nothing is made up to fill the gap.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PRESENT_YEAR } from "../config/layers.js";
import { Icon } from "../lib.jsx";

const SHOW_MS = 4100;
const ROBOT = '<rect x="4" y="7.5" width="16" height="12" rx="3.5"/><path d="M12 7.5V4.2"/><circle cx="12" cy="3.3" r="1.1"/><circle cx="9" cy="12.6" r="1.25" fill="currentColor"/><circle cx="15" cy="12.6" r="1.25" fill="currentColor"/><path d="M9.3 16.2h5.4M2.2 12v3.5M21.8 12v3.5"/>';
const get = (url) => fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);
const at = (series, year) => { const i = series?.year.indexOf(year) ?? -1; return i < 0 ? null : series.p50[i]; };
const n = (v, d = 0) => (+v.toFixed(d)).toLocaleString("en");

/* Each returns { when, title, text } or null. `when` is the year the number is about; the three soonest are shown. */
const WARNINGS = [
  async () => { // marine heatwaves: measured days per year (the package's own five-year figure and top year)
    const summary = await get("api/ocean/data/mhw_summary");
    const now = summary?.find((r) => r.region === "Whole EEZ" && r.definition === "fixed");
    if (!now) return null;
    return { when: PRESENT_YEAR, title: "Marine heatwaves · now", text: `${n(now.days_last5)} heatwave days a year over the last five years; ${n(now.days_mean_1991_2020)} was normal for 1991–2020. Worst years: ${now.top3_years_days}.` };
  },
  async () => { // coastal erosion: the team's projection of land lost
    const d = await get("api/layers/erosion/series"), mapped = d?.series.find((s) => s.name === "Mapped")?.points.at(-1), proj = d?.series.find((s) => s.name === "Projected")?.points;
    const by = proj?.find((p) => p.x === 2030);
    if (!mapped || !by) return null;
    return { when: 2030, title: "Coastal erosion · by 2030", text: `A further ${n(by.y - mapped.y)} km² of land projected lost to the sea, about ${n((by.y - mapped.y) / (2030 - mapped.x))} km² a year.` };
  },
  async () => { // fresh groundwater under the Indus Delta: modelled usable area
    const d = await get("api/amib/series/C"), s = d?.["usable fresh-lens area (P >= 0.7)"]?.series.find((x) => x.scenario === "current ssp245");
    const a = at(s, PRESENT_YEAR), b = at(s, 2030);
    if (a == null || b == null || b >= a) return null;
    return { when: 2030, title: "Fresh groundwater, Indus Delta · by 2030", text: `Usable fresh groundwater modelled to shrink from ${n(a)} to ${n(b)} km² (medium emissions, river flow as today).` };
  },
  async () => { // sea level at the delta, including land sinking
    const d = await get("api/amib/series/D"), s = d?.["relative sea-level rise (AR6 climate + InSAR land motion)"]?.series.find((x) => x.zone === "indus_delta" && x.scenario === "ssp245");
    const b = at(s, 2050);
    if (b == null) return null;
    return { when: 2050, title: "Sea level, Indus Delta · by 2050", text: `${n(b * 100)} cm of rise relative to the land (1995–2014 level), medium emissions, land sinking included.` };
  },
];

let raise = null; // set by the mounted button: shows the warnings

/** Light the button up and show the three soonest warnings, all at once, for 4.1 seconds. */
export async function announce() {
  if (!raise) return;
  const found = (await Promise.all(WARNINGS.map((w) => w().catch(() => null)))).filter(Boolean).sort((a, b) => a.when - b.when).slice(0, 3);
  raise?.(found);
}

/** A box fixed to the page above the button: the sidebar clips anything inside it. */
function Above({ button, gap, children, ...rest }) {
  const box = useRef(null);
  useLayoutEffect(() => {
    const r = button.current.getBoundingClientRect();
    box.current.style.left = `${Math.round(r.left)}px`;
    box.current.style.bottom = `${Math.round(window.innerHeight - r.top + gap)}px`;
  });
  return createPortal(<div ref={box} {...rest}>{children}</div>, document.body);
}

const STARTERS = [
  "How has mangrove area changed since 1990?",
  "Are all the portal's layers working?",
  "Which saline water intrusion maps failed to load recently?",
  "What does the data say about plastics at Karachi stations?",
];
const post = (url, body) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  .then((r) => r.json().catch(() => ({ ok: false, error: "The server sent something unreadable." })))
  .catch(() => ({ ok: false, error: "Could not reach the portal server." }));

/** A line with web addresses in it (news headlines): each address becomes a link that opens in a new tab. */
function Linked({ text }) {
  return String(text).split(/(https?:\/\/\S+)/).map((part, i) => (/^https?:\/\//.test(part) ? <a key={i} href={part} target="_blank" rel="noreferrer">open story</a> : part));
}
/** An answer as paragraphs: "- " lines become a list, the "Source:" line is set small, and what is not loaded is set apart. */
function Answer({ text }) {
  return String(text).split(/\n{2,}/).map((block, i) => {
    const lines = block.split("\n"), items = lines.filter((l) => l.startsWith("- ")), head = lines.filter((l) => !l.startsWith("- ")).join("\n");
    const kind = /^Source:/.test(head) ? "src" : /^Not loaded in the portal:/.test(head) ? "none" : "";
    return <div key={i} className={`bc-par ${kind}`}>{kind ? head : <Labelled text={head} />}{items.length ? <ul>{items.map((l, j) => <li key={j}>{/https?:\/\//.test(l) ? <Linked text={l.slice(2)} /> : <Labelled text={l.slice(2)} />}</li>)}</ul> : null}</div>;
  });
}
/** "Karachi (2 stations): plastic debris is ..." → the label before the colon in bold, so a long answer can be scanned. */
function Labelled({ text }) {
  const at = text.indexOf(": ");
  return at > 2 && at <= 40 && !/[.?!]/.test(text.slice(0, at)) ? <><b>{text.slice(0, at + 1)}</b>{text.slice(at + 1)}</> : text;
}

/* Call mode: speak to Hela and hear the answer. Hearing is the browser's own speech recognition (Edge, Chrome); her voice is
   ElevenLabs through the portal server when a key is set there, and the browser's built-in voice otherwise. */
const Recognition = typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
/* Names of the browsers' built-in English voices, by who is speaking (the browser does not say which are women's). Used when no ElevenLabs key is set. */
const WOMEN = /Sonia|Libby|Neerja|Aria|Jenny|Michelle|Ava|Emma|Maisie|Natasha|Clara|Zira|Hazel|Susan|Heera|Samantha|Female/i;
const MEN = /Ryan|Thomas|Guy|Davis|Christopher|Eric|Roger|Steffan|Andrew|Brian|Prabhat|William|Liam|David|Mark|George|Ravi|James|Daniel|\bMale\b/i;
if (typeof window !== "undefined") window.speechSynthesis?.getVoices(); // asks the browser to load its voice list early: the first call otherwise finds it empty
const LANGS = [["en-IN", "English"], ["ur-PK", "اردو"]]; // what the user speaks; Hela answers in English either way
/* The portal's own words. Of the browser's guesses at what was said, the first one holding one of these wins ("salinity" over "serenity"). */
const PORTAL_WORDS = /salin|salt|mangrove|erosion|plastic|metal|cadmium|chromium|groundwater|sea level|heat ?wave|temperature|acid|aragonite|oxygen|fish|delta|indus|kotri|karachi|thatta|sujawal|korangi|station|layer|timeline/i;
/** The best reading of one stretch of speech: the browser's first guess, unless a later one names something the portal holds. */
const bestGuess = (result) => { const all = Array.from(result); return (all.find((a) => PORTAL_WORDS.test(a.transcript)) ?? all[0]).transcript; };
const PHONE = '<path d="M21.5 16.6v2.9a2 2 0 0 1-2.2 2 19.5 19.5 0 0 1-8.5-3 19.2 19.2 0 0 1-5.9-5.9A19.5 19.5 0 0 1 1.9 4 2 2 0 0 1 3.9 1.8h2.9a2 2 0 0 1 2 1.7c.1.9.4 1.9.7 2.7a2 2 0 0 1-.5 2.1L7.8 9.5a16 16 0 0 0 6.7 6.7l1.2-1.2a2 2 0 0 1 2.1-.5c.8.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>';

/** The chat: each answer comes from the portal's own datasets (server/assistant) and can be rated; ratings are stored. */
function Chat({ button, onClose }) {
  const [msgs, setMsgs] = useState([]), [text, setText] = useState(""), [busy, setBusy] = useState(false), [ready, setReady] = useState(null);
  const [hint, setHint] = useState(""), [why, setWhy] = useState(null); // hint: why the assistant is off; why: id of an answer being marked unhelpful, and the reason typed so far
  const end = useRef(null);
  const [modelOff, setModelOff] = useState(false); // the language model is unreachable: answers written from the data still work, open questions do not
  /* the call: phase is what Hela is doing ("listening", "thinking", "speaking"); heard is what has been made out of the user's speech so far */
  const [call, setCall] = useState(false), [phase, setPhase] = useState(""), [heard, setHeard] = useState(""), [lang, setLang] = useState(0), [note, setNote] = useState("");
  const live = useRef({ on: false, rec: null, audio: null, done: null, lang: 0, eleven: false, msgs: [], busy: false }); // what the call's callbacks need as it is now, not as it was when they were made
  live.current.msgs = msgs; live.current.lang = lang;
  useEffect(() => { get("api/assistant/status").then((s) => { setReady(s?.ready ?? false); setHint(s?.hint ?? ""); setModelOff(!!s?.ready && s.model_ready === false); }); }, []);
  useEffect(() => { get("api/assistant/voice").then((v) => { live.current.eleven = !!v?.elevenlabs; }); return hangUp; }, []); // leaving the chat ends the call
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs, busy, why, phase]);

  /** Ask one question; `voice` marks it as spoken, so the answer comes short and with a version to say aloud. Returns the server's reply. */
  async function ask(q, voice = false) {
    q = q.trim();
    if (!q || live.current.busy) return null;
    const next = [...live.current.msgs, { role: "user", content: q }];
    live.current.busy = true; live.current.msgs = next;
    setMsgs(next); setText(""); setBusy(true);
    const r = await post("api/assistant/chat", { messages: next.filter((m) => !m.error).map(({ role, content }) => ({ role, content })), ...(voice ? { voice: true } : {}) });
    live.current.busy = false;
    setBusy(false);
    setMsgs([...next, r.answer ? { role: "assistant", content: r.answer, id: r.id, tools: r.tools, error: !r.ok } : { role: "assistant", content: r.error ?? "No answer.", error: true }]);
    return r;
  }
  async function rate(m, rating, comment) {
    setMsgs((all) => all.map((x) => (x === m ? { ...x, rating } : x)));
    await post("api/assistant/feedback", { id: m.id, rating, comment });
  }

  /* ---- the call ---- */
  /** Say the answer aloud and resolve when it has been said (or cut short by `quiet`). */
  function say(reply) {
    return new Promise((resolve) => {
      const c = live.current, words = reply?.spoken || reply?.answer || reply?.error || "";
      if (!words) return resolve();
      c.done = resolve;
      const own = () => { // the browser's built-in voice: no key needed, and the fallback when ElevenLabs cannot be reached
        const synth = window.speechSynthesis;
        if (!synth) { setNote("This browser has no voice of its own, so the answer is shown but not spoken."); return resolve(); }
        const u = new SpeechSynthesisUtterance(words), voices = synth.getVoices();
        /* a woman's English voice: Edge's natural voices first, then any other known female voice, then any English voice that is not a known male one */
        const english = voices.filter((v) => /^en/i.test(v.lang)), natural = (v) => /natural/i.test(v.name);
        const voice = english.find((v) => /Sonia/i.test(v.name)) ?? english.find((v) => /en-GB/i.test(v.lang) && WOMEN.test(v.name)) // Sonia (British), the voice the user chose; another British woman if she is not installed
          ?? english.find((v) => WOMEN.test(v.name) && natural(v)) ??english.find((v) => WOMEN.test(v.name)) ?? english.find((v) => !MEN.test(v.name)) ?? english[0];
        if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = "en-US";
        u.rate = 1.03; u.onend = u.onerror = () => { clearTimeout(giveUp); resolve(); };
        const giveUp = setTimeout(resolve, 4000 + words.length * 95); // some browsers never report the end of a long sentence: do not wait for ever
        if (synth.speaking || synth.pending) synth.cancel(); // cancelling when nothing is being said makes Chrome drop the next sentence
        setTimeout(() => { synth.resume(); synth.speak(u); }, 80);
      };
      if (!c.eleven || !reply?.id) return own();
      fetch("api/assistant/speak", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: reply.id }) })
        .then((r) => (r.ok ? r.blob() : Promise.reject(new Error("no audio")))).then((blob) => {
          if (!c.on) return resolve();
          const url = URL.createObjectURL(blob), a = new Audio(url);
          c.audio = a; a.onended = a.onerror = () => { URL.revokeObjectURL(url); c.audio = null; resolve(); };
          a.play().catch(own);
        }).catch(own);
    });
  }
  /** Stop speaking now (the user tapped to cut in, or hung up). */
  function quiet() {
    const c = live.current;
    if (c.audio) { c.audio.pause(); c.audio = null; }
    window.speechSynthesis?.cancel();
    c.done?.(); c.done = null;
  }
  /** Listen for one thing said; when the user stops, answer it, say the answer, and listen again. */
  function listen() {
    const c = live.current;
    if (!c.on) return;
    let said = "";
    const rec = new Recognition();
    c.rec = rec; rec.lang = LANGS[c.lang][0]; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 5;
    rec.onresult = (e) => { said = Array.from(e.results).map(bestGuess).join(" "); setHeard(said); };
    rec.onerror = (e) => { if (e.error === "not-allowed" || e.error === "service-not-allowed") { setNote("The microphone is blocked for this page. Allow it in the browser's address bar, then start the call again."); hangUp(); } else if (e.error === "network") { setNote("Speech recognition could not reach its service. Check the internet connection."); hangUp(); }
      else if (e.error === "audio-capture") { setNote("No microphone was found. Plug one in or pick one in the browser's settings, then start the call again."); hangUp(); }
      else if (e.error === "language-not-supported") { setNote(`This browser cannot listen in ${LANGS[c.lang][1]}. Switch the language button and try again.`); }
      else if (e.error !== "no-speech" && e.error !== "aborted") setNote(`Listening stopped (${e.error}).`); };
    rec.onend = async () => {
      if (!c.on || c.rec !== rec) return;
      if (!said.trim()) return listen(); // silence: the browser stops listening after a few seconds, so start again
      setPhase("thinking"); setHeard("");
      const reply = await ask(said, true);
      if (!c.on) return;
      setPhase("speaking");
      await say(reply);
      if (c.on) listen();
    };
    setPhase("listening"); setHeard("");
    try { rec.start(); } catch { /* already started */ }
  }
  function startCall() {
    setNote("");
    if (!Recognition) return setNote("Voice calls need Microsoft Edge or Google Chrome: this browser cannot turn speech into text.");
    live.current.on = true; setCall(true); setPhase("speaking");
    say({ spoken: "Hello, I'm Hela. Go ahead." }).then(() => { if (live.current.on) listen(); }); // said at once, on the click: it shows the sound works, and browsers only let a page speak after a click
  }
  function hangUp() {
    const c = live.current;
    c.on = false;
    try { c.rec?.abort(); } catch { /* not running */ }
    c.rec = null; quiet(); setCall(false); setPhase(""); setHeard("");
  }
  function switchLang() { // takes effect at once: what is being listened to is dropped and listening starts again in the other language
    const c = live.current, to = (c.lang + 1) % LANGS.length;
    c.lang = to; setLang(to);
    if (c.on && phase === "listening") { const old = c.rec; c.rec = null; try { old?.abort(); } catch { /* not running */ } listen(); }
  }

  return (
    <Above button={button} gap={12} className="bot-chat" role="dialog" aria-label="Hela, the portal assistant" onClick={(e) => e.stopPropagation()}>
      <div className="bc-head"><b>Hela</b><span>Answers come from the portal's datasets</span>
        <button className={`bc-call ${call ? "on" : ""}`} aria-label={call ? "End the call" : "Talk to Hela"} title={call ? "End the call" : "Talk to Hela"} disabled={ready === false} onClick={call ? hangUp : startCall}><Icon width={1.7} paths={PHONE} /></button>
        <button className="bc-x" aria-label="Close" onClick={onClose}>×</button></div>
      <div className="bc-log">
        {!msgs.length ? (
          <div className="bc-start">
            {ready === false ? <p className="bc-warn">Hela isn't switched on yet. {hint}</p> : <p>I'm Hela. Ask me about mangroves, erosion, ocean health, saline water intrusion or plastics, or whether a layer is working. Press the phone to talk instead of typing.</p>}
            {modelOff ? <p className="bc-warn">The language model is not reachable, so I can only answer questions the portal's data covers directly. {hint}</p> : null}
            {STARTERS.map((s) => <button key={s} className="bc-chip" disabled={ready === false} onClick={() => ask(s)}>{s}</button>)}
          </div>
        ) : null}
        {msgs.map((m, i) => (
          <div key={i} className={`bc-msg ${m.role} ${m.error ? "err" : ""}`}>
            <div className="bc-text">{m.role === "assistant" ? <Answer text={m.content} /> : m.content}</div>
            {m.role === "assistant" && m.id ? (
              <div className="bc-rate">
                {m.tools?.length ? <span className="bc-src" title="Tools used to find this">from: {m.tools.join(", ")}</span> : null}
                {m.rating ? <span className="bc-thanks">{m.rating > 0 ? "Thanks, noted." : "Thanks, that helps us fix it."}</span> : (
                  <>
                    <button aria-label="Helpful" title="Helpful" onClick={() => rate(m, 1)}>👍</button>
                    <button aria-label="Not helpful" title="Not helpful" onClick={() => setWhy({ id: m.id, text: "" })}>👎</button>
                  </>
                )}
              </div>
            ) : null}
            {why && why.id === m.id && !m.rating ? (
              <form className="bc-why" onSubmit={(e) => { e.preventDefault(); rate(m, -1, why.text); setWhy(null); }}>
                <input autoFocus value={why.text} placeholder="What was wrong? (optional)" maxLength={500} onChange={(e) => setWhy({ ...why, text: e.target.value })} />
                <button type="submit">Send</button>
              </form>
            ) : null}
          </div>
        ))}
        {busy ? <div className="bc-msg assistant"><div className="bc-text bc-wait">Looking it up in the data</div></div> : null}
        <div ref={end} />
      </div>
      {note ? <p className="bc-note">{note}</p> : null}
      {call ? (
        <div className={`bc-voice ${phase}`}>
          <i className="bc-dot" aria-hidden="true" />
          {phase === "speaking" ? <button className="bc-vtext" onClick={quiet} title="Stop her and speak">Speaking… tap to cut in</button>
            : <span className="bc-vtext" aria-live="polite">{phase === "thinking" ? "Looking it up…" : heard || "Listening… go ahead"}</span>}
          <button className="bc-lang" title="The language you speak" onClick={switchLang}>{LANGS[lang][1]}</button>
          <button className="bc-end" onClick={hangUp}>End</button>
        </div>
      ) : null}
      <form className="bc-in" onSubmit={(e) => { e.preventDefault(); ask(text); }}>
        <input value={text} placeholder={ready === false ? "Hela is not switched on" : call ? "…or type here" : "Ask Hela…"} maxLength={2000} disabled={busy || ready === false} onChange={(e) => setText(e.target.value)} />
        <button type="submit" disabled={busy || !text.trim() || ready === false}>Ask</button>
      </form>
    </Above>
  );
}

export function AssistantButton() {
  const button = useRef(null);
  const [bubble, setBubble] = useState(false), [lit, setLit] = useState(false), [alerts, setAlerts] = useState(null); // alerts: { list, out }

  useEffect(() => {
    const timers = [];
    raise = (found) => {
      setLit(true);
      timers.push(setTimeout(() => setLit(false), SHOW_MS + 600));
      if (!found.length) return;
      setAlerts({ list: found, out: false });
      timers.push(setTimeout(() => setAlerts((a) => a && { ...a, out: true }), SHOW_MS), setTimeout(() => setAlerts(null), SHOW_MS + 400));
    };
    return () => { raise = null; timers.forEach(clearTimeout); };
  }, []);
  useEffect(() => {
    if (!bubble) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setBubble(false); }; // the chat stays open while you use the map; Esc, × or the button closes it
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [bubble]);

  return (
    <>
      <button className={`bot-btn ${lit ? "lit" : ""}`} aria-label="Hela, the portal assistant" title="Hela" ref={button} onClick={(e) => { e.stopPropagation(); setBubble(!bubble); }}><Icon width={1.6} paths={ROBOT} /></button>
      {bubble ? <Chat button={button} onClose={() => setBubble(false)} /> : null}
      {alerts ? (
        <Above button={button} gap={14} className={`bot-alerts ${alerts.out ? "out" : ""}`} role="alert">
          {alerts.list.map((w, i) => <div className="bot-alert" key={w.title} style={{ "--i": i }}><b>{w.title}</b><span>{w.text}</span></div>)}
        </Above>
      ) : null}
    </>
  );
}
