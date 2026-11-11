/**
 * Panel section for layers backed by the saltwater intrusion / salinity package (layer.amib, see amib/amibData.js and
 * amib/hazards.js): pick a hazard, then its place / river-flow assumption and measure; read the map's legend and notes
 * and the hazard's year-by-year charts. The emissions scenario comes from the SSP keys (AmibSsp, placed at the top of
 * the panel). With layer.amib.browse, every raw layer of the package can still be chosen, folded away at the bottom.
 * Charts plot every scenario of an indicator together, so the low, medium and high emissions lines can be compared.
 */
import { Fragment, useState } from "react";
import { getState, setState, toggleLayer, focusLayer, useStore } from "../state.js";
import { HAZARD_GROUPS } from "../amib/hazards.js";
import { loadAmibDoc, resolveHazard, resolveBrowse, browsable, layerById, scenarioName, hiddenStops, shownColor, clearsBackground, sspAvailability, hazardsOf, legendOf, rampCss } from "../amib/amibData.js";
import { TimeChart, FIRST_YEAR } from "../components/TimeChart.jsx";
import { PopBox, PopButton, useAsync } from "../lib.jsx";
import { SspKeys } from "./SspKeys.jsx";
import { Clip } from "../components/Clip.jsx";

const viewOf = (layer, s) => s.amibView[layer.id] ?? {};
const setView = (layer, patch) => setState({ amibView: { ...getState().amibView, [layer.id]: { ...viewOf(layer, getState()), ...patch } } });

function Legend({ L }) {
  const hidden = hiddenStops(L), stops = legendOf(L).filter((c) => !hidden.includes(c));
  if (!stops.length) return null;
  if (L.kind === "categorical") return <ul className="oclasses">{stops.map((c, i) => <li key={i}><i style={{ background: shownColor(L, c) }} />{c.label ?? L.classes?.[c.value] ?? c.value}</li>)}</ul>;
  return (
    <>
      <div className="oramp" style={{ background: rampCss(stops) }} />
      <div className="oramp-scale"><span>{stops[0].value}</span><span>{L.units ?? ""}</span><span>{stops.at(-1).value}</span></div>
    </>
  );
}

/** Badges, description, legend and notes of the map that is drawn. */
function MapDetails({ L, catalog, byYear = false }) {
  if (!L) return <p className="caveat">This map is not in the loaded package.</p>;
  const hidden = hiddenStops(L);
  const when = L.steps
    ? `Changes with the year on the timeline. Covers ${Math.max(FIRST_YEAR, L.steps[0].t)}–${L.steps.at(-1).t}.`
    : byYear ? `Outlook map for ${L.year}: the newest outlook year at or before the timeline year is shown (maps exist for 2030, 2050, 2070, 2090).`
    : `One fixed map${L.year ? ` for ${L.year}` : ""}: it does not change with the timeline.`;
  return (
    <>
      <div className="obadges">
        <span className="obadge" title={catalog.labels[L.label] ?? ""}>{L.label ?? ""}</span>
        {L.scenario ? <span className="obadge">{scenarioName(L.scenario)}</span> : null}
        {L.year ? <span className="obadge">{L.year}</span> : null}
      </div>
      <p className="about">{L.what ?? L.name}</p>
      <Legend L={L} />
      <p className="caveat">{when}</p>
      {hidden.length ? <p className="caveat">Not drawn on the map: {hidden.map((c) => c.label ?? L.classes?.[c.value]).join(", ")}.</p> : null}
      {clearsBackground(L) ? <p className="caveat">The most common value fills most of the map as one flat colour, so it is left clear; colour marks where the value differs.</p> : null}
      {catalog.labels[L.label] ? <p className="caveat">{L.label}: {catalog.labels[L.label]}.</p> : null}
      {L.note ? <p className="caveat">{L.note}</p> : null}
    </>
  );
}

