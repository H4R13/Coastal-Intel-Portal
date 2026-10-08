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
  "Which saltwater intrusion maps failed to load recently?",
  "What does the data say about plastics at Karachi stations?",
];
const post = (url, body) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  .then((r) => r.json().catch(() => ({ ok: false, error: "The server sent something unreadable." })))
  .catch(() => ({ ok: false, error: "Could not reach the portal server." }));

/** An answer as paragraphs: "- " lines become a list, the "Source:" line is set small, and what is not loaded is set apart. */
function Answer({ text }) {
  return String(text).split(/\n{2,}/).map((block, i) => {
    const lines = block.split("\n"), items = lines.filter((l) => l.startsWith("- ")), head = lines.filter((l) => !l.startsWith("- ")).join("\n");
    const kind = /^Source:/.test(head) ? "src" : /^Not loaded in the portal:/.test(head) ? "none" : "";
    return <div key={i} className={`bc-par ${kind}`}>{kind ? head : <Labelled text={head} />}{items.length ? <ul>{items.map((l, j) => <li key={j}><Labelled text={l.slice(2)} /></li>)}</ul> : null}</div>;
  });
}
/** "Karachi (2 stations): plastic debris is ..." → the label before the colon in bold, so a long answer can be scanned. */
function Labelled({ text }) {
  const at = text.indexOf(": ");
  return at > 2 && at <= 40 && !/[.?!]/.test(text.slice(0, at)) ? <><b>{text.slice(0, at + 1)}</b>{text.slice(at + 1)}</> : text;
}

/** The chat: each answer comes from the portal's own datasets (server/assistant) and can be rated; ratings are stored. */
function Chat({ button, onClose }) {
  const [msgs, setMsgs] = useState([]), [text, setText] = useState(""), [busy, setBusy] = useState(false), [ready, setReady] = useState(null);
  const [hint, setHint] = useState(""), [why, setWhy] = useState(null); // hint: why the assistant is off; why: id of an answer being marked unhelpful, and the reason typed so far
  const end = useRef(null);
  const [modelOff, setModelOff] = useState(false); // the language model is unreachable: answers written from the data still work, open questions do not
  useEffect(() => { get("api/assistant/status").then((s) => { setReady(s?.ready ?? false); setHint(s?.hint ?? ""); setModelOff(!!s?.ready && s.model_ready === false); }); }, []);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs, busy, why]);

  async function ask(q) {
    q = q.trim();
    if (!q || busy) return;
    const next = [...msgs, { role: "user", content: q }];
    setMsgs(next); setText(""); setBusy(true);
    const r = await post("api/assistant/chat", { messages: next.filter((m) => !m.error).map(({ role, content }) => ({ role, content })) });
    setBusy(false);
    setMsgs([...next, r.answer ? { role: "assistant", content: r.answer, id: r.id, tools: r.tools, error: !r.ok } : { role: "assistant", content: r.error ?? "No answer.", error: true }]);
  }
  async function rate(m, rating, comment) {
    setMsgs((all) => all.map((x) => (x === m ? { ...x, rating } : x)));
    await post("api/assistant/feedback", { id: m.id, rating, comment });
  }
  return (
    <Above button={button} gap={12} className="bot-chat" role="dialog" aria-label="Hela, the portal assistant" onClick={(e) => e.stopPropagation()}>
      <div className="bc-head"><b>Hela</b><span>Answers come from the portal's datasets</span><button className="bc-x" aria-label="Close" onClick={onClose}>×</button></div>
      <div className="bc-log">
        {!msgs.length ? (
          <div className="bc-start">
            {ready === false ? <p className="bc-warn">Hela isn't switched on yet. {hint}</p> : <p>I'm Hela. Ask me about mangroves, erosion, ocean health, saltwater intrusion or plastics, or whether a layer is working.</p>}
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
      <form className="bc-in" onSubmit={(e) => { e.preventDefault(); ask(text); }}>
        <input value={text} placeholder={ready === false ? "Hela is not switched on" : "Ask Hela…"} maxLength={2000} disabled={busy || ready === false} onChange={(e) => setText(e.target.value)} />
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
