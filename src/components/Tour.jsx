/**
 * Guided tour for presenting the portal: a spotlight on one part of the screen at a time with a caption card, in the
 * manner of Shepherd.js but without a dependency, and it plays by itself. Each step drives the real portal (opens a
 * layer, moves the timeline, presses a scenario key), so what the audience sees is the live data, never a recording.
 *   startTour()   from the compass button at the bottom right of the map, or by opening the page with ?tour
 *   <Tour />      the spotlight and the card (mounted once in App);  <TourButton />  the compass button on the map
 *   Space pause / resume · → next · ← back · Esc end
 * Steps are plain data (STEPS below): { title, text, target, side, ms, run }.
 *   target  CSS selector to spotlight; none = no spotlight, the card sits under the title plate so the map stays clear
 *   ms      how long the step stays before the next one (the bar on the card shows it)
 *   run     what to do in the portal when the step begins
 * Captions describe what is on screen; they state no values, so they stay true whatever data is loaded.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { getState, setState, selectLayer, setYear, setSsp, focusLayer } from "../state.js";
import { Icon } from "../lib.jsx";
import * as np from "../nutrients/np.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tool = (act) => document.querySelector(`.map-tools [data-act="${act}"]`)?.click();
const show = (...ids) => setState({ activeLayers: ids });
const open = (id, fly = true) => { selectLayer(id); if (fly) focusLayer(id); };
const play = (from, speed = 2) => setState({ year: from, speed, loop: false, playing: true });
const stop = () => getState().playing && setState({ playing: false });
const hazard = (id, hz) => setState({ amibView: { ...getState().amibView, [id]: { ...getState().amibView[id], hazard: hz, variant: 0, measure: undefined, raw: null } } });
const panels = () => document.querySelectorAll(".shell.left-closed .panel-handle.left, .shell.right-closed .panel-handle.right").forEach((b) => b.click()); // both panels open

const STEPS = [
  { title: "PCOP: Pakistan Coastal Observation & Projection", text: "One map of Pakistan's coast, from Jiwani to the Indus Delta, with every environmental layer the team has delivered, from 1990 to 2050.", ms: 7000,
    run: () => { panels(); stop(); setSsp("ssp245"); setState({ year: 2026, activeLayers: [], floodId: null }); selectLayer("sealevel"); tool("globe"); } },
  { title: "The study area", text: "The portal opens on the globe and flies to the coast: about a thousand kilometres of shoreline in Balochistan and Sindh.", ms: 7000, run: () => tool("reset") },
  { title: "Ten layers", text: "Each icon opens one subject and puts it on the map: sea level, saline water intrusion, salinity, coastal hazards, mangroves, erosion, plastics, fisheries, the ocean, and nutrients and plankton.", target: ".dock", side: "right", ms: 8000 },
  { title: "What is drawn on the map", text: "One layer is on the map at a time: another icon replaces it, and the same icon again takes it off. Earth view and Reset view clear the map.", target: ".dock", side: "right", ms: 7500 },
  { title: "Mangroves", text: "Mangrove forest of each year against 1990: still standing, gained and lost. The map goes to the Indus Delta, where most of the change is.", ms: 9000,
    run: () => { open("mangroves"); show("mangroves"); setYear(2025); } },
  { title: "One timeline for everything", text: "Map layers and charts all follow this year. Past the present the bar is hatched: those years are projections.", target: ".timeline", side: "top", ms: 15000,
    run: () => play(2000) },
  { title: "Charts that follow the year", text: "The line is bright up to the timeline year and faint after it. Every chart can be opened full screen.", target: "#panelBody .chart, #panelBody figure", side: "left", ms: 8000,
    run: () => { stop(); setYear(2040); } },
  { title: "Three futures", text: "Low, medium and high emissions. One press switches every layer that has scenarios: mangroves, the hazard maps and the ocean outlook.", target: ".ssp-block", side: "left", ms: 10000,
    run: async () => { setYear(2050); setSsp("ssp126"); await sleep(3000); setSsp("ssp585"); await sleep(3000); setSsp("ssp245"); } },
  { title: "Coastal erosion", text: "Land lost to the sea, period by period since 1985, then the projected years. Projected areas are drawn fainter.", ms: 12000,
    run: () => { open("erosion"); show("erosion"); play(1995); } },
  { title: "Coastal hazards", text: "The saline water intrusion package arranged as ten hazards in four groups, instead of hundreds of separate maps.", target: ".hz", side: "left", ms: 9000,
    run: () => { stop(); hazard("hazards", "sea-rise"); open("hazards", false); show("hazards"); setYear(2026); } },
  { title: "Sea-level rise at the coast", text: "Sea rising plus land sinking, year by year. Colour marks where the rise differs from the regional value.", ms: 12000,
    run: () => { setSsp("ssp585"); focusLayer("hazards"); play(2026, 1); } },
  { title: "Fresh groundwater", text: "The fresh water layer under the delta, modelled for each year under today's river flow.", ms: 12000,
    run: () => { stop(); hazard("hazards", "groundwater"); focusLayer("hazards"); play(1990); } },
  { title: "Saline water intrusion", text: "The same hazards sit under their own subject too: saline water under the coast, salt moving up the Indus, and the groundwater layer.", target: ".hz", side: "left", ms: 8000,
    run: () => { stop(); setYear(2050); open("intrusion"); show("intrusion"); } },
  { title: "The ocean", text: "Acidity, sea temperature, marine heatwaves and oxygen inside Pakistan's Exclusive Economic Zone, with the outlook to 2050.", ms: 12000,
    run: () => { setSsp("ssp245"); open("ocean"); show("ocean"); play(1990); } },
  { title: "Fisheries", text: "National indicators stated for the year on the timeline. Years after the last measurement are marked as a statistical trend, not a measurement.", ms: 9000,
    run: () => { stop(); open("fisheries"); show("fisheries"); setYear(2020); } },
  { title: "Plastics", text: "Plastic density at the sampling stations in the Indus Delta creeks, beside published measurements along the coast. Any dot can be clicked for its numbers.", ms: 9000,
    run: () => { open("microplastics"); show("microplastics"); setYear(2026); } },
  { title: "Nutrients and plankton", text: "Algae and sea heat from satellites, year by year since 1998: green and yellow water holds more algae. The layer has its own slider, like the ocean layers.", ms: 10000,
    run: () => { open("nutrients"); show("nutrients"); np.start().then(() => { if (np.data()?.hist) { np.selectLayer("hist_chl_year"); np.setHi(0); np.play(); } }); } },
  { title: "Seen and measured in the water", text: "Samples from ships, floats and laboratories found in open databases, one dot per reading. Depth buttons keep surface and deep water apart; any dot can be clicked for its value, date and source.", target: '[aria-label="Depth"]', side: "left", ms: 10000,
    run: () => { np.start().then(() => { if (np.data()?.insitu?.measured.length) { np.selectLayer("ins_measured"); np.setInsVar("dissolved_oxygen"); np.setInsDepth("deep"); } }); } },
  { title: "Sea level and terrain", text: "Terrain exposure from the 12.5 m elevation model: which land lies below a chosen water level and is open to the sea.", target: ".exposure", side: "left", ms: 10000,
    run: async () => { open("sealevel"); show(); setYear(2026); await sleep(1500); const chips = document.querySelectorAll(".exposure [data-flood]"); chips[Math.min(2, chips.length - 1)]?.click(); } },
  { title: "System check", text: "The terminal checks the database, the cache and the data behind every layer whenever the portal starts.", target: ".term-btn", side: "left", ms: 6500, run: () => setState({ floodId: null }) },
  { title: "Start-up warnings", text: "Hela, the assistant, raises the day's warnings, each computed from data already in the portal and labelled measured, projected or modelled.", target: ".bot-btn", side: "right", ms: 6500 },
  { title: "Pakistan's coast, 1990 to 2050", text: "Every layer on one map and one timeline. Press Esc to explore the portal yourself.", ms: 8000,
    run: () => { stop(); show(); setYear(2026); selectLayer("sealevel"); tool("globe"); } },
];

/** Total running time of the tour in seconds (for anyone recording it). */
export const TOUR_SECONDS = Math.round(STEPS.reduce((a, s) => a + s.ms, 0) / 1000);

