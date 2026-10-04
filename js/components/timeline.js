import { PRESENT_YEAR } from "../config/layers.js";
import { getState, subscribe, setState, setYear, modeRange } from "../state.js";

/**
 * Time control: a year slider with play / pause over the active mode's range.
 * It only moves state.year; map layers and charts read that year. The range past PRESENT_YEAR is hatched as forecast.
 * Hovering the play button shows two bubbles above it: twice the speed, and loop (start over at the last year).
 */
const STEP_MS = 700; // one year per step while playing (halved at 2× speed)
const THUMB = 14;    // px, must match .tl-range thumb width so ticks line up with the thumb centre
const ico = (p) => `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${p}</svg>`;
const PLAY = ico('<path d="M8 5.5v13l11-6.5Z"/>'), PAUSE = ico('<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/>');
const LOOP = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 2.5 20.5 6 17 9.5"/><path d="M3.5 11V9.5A3.5 3.5 0 0 1 7 6h13.5"/><path d="M7 21.5 3.5 18 7 14.5"/><path d="M20.5 13v1.5A3.5 3.5 0 0 1 17 18H3.5"/></svg>`;

const at = (f) => `calc(${THUMB / 2}px + (100% - ${THUMB}px) * ${f})`;

function ticks(from, to) {
  const out = [from];
  for (let y = Math.ceil((from + 1) / 10) * 10; y < to; y += 10) if (y - from >= 4 && to - y >= 4) out.push(y);
  out.push(to);
  return out;
}

export function Timeline(root) {
  let built = null, timer = 0, timerSpeed = 0;
  let yearEl, badgeEl, playEl, rangeEl, speedEl, loopEl;

  function build(s) {
    const { from, to } = modeRange(s.mode);
    const f = (y) => (y - from) / (to - from);
    const zoneFrom = Math.max(from, PRESENT_YEAR);
    root.innerHTML = `
      <div class="tl-head">
        <div class="tl-playwrap">
          <div class="tl-bubbles" role="group" aria-label="Playback options">
            <button class="tl-bub" id="tlSpeed" aria-pressed="false" title="Play twice as fast">2×</button>
            <button class="tl-bub" id="tlLoop" aria-pressed="false" title="Start over at the end">${LOOP}</button>
          </div>
          <button class="tl-play" id="tlPlay"></button>
        </div>
        <div class="tl-now"><strong id="tlYear"></strong><span class="tl-badge" id="tlBadge"></span></div>
        <span class="tl-note" id="tlNote"></span>
      </div>
      <div class="tl-track">
        ${to > PRESENT_YEAR ? `<span class="tl-zone" style="left:${at(f(zoneFrom))}" title="Forecast period"></span>` : ""}
        <input class="tl-range" id="tlRange" type="range" min="${from}" max="${to}" step="1" aria-label="Year" />
        ${ticks(from, to).map((y) => `<span class="tl-tick" style="left:${at(f(y))}"><i></i><em>${y}</em></span>`).join("")}
      </div>`;
    yearEl = root.querySelector("#tlYear"); badgeEl = root.querySelector("#tlBadge");
    playEl = root.querySelector("#tlPlay"); rangeEl = root.querySelector("#tlRange");
    speedEl = root.querySelector("#tlSpeed"); loopEl = root.querySelector("#tlLoop");
    speedEl.addEventListener("click", () => setState({ speed: getState().speed === 2 ? 1 : 2 }));
    loopEl.addEventListener("click", () => setState({ loop: !getState().loop }));
    rangeEl.addEventListener("input", () => { if (getState().playing) setState({ playing: false }); setYear(+rangeEl.value); });
    playEl.addEventListener("click", () => {
      const st = getState(), r = modeRange();
      if (st.playing) return setState({ playing: false });
      setState({ playing: true, year: st.year >= r.to ? r.from : st.year }); // at the end, play starts over
    });
  }

  function step() {
    const s = getState(), { from, to } = modeRange();
    if (s.year < to) setYear(s.year + 1);
    else if (s.loop) setYear(from);
    else setState({ playing: false });
  }

  function render(s) {
    if (built !== s.mode) { build(s); built = s.mode; }
    yearEl.textContent = s.year;
    const phase = s.year < PRESENT_YEAR ? "Historical" : s.year === PRESENT_YEAR ? "Present" : "Forecast";
    badgeEl.textContent = phase;
    badgeEl.dataset.phase = phase.toLowerCase();
    if (+rangeEl.value !== s.year) rangeEl.value = s.year;
    root.querySelector("#tlNote").textContent = s.activeLayers.length ? "Map layers and charts follow this year" : "Switch a layer on to see it change";
    playEl.innerHTML = s.playing ? PAUSE : PLAY;
    playEl.setAttribute("aria-label", s.playing ? "Pause" : "Play through the years");
    speedEl.setAttribute("aria-pressed", String(s.speed === 2)); loopEl.setAttribute("aria-pressed", String(s.loop));
    playEl.classList.toggle("fast", s.speed === 2); playEl.classList.toggle("looping", s.loop);
    if (timer && (!s.playing || timerSpeed !== s.speed)) { clearInterval(timer); timer = 0; } // stopped, or the speed changed
    if (s.playing && !timer) { timerSpeed = s.speed; timer = setInterval(step, STEP_MS / s.speed); }
  }

  subscribe(render);
  render(getState());
}
