/**
 * The page: the layers sidebar on the left, the map in the middle, the analysis panel on the right, and the pieces
 * that float over them (intro, terminal, tour, about). With the Ocean or Fisheries layer open (om-mode) the layer dock
 * lies above the year slider and the ocean package's layer list takes the left side (src/oceanMonitoring/); Nutrients &
 * Plankton is laid out the same way, with its month slider (src/nutrients/).
 * On every page load: the opening sequence, the system check (which closes by itself), the assistant's warnings, then
 * the showcase starts by itself (Esc during the sequence skips all of it).
 *   ?nointro skips all three;  ?tour then plays the guided tour (with ?nointro, as soon as the map is ready);
 *   ?showcase likewise starts the showcase (standby mode, src/components/Showcase.jsx);
 *   ?perf shows the frame-time read-out (src/perf.js).
 */
import { useEffect, useRef, useState } from "react";
import { Icon } from "./lib.jsx";
import { Sidebar } from "./components/Sidebar.jsx";
import { MapView } from "./components/MapView.jsx";
import { AnalysisPanel } from "./panels/AnalysisPanel.jsx";
import { useSspShortcuts } from "./panels/SspKeys.jsx";
import { Intro, skipsIntro } from "./components/Intro.jsx";
import { Terminal, openTerminal, loadTerminalState } from "./components/Terminal.jsx";
import { announce } from "./components/Assistant.jsx";
import { Tour, startTour } from "./components/Tour.jsx";
import { Showcase, startShowcase } from "./components/Showcase.jsx";
import { LAYERS } from "./config/layers.js";
import { useStore, setYearTo, getState } from "./state.js";
import { lastYear } from "./amib/amibData.js";
import { isOmLayer } from "./oceanMonitoring/OceanMonitoring.jsx";
import { isNpLayer } from "./nutrients/Nutrients.jsx";

const PANELS_KEY = "pakcoast.panels";
const SIDE_LABEL = { left: "layers panel", right: "analysis panel" };
/**
 * Where the timeline ends: 2050 for most layers; for the open layer whose chosen package data goes further (sea-level
 * rise, land below sea level, salt water under the coast to 2100, the future ocean to 2090) that layer's last year.
 */
function useTimeEnd() {
  const primary = useStore((s) => s.primaryLayer), view = useStore((s) => s.amibView[s.primaryLayer]);
  useEffect(() => {
    let live = true;
    lastYear(LAYERS.find((l) => l.id === primary), getState()).then((y) => { if (live) setYearTo(y ?? 0); }); // under 2050 is lifted to 2050
    return () => { live = false; };
  }, [primary, view]);
}

const whenMapReady = (fn) => { const wait = setInterval(() => { if (window.__map?.loaded()) { clearInterval(wait); fn(); } }, 300); };

function AboutDialog({ dialog }) {
  return (
    <dialog id="aboutDialog" ref={dialog} onClick={(e) => e.target === e.currentTarget && e.currentTarget.close()}>
      <h2 className="eyebrow">About this portal</h2>
      <h3>PCOP: Pakistan Coastal Observation &amp; Projection</h3>
      <p>One map of Pakistan's coast, from past records to climate projections for 2050 and, where a dataset runs that far, 2100.</p>
      <p className="muted">Each layer is the team's own data, loaded into the portal's database and played year by year on one timeline. Projections are scenarios, not forecasts.</p>
      <button id="closeAbout" className="btn" onClick={() => dialog.current.close()}>Close</button>
    </dialog>
  );
}

export function App() {
  const about = useRef(null);
  // Ocean, Fisheries or Nutrients & Plankton open: the layer dock moves above that layer's own slider
  const omMode = useStore((s) => { const l = LAYERS.find((x) => x.id === s.primaryLayer); return isOmLayer(l) || isNpLayer(l); });
  const [intro, setIntro] = useState(() => !skipsIntro());
  const [open, setOpen] = useState(() => { // which side panels are open, remembered between visits
    try { return { left: true, right: true, ...JSON.parse(localStorage.getItem(PANELS_KEY)) }; } catch { return { left: true, right: true }; }
  });

  useSspShortcuts(); // keys 1, 2, 3 pick the emissions scenario
  useTimeEnd();
  useEffect(() => {
    try { localStorage.setItem(PANELS_KEY, JSON.stringify(open)); } catch { /* not remembered */ }
    window.dispatchEvent(new Event("panelschange")); // the map re-centres the globe between the open panels
  }, [open]);
  useEffect(() => {
    // persistent tile cache (public/sw.js); needs https or localhost, silently skipped otherwise
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
    loadTerminalState(); // layers hidden from the dock with the terminal's hide command
    const params = new URLSearchParams(location.search);
    if (params.has("perf")) import("./perf.js").then((m) => whenMapReady(() => m.initPerf(window.__map)));
    if (params.has("nointro") && params.has("tour")) whenMapReady(startTour);
    if (params.has("nointro") && params.has("showcase")) whenMapReady(startShowcase);
  }, []);
  const afterIntro = ({ skipAll } = {}) => {
    setIntro(false);
    const params = new URLSearchParams(location.search);
    if (skipAll) { // Esc: straight to the portal, no system check, no warnings and no showcase unless asked for
      if (params.has("tour")) whenMapReady(startTour);
      else if (params.has("showcase")) whenMapReady(startShowcase);
      return;
    }
    // after the system check the showcase starts by itself, as if its button had been pressed (owner request, 2026-11-20); ?tour plays the tour instead
    openTerminal({ auto: true }).then(announce).then(() => whenMapReady(params.has("tour") ? startTour : startShowcase));
  };

  const handles = ["left", "right"].map((side) => {
    const tip = `${open[side] ? "Hide" : "Show"} ${SIDE_LABEL[side]}`;
    return (
      <button key={side} className={`panel-handle ${side}`} aria-expanded={open[side]} aria-label={tip} data-tip={tip} onClick={() => setOpen({ ...open, [side]: !open[side] })}>
        <Icon width={2} paths='<path d="m15 6-6 6 6 6"/>' />
      </button>
    );
  });

  return (
    <>
      <div className={`shell ${open.left ? "" : "left-closed"} ${open.right ? "" : "right-closed"} ${omMode ? "om-mode" : ""}`}>
        <Sidebar />
        <MapView onAbout={() => about.current.showModal()} handles={handles} />
        <AnalysisPanel />
      </div>
      <AboutDialog dialog={about} />
      <Terminal />
      <Tour />
      <Showcase />
      {intro ? <Intro onDone={afterIntro} /> : null}
    </>
  );
}