function HazardList({ layer, h, raw }) {
  const pick = (x) => { setView(layer, { hazard: x.id, variant: 0, measure: undefined, raw: null }); focusLayer(layer.id); }; // the map goes to the new map's area
  const item = (x) => {
    const on = !raw && x.id === h.hazard.id;
    return (
      <button key={x.id} className={`hz-item ${on ? "active" : ""}`} aria-pressed={on} onClick={() => pick(x)}>
        <b>{x.title}</b><span>{x.insight}</span>{x.variants.some((v) => v.ssp) ? <i className="hz-tag" title="Has emissions scenarios">SSP</i> : null}
      </button>
    );
  };
  const grouped = layer.amib.hazards === "all";
  return (
    <section className="block hz">
      <h3 className="sec-title">{grouped ? "Hazards" : "Hazards under this layer"}</h3>
      {grouped
        ? HAZARD_GROUPS.map((g) => <Fragment key={g.id}><h4 className="hz-group">{g.title}</h4><div className="hz-grid">{h.hazards.filter((x) => x.group === g.id).map(item)}</div></Fragment>)
        : <div className="hz-grid">{h.hazards.map(item)}</div>}
    </section>
  );
}

function HazardMap({ layer, h, catalog, onMap }) {
  const { hazard, variant, measure } = h;
  return (
    <section className="block">
      <h3 className="sec-title">{hazard.title}</h3>
      {hazard.variants.length > 1 ? (
        <div className="xchips" role="group" aria-label="Place or assumption">
          {hazard.variants.map((v, i) => <button key={i} className={`xchip ${v === variant ? "active" : ""}`} onClick={() => { setView(layer, { variant: i }); focusLayer(layer.id); }}>{v.label}</button>)}
        </div>
      ) : null}
      {hazard.measures ? (
        <div className="xchips" role="group" aria-label="Measure">
          {hazard.measures.map((m) => <button key={m.id} className={`xchip ${m === measure ? "active" : ""}`} onClick={() => setView(layer, { measure: m.id })}>{m.label}</button>)}
        </div>
      ) : null}
      {!onMap ? <button className="xchip" onClick={() => toggleLayer(layer.id, true)}>Show on the map</button> : null}
      <MapDetails L={h.L} catalog={catalog} byYear={Array.isArray(h.variant.ssp?.[h.sspUsed])} />
    </section>
  );
}

/** One indicator: a chart of every scenario for one zone, with chips to switch zone. */
function IndicatorChart({ product, name, variant, open: startOpen }) {
  const [open, setOpen] = useState(startOpen), [zone, setZone] = useState(null);
  const doc = useAsync(() => loadAmibDoc(`series/${product}`), [product]); // one file per topic, shared by its charts
  const ind = doc?.[name];
  let body = null;
  if (open && doc !== undefined) {
    if (!ind) body = <p className="caveat">Data not available.</p>;
    else {
      const zones = [...new Set(ind.series.map((x) => x.zone))], z = zones.includes(zone) ? zone : zones.includes(variant.zone) ? variant.zone : zones[0];
      const keep = variant.chartKeep;
      const groups = ind.series.filter((x) => x.zone === z && (!keep || keep.test(x.scenario)))
        .map((x) => ({ name: scenarioName(x.scenario), points: x.year.map((y, i) => ({ x: y, y: x.p50[i] })).filter((p) => p.y != null) }))
        .filter((g) => g.points.length);
      body = !groups.length ? <p className="caveat">No values.</p> : (
        <>
          {zones.length > 1 ? <div className="xchips">{zones.map((x) => <button key={x} className={`xchip ${x === z ? "active" : ""}`} onClick={() => setZone(x)}>{String(x).replace(/_/g, " ")}</button>)}</div> : null}
          <PopBox className="chart"><figcaption><span className="chart-title">{name}</span><PopButton /></figcaption><TimeChart groups={groups} yLabel={name} unit={ind.unit} /></PopBox>
        </>
      );
    }
  }
  return (
    <details className="oitem amib-chart" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{name}</summary><div className="oitem-body">{body}</div>
    </details>
  );
}

