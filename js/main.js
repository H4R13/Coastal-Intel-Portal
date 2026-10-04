import { LayerSidebar } from "./components/layerSidebar.js";
import { CoastalMap } from "./components/coastalMap.js";
import { MapLayers } from "./components/mapLayers.js";
import { MapSettings } from "./components/mapSettings.js";
import { AnalysisPanel } from "./components/analysisPanel.js";
import { PanelToggles } from "./components/panelToggles.js";
import { getState, subscribe } from "./state.js";
import { runIntro } from "./components/intro.js";
import { openTerminal, TerminalButton } from "./components/terminal.js";
import { AssistantButton, announce } from "./components/assistant.js";

const $ = (id) => document.getElementById(id);

// persistent tile cache (see sw.js); needs https or localhost, silently skipped otherwise
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

CoastalMap($("map-area"));
if (location.search.includes("perf")) import("./perf.js").then((m) => { const wait = setInterval(() => { if (window.__map?.loaded()) { clearInterval(wait); m.initPerf(window.__map); } }, 500); });
MapLayers($("map-area"));
MapSettings($("map-area"));
LayerSidebar($("sidebar"));
AnalysisPanel($("analysis"));
PanelToggles(document.querySelector(".shell"), $("map-area"));
TerminalButton($("map-area"));
AssistantButton($("sidebar"));

// every page load: the opening sequence, the system check (which closes by itself), then the assistant's warnings
// (?nointro skips all three)
if (!new URLSearchParams(location.search).has("nointro")) runIntro().then(() => openTerminal({ auto: true })).then(announce);

$("closeAbout").addEventListener("click", () => $("aboutDialog").close());
$("aboutDialog").addEventListener("click", (e) => e.target === e.currentTarget && e.currentTarget.close());

subscribe((s) => (document.body.dataset.mode = s.mode));
document.body.dataset.mode = getState().mode;
