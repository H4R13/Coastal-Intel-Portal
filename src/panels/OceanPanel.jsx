/**
 * Analysis panel for layers backed by the ocean package (layer.ocean = { steps }): a topic picker, the map layers of
 * that topic with their legend, badges and notes, and the topic's charts and tables.
 * Used by the Ocean layer (pH, warming, oxygen, exposure, outlook) and by Fisheries (catch, shellfish, national index).
 */
import { getState, setState, toggleLayer, useStore } from "../state.js";
import { loadDoc, mapVariables, resolveLayer, panelLayers, variableOf } from "../ocean/oceanData.js";
import { gradientCss, CLASS_COLORS } from "../ocean/colormaps.js";
import { NATIONAL, NATIONAL_RAMP, forecastFigure } from "../ocean/national.js";
import { FIRST_YEAR } from "../components/TimeChart.jsx";
import { useAsync } from "../lib.jsx";
import { FigureSections, num } from "./Figures.jsx";
import { SspKeys } from "./SspKeys.jsx";

export const viewOf = (layer, s) => s.oceanView[layer.id] ?? { step: layer.ocean.steps[0], variable: null };
const setView = (layer, patch) => setState({ oceanView: { ...getState().oceanView, [layer.id]: { ...viewOf(layer, getState()), ...patch } } });
const ShowOnMap = ({ layer }) => <button className="xchip" onClick={() => toggleLayer(layer.id, true)}>Show on the map</button>;

function Legend({ l }) {
  if (l.classes) return <ul className="oclasses">{Object.entries(l.classes).map(([k, label], i) => <li key={k}><i style={{ background: CLASS_COLORS[i % CLASS_COLORS.length] }} />{label}</li>)}</ul>;
  return (
    <>
      <div className="oramp" style={{ background: gradientCss(l.colormap) }} />
      <div className="oramp-scale"><span>{num(l.vmin)}</span><span>{l.units ?? ""}</span><span>{num(l.vmax)}</span></div>
    </>
  );
}

/** Topics that are one national number: the sea zone is tinted for that number instead of drawing a grid. */
function NationalSection({ layer, view, onMap }) {
  const def = NATIONAL[view.step];
  if (!def || layer.mapLayer.type !== "national") return null;
  return (
    <section className="block">
      <h3 className="sec-title">On the map</h3>
      {onMap ? null : <ShowOnMap layer={layer} />}
      <p className="about">{def.label}. This is one number for the whole of Pakistan, so the map shows it in a balloon over the sea; the colour of the number follows this scale.</p>
      <div className="oramp" style={{ background: NATIONAL_RAMP }} />
      <div className="oramp-scale"><span>0</span><span>{def.unit}</span><span>{def.max}</span></div>
      <p className="caveat">{def.period ? `The colour changes with the year on the timeline. Measured data covers ${def.period}. After that the colour follows the trend projection to 2030 (chart below) and the balloon says so; beyond 2030 it stays at the 2030 projection.` : "One fixed value: it does not change with the timeline."}</p>
      <p className="caveat">A national figure from reported catch: where the balloon sits says nothing about where in the sea anything happens.</p>
    </section>
  );
}

/** The SSP keys at the top of the panel, for outlook maps only (the 2050 outlook); maps without scenarios show none. */
export function OceanSsp({ layer, catalog }) {
  const chosen = useStore((s) => s.oceanView[layer.id]), view = chosen ?? { step: layer.ocean.steps[0], variable: null }, scenario = useStore((s) => s.oceanScenario);
  const vars = mapVariables(catalog, view.step), L = vars.length && resolveLayer(catalog, view, scenario);
  const current = L && vars.find((v) => v.id === variableOf(L));
  return current?.scenarios ? <SspKeys layer={layer} /> : null;
}

