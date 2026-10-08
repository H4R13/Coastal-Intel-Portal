/**
 * Time control: a year slider with play / pause over the active mode's range.
 * It only moves state.year; map layers and charts read that year. The range past PRESENT_YEAR is hatched as forecast.
 * Hovering the play button shows two bubbles above it: twice the speed, and loop (start over at the last year).
 */
import { useEffect } from "react";
import { PRESENT_YEAR } from "../config/layers.js";
import { getState, setState, setYear, modeRange, useStore } from "../state.js";
import { Icon } from "../lib.jsx";

const STEP_MS = 700; // one year per step while playing (halved at 2× speed)
const THUMB = 14;    // px, must match .tl-range thumb width so ticks line up with the thumb centre
const PLAY = '<path d="M8 5.5v13l11-6.5Z"/>', PAUSE = '<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/>';
const LOOP = '<path d="M17 2.5 20.5 6 17 9.5"/><path d="M3.5 11V9.5A3.5 3.5 0 0 1 7 6h13.5"/><path d="M7 21.5 3.5 18 7 14.5"/><path d="M20.5 13v1.5A3.5 3.5 0 0 1 17 18H3.5"/>';
const at = (f) => `calc(${THUMB / 2}px + (100% - ${THUMB}px) * ${f})`;

function ticks(from, to) {
  const out = [from];
  for (let y = Math.ceil((from + 1) / 10) * 10; y < to; y += 10) if (y - from >= 4 && to - y >= 4) out.push(y);
  out.push(to);
  return out;
}

function step() {
  const s = getState(), { from, to } = modeRange();
  if (s.year < to) setYear(s.year + 1);
  else if (s.loop) setYear(from);
  else setState({ playing: false });
}

export function Timeline() {
  const mode = useStore((s) => s.mode), year = useStore((s) => s.year), playing = useStore((s) => s.playing);
  const speed = useStore((s) => s.speed), loop = useStore((s) => s.loop), anyOnMap = useStore((s) => s.activeLayers.length > 0);
  const { from, to } = modeRange(mode);
  const f = (y) => (y - from) / (to - from);

  useEffect(() => { // one year per step while playing; restarted when the speed changes
    if (!playing) return undefined;
    const timer = setInterval(step, STEP_MS / speed);
    return () => clearInterval(timer);
  }, [playing, speed]);

  const phase = year < PRESENT_YEAR ? "Historical" : year === PRESENT_YEAR ? "Present" : "Forecast";
  const play = () => {
    const st = getState(), r = modeRange();
    if (st.playing) return setState({ playing: false });
    setState({ playing: true, year: st.year >= r.to ? r.from : st.year }); // at the end, play starts over
  };
  return (
    <div className="timeline" id="timeline">
      <div className="tl-head">
        <div className="tl-playwrap">
          <div className="tl-bubbles" role="group" aria-label="Playback options">
            <button className="tl-bub" id="tlSpeed" aria-pressed={speed === 2} title="Play twice as fast" onClick={() => setState({ speed: speed === 2 ? 1 : 2 })}>2×</button>
            <button className="tl-bub" id="tlLoop" aria-pressed={loop} title="Start over at the end" onClick={() => setState({ loop: !loop })}><Icon width={2} paths={LOOP} /></button>
          </div>
          <button className={`tl-play ${speed === 2 ? "fast" : ""} ${loop ? "looping" : ""}`} id="tlPlay" aria-label={playing ? "Pause" : "Play through the years"} onClick={play}><Icon filled paths={playing ? PAUSE : PLAY} /></button>
        </div>
        <div className="tl-now"><strong id="tlYear">{year}</strong><span className="tl-badge" id="tlBadge" data-phase={phase.toLowerCase()}>{phase}</span></div>
        <span className="tl-note" id="tlNote">{anyOnMap ? "Map layers and charts follow this year" : "Switch a layer on to see it change"}</span>
      </div>
      <div className="tl-track">
        {to > PRESENT_YEAR ? <span className="tl-zone" style={{ left: at(f(Math.max(from, PRESENT_YEAR))) }} title="Forecast period" /> : null}
        <input className="tl-range" id="tlRange" type="range" min={from} max={to} step="1" aria-label="Year" value={year}
          onChange={(e) => { if (getState().playing) setState({ playing: false }); setYear(+e.target.value); }} />
        {ticks(from, to).map((y) => <span className="tl-tick" key={y} style={{ left: at(f(y)) }}><i /><em>{y}</em></span>)}
      </div>
    </div>
  );
}
