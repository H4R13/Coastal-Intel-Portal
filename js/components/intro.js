/**
 * Opening sequence, shown on every page load. It waits behind an "Enter" button, because browsers only allow sound
 * after a click or key press; then: the NGT mark with "powered by NDMA" and the NDMA logo, then the portal's name,
 * whose letters arrive one by one and then rush past the viewer as streaks of blue light. Sound: introSound.js.
 * Once it is running, any key or click skips it; the speaker button turns the sound off (remembered for next time).
 *   runIntro()   resolves when the sequence is over and the overlay is gone
 * The timings live in css/styles.css (.intro …); the numbers below must match them.
 */
import { introSound } from "./introSound.js";

const TITLE = "Coastal Environmental Intelligence Portal";
const MARK_MS = 3600, TITLE_MS = 3900, RUSH_MS = 2300, OUT_MS = 450; // RUSH_MS: when the name starts to rush, from the moment it appears
const MUTED_KEY = "introMuted";
const speaker = (on) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/>${on ? '<path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.8 7.8 0 0 1 0 11"/>' : '<path d="m16 9.5 5 5M21 9.5l-5 5"/>'}</svg>`;

export function runIntro() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || new URLSearchParams(location.search).has("nointro")) return Promise.resolve();
  let muted = false;
  try { muted = localStorage.getItem(MUTED_KEY) === "1"; } catch { /* storage unavailable: sound stays on */ }
  const el = document.createElement("div");
  el.className = "intro gate";
  el.innerHTML = `
    <div class="intro-gate"><button class="intro-enter"><i></i><i></i><span>Enter</span></button><small>${TITLE}</small></div>
    <div class="intro-mark"><div class="intro-ngt" aria-label="NGT"><span>N</span><span>G</span><span>T</span></div><div class="intro-by">powered by <b>NDMA</b></div><img class="intro-logo" src="css/ndma-logo.png" alt="National Disaster Management Authority, Pakistan" /></div>
    <div class="intro-title" aria-label="${TITLE}">${TITLE.split(" ").map((word, w) => `<span class="intro-word">${[...word].map((ch, i) => `<i style="--i:${w * 6 + i}">${ch}</i>`).join("")}</span>`).join(" ")}</div>
    <div class="intro-streaks">${Array.from({ length: 26 }, (_, i) => `<b style="--x:${((i * 37) % 100)}%;--d:${(i % 7) * 40}ms;--w:${2 + (i % 5) * 3}px"></b>`).join("")}</div>
    <button class="intro-mute" aria-pressed="${muted}" title="Sound on or off">${speaker(!muted)}<span>${muted ? "Sound off" : "Sound on"}</span></button>
    <button class="intro-skip">Skip</button>`;
  document.body.appendChild(el);
  const enter = el.querySelector(".intro-enter"), mute = el.querySelector(".intro-mute");
  enter.focus();

  return new Promise((resolve) => {
    const timers = [];
    let over = false, sound = null;
    const finish = () => {
      if (over) return;
      over = true; timers.forEach(clearTimeout);
      window.removeEventListener("keydown", skip); el.removeEventListener("click", skip);
      sound?.stop(1.4); // the last hit rings out as the portal appears
      el.classList.add("out");
      setTimeout(() => { el.remove(); resolve(); }, OUT_MS);
    };
    const skip = (e) => { if (e.target.closest?.(".intro-mute")) return; sound?.stop(0.25); sound = null; finish(); };
    mute.addEventListener("click", (e) => {
      e.stopPropagation();
      muted = !muted;
      try { localStorage.setItem(MUTED_KEY, muted ? "1" : "0"); } catch { /* not remembered */ }
      mute.setAttribute("aria-pressed", String(muted));
      mute.innerHTML = `${speaker(!muted)}<span>${muted ? "Sound off" : "Sound on"}</span>`;
      sound?.setMuted(muted);
    });
    enter.addEventListener("click", (e) => {
      e.stopPropagation();
      el.classList.remove("gate");
      sound = introSound({ markMs: MARK_MS, rushMs: MARK_MS + RUSH_MS, muted });
      timers.push(setTimeout(() => el.classList.add("show-title"), MARK_MS));
      timers.push(setTimeout(finish, MARK_MS + TITLE_MS));
      // from here on any key or click skips; not armed at once, so the entering click or key cannot skip it
      timers.push(setTimeout(() => { window.addEventListener("keydown", skip); el.addEventListener("click", skip); }, 500));
    }, { once: true });
  });
}