function MapSection({ layer, catalog, view, scenario, onMap }) {
  const vars = mapVariables(catalog, view.step);
  if (!vars.length) return <NationalSection layer={layer} view={view} onMap={onMap} />;
  const L = resolveLayer(catalog, view, scenario);
  const current = L && vars.find((v) => v.id === variableOf(L));
  const opt = (v) => <option key={v.id} value={v.id}>{v.title}</option>;
  const groups = [["Year by year (follows the timeline)", vars.filter((v) => v.yearly)], ["Main results", vars.filter((v) => v.primary && !v.yearly)], ["Other versions", vars.filter((v) => !v.primary && !v.yearly)]].filter(([, list]) => list.length);
  return (
    <section className="block">
      <h3 className="sec-title">Map layer</h3>
      <div className="field"><div className="select">
        <select id="oceanVar" aria-label="Map layer" value={current?.id ?? ""} onChange={(e) => setView(layer, { variable: e.target.value })}>
          {groups.length > 1 ? groups.map(([label, list]) => <optgroup key={label} label={label}>{list.map(opt)}</optgroup>) : vars.map(opt)}
        </select>
      </div></div>
      {onMap ? null : <ShowOnMap layer={layer} />}
      {L ? (
        <>
          <div className="obadges">{(L.badges ?? []).map((b) => <span className="obadge" key={b}>{b}</span>)}</div>
          <p className="about">{L.shows}</p>
          <Legend l={L} />
          {L.overlay ? <p className="caveat">{L.overlay.legend}. Test: {L.overlay.test}.</p> : null}
          <p className="caveat">{L.type === "raster_series"
            ? `Changes with the year on the timeline. Data covers ${Math.max(FIRST_YEAR, L.years[0])}–${L.years.at(-1)}; later years show ${L.years.at(-1)}.`
            : `One fixed map${L.period ? ` for ${L.period}` : ""}: it does not change with the timeline.`}</p>
          <p className="caveat">Shown inside Pakistan's Exclusive Economic Zone only.{L.classes ? "" : " Smoothed between grid points for display; the data itself is on a 25 km or coarser grid."} Where the product stops short of the shore, the nearest value is carried in to the coast; narrow creeks are left out.</p>
          <dl className="meta ometa">
            {L.period ? <div><dt>Period</dt><dd>{L.period}</dd></div> : null}
            {L.product ? <div><dt>Source product</dt><dd>{L.product}</dd></div> : null}
            <div><dt>Method</dt><dd>{L.justification}</dd></div>
          </dl>
          {L.status ? <p className="caveat">{L.status}</p> : null}
        </>
      ) : null}
    </section>
  );
}

/** The topic's charts and tables, drawn once their data has loaded. */
function TopicFigures({ layer, catalog, step }) {
  const items = panelLayers(catalog, step);
  const loaded = useAsync(async () => {
    const [fc, ...data] = await Promise.all([layer.mapLayer.type === "national" ? forecastFigure(step) : null, ...items.map((l) => loadDoc(`data/${l.id}`))]);
    return { step, fc, figures: items.map((l, i) => ({ l, data: data[i] })) };
  }, [layer.id, step]);
  if (!items.length) return null;
  if (!loaded || loaded.step !== step) return <section className="block"><p className="caveat">Loading charts…</p></section>;
  return <FigureSections figures={loaded.figures} first={loaded.fc} />;
}

/** The panel body of a layer with layer.ocean (the caller has checked that the catalog loaded). */
export function OceanPanel({ layer, catalog }) {
  const chosen = useStore((s) => s.oceanView[layer.id]), view = chosen ?? { step: layer.ocean.steps[0], variable: null }, scenario = useStore((s) => s.oceanScenario), onMap = useStore((s) => s.activeLayers.includes(layer.id));
  return (
    <>
      <section className="block">
        <div className="field"><label className="field-label" htmlFor="oceanStep">Topic</label>
          <div className="select"><select id="oceanStep" value={view.step} onChange={(e) => setView(layer, { step: +e.target.value, variable: null })}>
            {layer.ocean.steps.map((st) => <option key={st} value={st}>{catalog.steps[st] ?? `Step ${st}`}</option>)}
          </select></div>
        </div>
      </section>
      <MapSection layer={layer} catalog={catalog} view={view} scenario={scenario} onMap={onMap} />
      <TopicFigures key={`${layer.id}|${view.step}`} layer={layer} catalog={catalog} step={view.step} />
    </>
  );
}
