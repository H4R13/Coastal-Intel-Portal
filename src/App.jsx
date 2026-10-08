/**
 * The page: the layers sidebar on the left, the map in the middle, the analysis panel on the right, and the pieces
 * that float over them (intro, terminal, tour, about).
 * On every page load: the opening sequence, the system check (which closes by itself), then the assistant's warnings.
 *   ?nointro skips all three;  ?tour then plays the guided tour (with ?nointro, as soon as the map is ready);
 *   ?perf shows the frame-time read-out (src/perf.js).
 */
import { useEffect, useRef, useState } from "react";
import { useStore } from "./state.js";
import { Icon } from "./lib.jsx";
import { Sidebar } from "./components/Sidebar.jsx";
import { MapView } from "./components/MapView.jsx";
import { AnalysisPanel } from "./panels/AnalysisPanel.jsx";
import { useSspShortcuts } from "./panels/SspKeys.jsx";
import { Intro, skipsIntro } from "./components/Intro.jsx";
import { Terminal, openTerminal } from "./components/Terminal.jsx";
import { announce } from "./components/Assistant.jsx";
import { Tour, startTour } from "./components/Tour.jsx";

const PANELS_KEY = "pakcoast.panels";
const SIDE_LABEL = { left: "layers panel", right: "analysis panel" };
const whenMapReady = (fn) => { const wait = setInterval(() => { if (window.__map?.loaded()) { clearInterval(wait); fn(); } }, 300); };

function AboutDialog({ dialog }) {
  return (
    <dialog id="aboutDialog" ref={dialog} onClick={(e) => e.target === e.currentTarget && e.currentTarget.close()}>
      <h2 className="eyebrow">About this portal</h2>
      <h3>Coastal Environmental Intelligence</h3>
      <p>A monitoring portal for understanding how Pakistan's coastline is changing across seven environmental layers.</p>
      <p className="muted">This is the initial interface. No environmental datasets are connected yet, so no measurements, trends or projections are shown. Each layer is configured in <code>src/config/layers.js</code>; connecting data requires no interface redesign.</p>
      <button id="closeAbout" className="btn" onClick={() => dialog.current.close()}>Close</button>
    </dialog>
  );
}

export function App() {
  const mode = useStore((s) => s.mode);
  const about = useRef(null);
  const [intro, setIntro] = useState(() => !skipsIntro());
  const [open, setOpen] = useState(() => { // which side panels are open, remembered between visits
    try { return { left: true, right: true, ...JSON.parse(localStorage.getItem(PANELS_KEY)) }; } catch { return { left: true, right: true }; }
  });

  useSspShortcuts(); // keys 1, 2, 3 pick the emissions scenario
  useEffect(() => { document.body.dataset.mode = mode; }, [mode]);
  useEffect(() => {
    try { localStorage.setItem(PANELS_KEY, JSON.stringify(open)); } catch { /* not remembered */ }
    window.dispatchEvent(new Event("panelschange")); // the map re-centres the globe between the open panels
  }, [open]);
  useEffect(() => {
    // persistent tile cache (public/sw.js); needs https or localhost, silently skipped otherwise
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
    const params = new URLSearchParams(location.search);
    if (params.has("perf")) import("./perf.js").then((m) => whenMapReady(() => m.initPerf(window.__map)));
    if (params.has("nointro") && params.has("tour")) whenMapReady(startTour);
  }, []);
  const afterIntro = () => {
    setIntro(false);
    openTerminal({ auto: true }).then(announce).then(() => { if (new URLSearchParams(location.search).has("tour")) whenMapReady(startTour); });
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
      <div className={`shell ${open.left ? "" : "left-closed"} ${open.right ? "" : "right-closed"}`}>
        <Sidebar />
        <MapView onAbout={() => about.current.showModal()} handles={handles} />
        <AnalysisPanel />
      </div>
      <AboutDialog dialog={about} />
      <Terminal />
      <Tour />
      {intro ? <Intro onDone={afterIntro} /> : null}
    </>
  );
}
