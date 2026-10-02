import { PRESENT_YEAR } from "../config/layers.js";
import { getState, subscribe, setState, setYear, modeRange } from "../state.js";

/**
 * Time control: a year slider with play / pause over the active mode's range.
 * It only moves state.year; map layers and charts read that year. The range past PRESENT_YEAR is hatched as forecast.
 */
const STEP_MS = 700; // one year per step while playing
const THUMB = 14;    // px, must match .tl-range thumb width so ticks line up with the thumb centre
const ico = (p) => `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${p}</svg>`;
const PLAY = ico('<path d="M8 5.5v13l11-6.5Z"/>'), PAUSE = ico('<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/>');

const at = (f) => `calc(${THUMB / 2}px + (100% - ${THUMB}px) * ${f})`;

function ticks(from, to) {
  const out = [from];
  for (let y = Math.ceil((from + 1) / 10) * 10; y < to; y += 10) if (y - from >= 4 && to - y >= 4) out.push(y);
  out.push(to);
  return out;
}

export function Timeline(root) {
  let built = null, timer = 0;
  let yearEl, badgeEl, playEl, rangeEl;

  function build(s) {
    const { from, to } = modeRange(s.mode);
    const f = (y) => (y - from) / (to - from);
    const zoneFrom = Math.max(from, PRESENT_YEAR);
    root.innerHTML = `
      <div class="tl-head">
        <button class="tl-play" id="tlPlay"></button>
        <div class="tl-now"><strong id="tlYear"></strong><span class="tl-badge" id="tlBadge"></span></div>
        <span class="tl-note">No time-series data connected</span>
      </div>
      <div class="tl-track">
        ${to > PRESENT_YEAR ? `<span class="tl-zone" style="left:${at(f(zoneFrom))}" title="Forecast period"></span>` : ""}
        <input class="tl-range" id="tlRange" type="range" min="${from}" max="${to}" step="1" aria-label="Year" />
        ${ticks(from, to).map((y) => `<span class="tl-tick" style="left:${at(f(y))}"><i></i><em>${y}</em></span>`).join("")}
      </div>`;
    yearEl = root.querySelector("#tlYear"); badgeEl = root.querySelector("#tlBadge");
    playEl = root.querySelector("#tlPlay"); rangeEl = root.querySelector("#tlRange");
    rangeEl.addEventListener("input", () => { if (getState().playing) setState({ playing: false }); setYear(+rangeEl.value); });
    playEl.addEventListener("click", () => {
      const st = getState(), r = modeRange();
      if (st.playing) return setState({ playing: false });
      setState({ playing: true, year: st.year >= r.to ? r.from : st.year }); // at the end, play starts over
    });
  }

  function step() {
    const s = getState(), { to } = modeRange();
    if (s.year >= to) setState({ playing: false }); else setYear(s.year + 1);
  }

  function render(s) {
    if (built !== s.mode) { build(s); built = s.mode; }
    yearEl.textContent = s.year;
    const phase = s.year < PRESENT_YEAR ? "Historical" : s.year === PRESENT_YEAR ? "Present" : "Forecast";
    badgeEl.textContent = phase;
    badgeEl.dataset.phase = phase.toLowerCase();
    if (+rangeEl.value !== s.year) rangeEl.value = s.year;
    playEl.innerHTML = s.playing ? PAUSE : PLAY;
    playEl.setAttribute("aria-label", s.playing ? "Pause" : "Play through the years");
    if (s.playing && !timer) timer = setInterval(step, STEP_MS);
    if (!s.playing && timer) { clearInterval(timer); timer = 0; }
  }

  subscribe(render);
  render(getState());
}
