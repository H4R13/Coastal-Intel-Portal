/**
 * Analysis panel for the plastics layer (layer.plastics): a topic picker over the parts of the DMJM material (the
 * sampling stations, the published measurements, the food web, the hazard pathways, and the two models: debris
 * index and biomagnification), the controls of the chosen part, and its charts. Charts are drawn by Figures.jsx.
 */
import { useEffect, useState } from "react";
import { getState, setState, toggleLayer, useStore } from "../state.js";
import { viewOf, stationFigures, literatureFigures, speciesFigures, hazardFigures, indexFigures, biomagFigures, samplingPeriod, POINT_KEY, SCALE_MAX, PLASTIC_RAMP, DENSITY_UNIT, INDEX_CLASSES } from "../plastics/plastics.js";
import { FigureSections } from "./Figures.jsx";

const TOPICS = [["stations", "Plastic density at the sampling stations"], ["literature", "Published microplastic measurements"], ["species", "Microplastics and metals in the food web"], ["hazards", "Hazard pathways and their severity"], ["index", "Debris pressure index (illustration)"], ["biomag", "Biomagnification in the food chain (illustration)"]];
// the team's own hardcoded page for each topic, opened in a new browser tab (public/plastics/index.html)
const FULL_PAGE = { stations: "portal", literature: "portal", species: "portal", hazards: "portal", index: "simulation", biomag: "biomagnification" };
const ABOUT = {
  literature: "Microplastics measured in seawater, sediment, fish and crabs along the coast of Sindh and Balochistan, taken from published studies. The papers are listed in the data tables below.",
  species: "Eight species of the delta's food web, from filter feeders to top predators: how many microplastic particles each carries and how much heavy metal is in its tissue.",
  hazards: "Seven ways plastic debris harms people and the delta, each scored out of 10 for severity.",
};
const set = (patch) => setState({ plasticsView: { ...viewOf(getState()), ...patch } });
const Chips = ({ list, current, onPick }) => (
  <div className="xchips" role="group">{list.map(([id, label]) => <button key={id} className={`xchip ${String(id) === String(current) ? "active" : ""}`} onClick={() => onPick(id)}>{label}</button>)}</div>
);

/** The magnification slider shows its value while it is dragged and applies it when it is let go. */
function TmfSlider({ value }) {
  const [live, setLive] = useState(value);
  useEffect(() => setLive(value), [value]);
  const commit = (e) => set({ tmf: +e.currentTarget.value });
  return (
    <div className="field"><label className="field-label" htmlFor="plasticTmf">Magnification per food-chain step: <b>{live}×</b></label>
      <input className="orange" id="plasticTmf" type="range" min="0.8" max="3" step="0.1" value={live} onChange={(e) => setLive(+e.target.value)} onPointerUp={commit} onKeyUp={commit} onBlur={commit} /></div>
  );
}

function Controls({ layer, d, v, onMap }) {
  if (v.topic === "stations") {
    return (
      <section className="block">
        <h3 className="sec-title">On the map</h3>
        {onMap ? null : <button className="xchip" onClick={() => toggleLayer(layer.id, true)}>Show on the map</button>}
        <p className="about">The large dots are the sampling stations in the Indus Delta creeks, coloured by plastic {DENSITY_UNIT}. Click any dot for its numbers.</p>
        <div className="oramp" style={{ background: PLASTIC_RAMP }} />
        <div className="oramp-scale"><span>0</span><span>{DENSITY_UNIT}</span><span>{SCALE_MAX}</span></div>
        <ul className="oclasses">{POINT_KEY.map(([c, label]) => <li key={label}><i style={{ background: c, borderRadius: "50%" }} />{label}</li>)}</ul>
        <p className="caveat">The {d.stations.length} stations were sampled {samplingPeriod(d)}; the {d.literature.sites.length} smaller dots along the coast are published measurements. The dots stay the same for every year on the timeline.</p>
      </section>
    );
  }
  if (ABOUT[v.topic]) return <section className="block"><h3 className="sec-title">About this topic</h3><p className="about">{ABOUT[v.topic]}</p></section>;
  if (v.topic === "index") {
    return (
      <section className="block">
        <h3 className="sec-title">How to read it</h3>
        <p className="about">A relative index of plastic debris pressure for the Indus Delta. It starts at 100 in 2020 and grows by an assumed share every year; the chart shows the three rates side by side.</p>
        <ul className="oclasses">{INDEX_CLASSES.map(([c, label]) => <li key={label}><i style={{ background: c }} />{label}</li>)}</ul>
        <p className="caveat">The classes are bands of increase since 2020 chosen for the illustration, not official limits. No measured data goes into this index, so it is not drawn on the map.</p>
      </section>
    );
  }
  return (
    <section className="block">
      <h3 className="sec-title">Assumptions</h3>
      <span className="field-label">Source grows each year by</span>
      <Chips list={[[2, "2 %"], [4, "4 %"], [6, "6 %"]]} current={v.growth} onPick={(id) => set({ growth: id })} />
      <span className="field-label">From 2027</span>
      <Chips list={[["continue", "Keeps growing"], ["0", "Levels off"], ["-2", "Falls 2 % a year"]]} current={v.after} onPick={(id) => set({ after: id })} />
      <TmfSlider value={v.tmf} />
      <p className="caveat">Above 1 the contaminant builds up at each step; at 1 it stays level; below 1 it thins out. No measured data goes into this model, so it is not drawn on the map.</p>
    </section>
  );
}

/** The panel body of the plastics layer (the caller has checked that the data loaded: d). */
export function PlasticsPanel({ layer, d }) {
  const s = useStore(), v = viewOf(s);
  const figures = { stations: stationFigures, literature: literatureFigures, species: speciesFigures, hazards: hazardFigures, index: indexFigures }[v.topic]?.(d) ?? biomagFigures(v);
  return (
    <>
      <section className="block">
        <div className="field"><label className="field-label" htmlFor="plasticTopic">Topic</label>
          <div className="select"><select id="plasticTopic" value={v.topic} onChange={(e) => set({ topic: e.target.value })}>
            {TOPICS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select></div>
        </div>
        <a className="xchip xlink" href={`plastics/index.html#${FULL_PAGE[v.topic]}`} target="_blank" rel="noopener">Open the full-page view ↗</a>
      </section>
      <Controls layer={layer} d={d} v={v} onMap={s.activeLayers.includes(layer.id)} />
      <div key={v.topic}><FigureSections figures={figures} /></div>
    </>
  );
}
