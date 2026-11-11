/**
 * The three emissions-scenario keys (SSP1-2.6 / SSP2-4.5 / SSP5-8.5) at the top of the analysis panel. One choice
 * (state.ssp, via setSsp) drives every layer with scenarios: the package hazard maps, the mangrove projections and
 * the ocean outlook. Pressing a key also puts the open layer on the map, so the scenario's map loads at once.
 * Keyboard: 1, 2, 3 do the same while focus is not in a text field.
 * Colours match the scenario lines of every chart (src/components/TimeChart.jsx).
 */
import { useEffect } from "react";
import { SSPS } from "../amib/hazards.js";
import { setSsp, toggleLayer, useStore } from "../state.js";

const COLORS = { ssp126: "#5fa8e8", ssp245: "#f79420", ssp585: "#e5534b" };
const ALL = { ssp126: true, ssp245: true, ssp585: true };

/** Layers whose maps change with the emissions scenario. */
export const hasSsp = (layer) => !!(layer?.amib || layer?.id === "mangroves"); // the ocean outlook has its keys on its own year slider (src/oceanMonitoring/)

/**
 * avail: { ssp126: bool, ... } for which keys have a map, or null when the current map has no scenarios (`none` says
 * why). In that case the keys are disabled, unless jump = { title } names the layer's scenario map: then a key opens
 * it (onJump is called), so the keys always load a scenario map.
 * used: the scenario actually drawn when the chosen one has no run. note: one line under the keys.
 */
export function SspKeys({ layer, avail = ALL, used, note = "", none = "This map is observed, so it is the same in every scenario.", jump = null, onJump }) {
  const ssp = useStore((s) => s.ssp);
  const drawn = used ?? ssp;
  const press = (id) => { setSsp(id); if (!avail && jump) onJump?.(); toggleLayer(layer.id, true); };
  const missing = avail && !avail[ssp];
  return (
    <section className="block ssp-block">
      <div className="ssp-head"><span className="field-label">Emissions scenario</span><small className="muted">keys 1 · 2 · 3</small></div>
      <div className="ssp-keys" role="group" aria-label="Emissions scenario">
        {SSPS.map((x) => {
          const has = !!avail?.[x.id] || (!avail && !!jump), on = !!avail?.[x.id] && x.id === ssp, stand = has && !!avail && x.id === drawn && drawn !== ssp;
          return (
            <button key={x.id} className={`ssp-key ${on ? "active" : ""} ${stand ? "standin" : ""}`} data-ssp={x.id} style={{ "--ssp": COLORS[x.id] }} aria-pressed={on} disabled={!has}
              title={`${x.label} (${x.short})${has ? ` · key ${x.key}` : " · no map for this scenario"}`} onClick={() => press(x.id)}>
              <b>{x.short}</b><span>{x.label.replace(" emissions", "")}</span>
            </button>
          );
        })}
      </div>
      {missing ? <p className="caveat">The package has no {SSPS.find((x) => x.id === ssp).short} run for this map; {SSPS.find((x) => x.id === drawn)?.short ?? "another"} is shown.</p> : null}
      {!avail ? <p className="caveat">{none}{jump ? ` A key opens “${jump.title}”.` : ""}</p> : null}
      {note ? <p className="caveat">{note}</p> : null}
    </section>
  );
}

/** Keys 1, 2, 3 press the key on screen (the panel's, or the ocean year slider's). */
export function useSspShortcuts() {
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (e.target.closest?.("input, textarea, select, [contenteditable], dialog[open], .term")) return;
      const x = SSPS.find((k) => k.key === e.key);
      if (x) document.querySelector(`#panelBody .ssp-key[data-ssp="${x.id}"]:not(:disabled), .om-dock .scen button[data-ssp="${x.id}"]`)?.click();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