function Browse({ layer, catalog, view }) {
  const [open, setOpen] = useState(!!view.raw); // remembered while this layer's panel stays open
  const b = resolveBrowse(catalog, layer, view);
  const count = browsable(catalog).length;
  const rawLayer = view.raw && layerById(catalog, view.raw);
  return (
    <section className="block">
      <details className="hz-browse" open={open || !!view.raw} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary>All package layers <small className="muted">{count} maps</small></summary>
        <p className="caveat">Every map of the package, by topic. Choosing one here replaces the hazard map until a hazard is picked again.</p>
        <div className="field"><label className="field-label" htmlFor="amibProduct">Topic</label><div className="select">
          <select id="amibProduct" value={b.product ?? ""} onChange={(e) => setView(layer, { product: e.target.value, subgroup: undefined, raw: null })}>
            {b.topics.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select></div></div>
        <div className="field"><label className="field-label" htmlFor="amibGroup">Group</label><div className="select">
          <select id="amibGroup" value={b.subgroup ?? ""} onChange={(e) => setView(layer, { subgroup: e.target.value, raw: null })}>
            {b.subgroups.map((g) => <option key={g} value={g}>{g}</option>)}
          </select></div></div>
        <div className="field"><label className="field-label" htmlFor="amibLayer">Layer</label><div className="select">
          <select id="amibLayer" value={view.raw ?? ""} onChange={(e) => { setView(layer, { raw: e.target.value || null }); if (e.target.value) toggleLayer(layer.id, true); }}>
            <option value="">None (use the hazard map)</option>
            {b.layers.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select></div></div>
        {rawLayer ? <MapDetails L={rawLayer} catalog={catalog} /> : null}
      </details>
    </section>
  );
}

/** The SSP keys for this layer's current hazard map; nothing when that map has no scenarios (observed maps, a raw package layer) or the package is not available. */
export function AmibSsp({ layer, catalog }) {
  const s = useStore();
  if (!catalog || !hazardsOf(layer).length) return null;
  const view = viewOf(layer, s), raw = view.raw && layerById(catalog, view.raw);
  const h = resolveHazard(catalog, layer, view, s.ssp, s.year);
  if (raw || !h.variant.ssp) return null; // hazards with scenarios carry the "SSP" tag in the list below
  return <SspKeys layer={layer} avail={sspAvailability(h.variant)} used={h.sspUsed} />;
}

/** The package section of a layer with layer.amib (the caller has checked that the catalog loaded). */
export function AmibPanel({ layer, catalog }) {
  const s = useStore();
  const view = viewOf(layer, s), h = resolveHazard(catalog, layer, view, s.ssp, s.year);
  if (!h) return null;
  const raw = view.raw && layerById(catalog, view.raw);
  const charts = [...(h.variant.charts ?? h.hazard.charts), ...(h.measure?.chart ? [{ product: h.hazard.product, name: h.measure.chart }] : [])];
  return (
    <>
      <HazardList layer={layer} h={h} raw={raw} />
      {layer.video ? <Clip video={layer.video} /> : null}
      {raw ? null : <HazardMap layer={layer} h={h} catalog={catalog} onMap={s.activeLayers.includes(layer.id)} />}
      {charts.length && !raw ? (
        <section className="block">
          <h3 className="sec-title">Charts by year</h3>
          {charts.map((c, i) => <IndicatorChart key={`${h.hazard.id}|${h.variant.label}|${c.product}|${c.name}`} product={c.product} name={c.name} variant={h.variant} open={i === 0} />)}
        </section>
      ) : null}
      {layer.amib.browse ? <Browse key={layer.id} layer={layer} catalog={catalog} view={view} /> : null}
    </>
  );
}
