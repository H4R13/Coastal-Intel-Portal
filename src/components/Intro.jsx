/**
 * Opening sequence, shown on every page load. It waits behind an "Enter" button, because browsers only allow sound
 * after a click or key press; then: the NGT mark with "powered by NDMA" and the NDMA logo, then the portal's name,
 * whose letters arrive one by one and then rush past the viewer as streaks of blue light. Sound: introSound.js.
 * Once it is running, any key or click skips it; the speaker button turns the sound off (remembered for next time).
 *   <Intro onDone />   onDone is called when the sequence is over and the overlay has faded
 *   skipsIntro()       true when it is not shown at all (?nointro, or the visitor prefers reduced motion)
 * The timings live in src/styles.css (.intro …); the numbers below must match them.
 */
import { Fragment, useEffect, useRef, useState } from "react";
import { introSound } from "../introSound.js";
import { Icon } from "../lib.jsx";

const TITLE = "Coastal Environmental Intelligence Portal";
const MARK_MS = 3600, TITLE_MS = 3900, RUSH_MS = 2300, OUT_MS = 450; // RUSH_MS: when the name starts to rush, from the moment it appears
const MUTED_KEY = "introMuted";
const SPEAKER = '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/>', ON = '<path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.8 7.8 0 0 1 0 11"/>', OFF = '<path d="m16 9.5 5 5M21 9.5l-5 5"/>';

export const skipsIntro = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches || new URLSearchParams(location.search).has("nointro");

export function Intro({ onDone }) {
  const [gate, setGate] = useState(true), [titled, setTitled] = useState(false), [out, setOut] = useState(false), [armed, setArmed] = useState(false);
  const [muted, setMuted] = useState(() => { try { return localStorage.getItem(MUTED_KEY) === "1"; } catch { return false; } });
  const enter = useRef(null), sound = useRef(null), timers = useRef([]), over = useRef(false);

  useEffect(() => { enter.current?.focus(); return () => { timers.current.forEach(clearTimeout); sound.current?.stop(0.25); }; }, []);

  const finish = (fade = 1.4) => { // the last hit rings out as the portal appears
    if (over.current) return;
    over.current = true;
    timers.current.forEach(clearTimeout);
    sound.current?.stop(fade); sound.current = null;
    setOut(true);
    setTimeout(onDone, OUT_MS);
  };
  const start = (e) => {
    e.stopPropagation();
    setGate(false);
    sound.current = introSound({ markMs: MARK_MS, rushMs: MARK_MS + RUSH_MS, muted });
    timers.current.push(setTimeout(() => setTitled(true), MARK_MS), setTimeout(() => finish(), MARK_MS + TITLE_MS));
    // from here on any key or click skips; not armed at once, so the entering click or key cannot skip it
    timers.current.push(setTimeout(() => setArmed(true), 500));
  };
  useEffect(() => {
    if (!armed) return undefined;
    const skip = () => finish(0.25);
    window.addEventListener("keydown", skip);
    return () => window.removeEventListener("keydown", skip);
  }, [armed]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleMute = (e) => {
    e.stopPropagation();
    const next = !muted;
    try { localStorage.setItem(MUTED_KEY, next ? "1" : "0"); } catch { /* not remembered */ }
    setMuted(next);
    sound.current?.setMuted(next);
  };

  return (
    <div className={`intro ${gate ? "gate" : ""} ${titled ? "show-title" : ""} ${out ? "out" : ""}`} onClick={armed ? () => finish(0.25) : undefined}>
      <div className="intro-gate"><button className="intro-enter" ref={enter} onClick={start}><i /><i /><span>Enter</span></button><small>{TITLE}</small></div>
      <div className="intro-mark"><div className="intro-ngt" aria-label="NGT"><span>N</span><span>G</span><span>T</span></div><div className="intro-by">powered by <b>NDMA</b></div><img className="intro-logo" src="css/ndma-logo.png" alt="National Disaster Management Authority, Pakistan" /></div>
      <div className="intro-title" aria-label={TITLE}>
        {TITLE.split(" ").map((word, w) => <Fragment key={w}>{w ? " " : null}<span className="intro-word">{[...word].map((ch, i) => <i key={i} style={{ "--i": w * 6 + i }}>{ch}</i>)}</span></Fragment>)}
      </div>
      <div className="intro-streaks">{Array.from({ length: 26 }, (_, i) => <b key={i} style={{ "--x": `${(i * 37) % 100}%`, "--d": `${(i % 7) * 40}ms`, "--w": `${2 + (i % 5) * 3}px` }} />)}</div>
      <button className="intro-mute" aria-pressed={muted} title="Sound on or off" onClick={toggleMute}><Icon paths={SPEAKER + (muted ? OFF : ON)} /><span>{muted ? "Sound off" : "Sound on"}</span></button>
      <button className="intro-skip">Skip</button>
    </div>
  );
}