/* ---- whether the tour is running, shared by the button and the overlay ---- */
let running = false;
const watchers = new Set();
const setRunning = (on) => { running = on; watchers.forEach((fn) => fn()); };
const useRunning = () => useSyncExternalStore((fn) => (watchers.add(fn), () => watchers.delete(fn)), () => running);
export const startTour = () => { if (!running) setRunning(true); };

function Overlay() {
  const [i, setI] = useState(0), [paused, setPaused] = useState(false);
  const spot = useRef(null), card = useRef(null), bar = useRef(null);
  const clock = useRef({ left: 0, started: 0, timer: 0 }); // time left on the step, when it (re)started, the timer to the next
  const at = useRef({ i: 0, paused: false });
  at.current = { i, paused };

  const end = () => { clearTimeout(clock.current.timer); stop(); setRunning(false); };
  const go = (n) => { if (n >= STEPS.length) end(); else setI(Math.max(0, n)); };
  const arm = (ms) => { const c = clock.current; clearTimeout(c.timer); c.left = ms; c.started = performance.now(); c.timer = setTimeout(() => go(at.current.i + 1), ms); };

  useEffect(() => { // a step begins: drive the portal, restart the bar and the timer
    const step = STEPS[i], c = clock.current;
    if (bar.current) bar.current.style.width = "0%";
    card.current.classList.remove("in"); void card.current.offsetWidth; card.current.classList.add("in");
    Promise.resolve().then(() => step.run?.()).catch((e) => console.warn(`Tour step "${step.title}": ${e.message}`)); // a failing step never stops the tour
    if (at.current.paused) { clearTimeout(c.timer); c.left = step.ms; c.started = 0; } else arm(step.ms);
    return () => clearTimeout(c.timer);
  }, [i]); // eslint-disable-line react-hooks/exhaustive-deps

  const pause = (on = !at.current.paused) => {
    if (on === at.current.paused) return;
    const c = clock.current;
    if (on) { clearTimeout(c.timer); if (c.started) c.left = Math.max(800, c.left - (performance.now() - c.started)); c.started = 0; }
    else arm(c.left);
    setPaused(on);
  };

  useEffect(() => { // keys; the spotlight and the card follow their target while panels redraw and the layout settles
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const act = { Escape: end, ArrowRight: () => go(at.current.i + 1), ArrowLeft: () => go(at.current.i - 1), " ": () => pause() }[e.key];
      if (!act) return;
      e.preventDefault(); e.stopPropagation();
      act();
    };
    document.addEventListener("keydown", onKey, true);
    document.body.classList.add("touring");
    let raf = 0;
    const place = () => {
      const step = STEPS[at.current.i], el = step?.target && [...document.querySelectorAll(step.target)].find((e) => e.offsetParent !== null);
      const map = document.getElementById("map-area").getBoundingClientRect(), cw = card.current.offsetWidth, ch = card.current.offsetHeight, GAP = 16;
      let x, y;
      if (el) {
        const r = el.getBoundingClientRect(), P = 6;
        const top = Math.max(r.top, 8), bottom = Math.min(r.bottom, innerHeight - 8); // a tall target (the hazard list) is lit as far as it shows
        Object.assign(spot.current.style, { left: `${r.left - P}px`, top: `${top - P}px`, width: `${r.width + 2 * P}px`, height: `${bottom - top + 2 * P}px` });
        spot.current.hidden = false;
        const mid = (top + bottom) / 2;
        if (step.side === "right") { x = r.right + GAP; y = mid - ch / 2; }
        else if (step.side === "left") { x = r.left - cw - GAP; y = mid - ch / 2; }
        else { x = r.left + r.width / 2 - cw / 2; y = top - ch - GAP; }
      } else {
        spot.current.hidden = true;
        const plate = document.querySelector(".brand")?.getBoundingClientRect(); // under the title plate: clear of the legend, the timeline and the middle of the map
        x = (plate?.left ?? map.left + 24) + 96; y = (plate?.bottom ?? map.top + 80) + 14;
      }
      card.current.style.left = `${Math.max(12, Math.min(innerWidth - cw - 12, x))}px`;
      card.current.style.top = `${Math.max(12, Math.min(innerHeight - ch - 12, y))}px`;
      const c = clock.current;
      if (!at.current.paused && c.started) bar.current.style.width = `${Math.min(100, (100 * (step.ms - c.left + performance.now() - c.started)) / step.ms)}%`;
      raf = requestAnimationFrame(place);
    };
    raf = requestAnimationFrame(place);
    return () => { cancelAnimationFrame(raf); document.removeEventListener("keydown", onKey, true); document.body.classList.remove("touring"); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const step = STEPS[i];
  return (
    <div className={`tour ${paused ? "paused" : ""}`}>
      <div className="tour-spot" hidden ref={spot} />
      <div className="tour-card" role="dialog" aria-live="polite" aria-label="Guided tour" ref={card}>
        <div className="tour-top"><span className="tour-count">{i + 1} / {STEPS.length}</span><button className="tour-x" aria-label="End the tour" title="End the tour (Esc)" onClick={end}>✕</button></div>
        <h3>{step.title}</h3><p>{step.text}</p>
        <div className="tour-bar"><i ref={bar} /></div>
        <div className="tour-nav">
          <button title="Back (←)" onClick={() => go(i - 1)}>Back</button>
          <button title="Pause or resume (Space)" onClick={() => pause()}>{paused ? "Resume" : "Pause"}</button>
          <button className="primary" title="Next (→)" onClick={() => go(i + 1)}>Next</button>
        </div>
      </div>
    </div>
  );
}

/** The tour, while it is running. Mounted once, in App. */
export function Tour() {
  return useRunning() ? createPortal(<Overlay />, document.body) : null;
}

/** The round compass button above the terminal chip, at the bottom right of the map. */
export function TourButton() {
  return (
    <button className="tour-btn" aria-label="Play the guided tour" title="Guided tour" onClick={startTour}>
      <Icon width={1.6} paths='<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5Z"/>' />
    </button>
  );
}
