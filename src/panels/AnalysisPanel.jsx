/**
 * The right-hand analysis panel: the body of the layer whose dock icon is selected.
 * The Ocean and Fisheries layers show the ocean monitoring package's panel (src/oceanMonitoring/), Nutrients & Plankton
 * its own in the same look (src/nutrients/), the plastics layer its own body (PlasticsPanel); every
 * other layer gets the standard body, with the package section (AmibPanel) in place of its charts when it has one.
 * When a layer's data is not available (the data API is not running) it falls back to the standard placeholders.
 */
import { useEffect, useRef } from "react";
import { LAYERS } from "../config/layers.js";
import { getState, setState, toggleLayer, selectLayer, focusLayer, useStore } from "../state.js";
import { loadManifest } from "../map/manifest.js";
import { loadAmibCatalog } from "../amib/amibData.js";
import { loadPlastics } from "../plastics/plastics.js";
import { Chart, loadChartData } from "../components/Chart.jsx";
import { Markup, useAsync } from "../lib.jsx";
import { Clip } from "../components/Clip.jsx";
import { SspKeys, hasSsp } from "./SspKeys.jsx";
import { AmibPanel, AmibSsp } from "./AmibPanel.jsx";
import { OmPanelBody, isOmLayer } from "../oceanMonitoring/OceanMonitoring.jsx";
import { NpPanelBody, isNpLayer } from "../nutrients/Nutrients.jsx";
import { PlasticsPanel } from "./PlasticsPanel.jsx";

function Indicators({ layer, title }) {
  return (
    <section className="block">
      <h3 className="sec-title">{title}</h3>
      <dl className="indicators">
        {layer.indicators.map((i) => <div className="ind" key={i.label}><dt>{i.label}</dt><dd className={i.value == null ? "empty" : ""}>{i.value == null ? "—" : <>{i.value}{i.unit ? <> <small>{i.unit}</small></> : null}</>}</dd></div>)}
      </dl>
    </section>
  );
}

function About({ layer, manifest }) {
  const m = { ...layer.meta, ...manifest?.meta }; // a connected layer describes itself through its manifest
  const row = (label, v, fallback) => <div><dt>{label}</dt><dd className={v ? "" : "muted"}>{v ?? fallback}</dd></div>;
  return (
    <section className="block">
      <h3 className="sec-title">What this layer shows</h3>
      <Markup as="p" className="about" html={layer.about} />
      <h3 className="sec-title sub">Data availability</h3>
      <ul className="avail">{layer.availability.map((x) => <li key={x}><span>{x}</span><em>{manifest ? "Connected" : "Awaiting dataset"}</em></li>)}</ul>
      <dl className="meta">
        {row("Data source", m.source, "Not connected")}
        {row("Temporal coverage", m.temporal, "Not available")}
        {row("Spatial coverage", m.spatial, "Not available")}
        {row("Last updated", m.updated, "Not available")}
      </dl>
    </section>
  );
}

/* Sea-level exposure sets built by tools/build-flood.mjs (data/sealevel/index.json); empty if none have been built. */
const floodLevels = fetch("data/sealevel/index.json").then((r) => (r.ok ? r.json() : null)).then((j) => j?.levels ?? []).catch(() => []);

function Exposure({ levels, selected }) {
  if (!levels?.length) return null;
  const chip = (id, label) => <button key={id ?? "off"} className={`xchip ${selected === id ? "active" : ""}`} data-flood={id ?? ""} onClick={() => setState({ floodId: id })}>{label}</button>;
  const sel = levels.find((l) => l.id === selected);
  return (
    <section className="block exposure">
      <h3 className="sec-title">Terrain exposure</h3>
      <p className="about">Which land lies below a given water level and is open to the sea, from the 12.5 m terrain model (heights above mean sea level).</p>
      <div className="xchips">{chip(null, "Off")}{levels.map((l) => chip(l.id, `+${l.level_m} m`))}</div>
      {sel ? <dl className="indicators one"><div className="ind"><dt>Land exposed</dt><dd>{sel.approxFloodedAreaKm2.toLocaleString()} <small>km²</small></dd></div></dl> : null}
      <p className="caveat">Terrain exposure, not a projection: no tides, defences, subsidence or erosion. Vertical error of the model in the flat delta is about 1–3 m.</p>
    </section>
  );
}

const NoData = ({ children }) => <div className="empty-note"><b>No data connected yet</b>{children}</div>;

/** The body of a layer without its own panel: scenario keys, exposure, charts or the package section, about. */
function StandardBody({ layer, amibCatalog }) {
  const s = useStore();
  const chartCfg = layer.charts[s.chartIndex] ?? layer.charts[0];
  const manifest = useAsync(() => loadManifest(layer), [layer.id]);
  const chart = useAsync(async () => ({ cfg: chartCfg, data: await loadChartData(chartCfg) }), [chartCfg]);
  const levels = useAsync(() => floodLevels, []);
  if (manifest === undefined || (chartCfg && chart === undefined) || levels === undefined) return null; // first load
  const data = chart?.cfg === chartCfg ? chart.data : null;
  // a layer fed by the intrusion/salinity package shows that package's section in place of the placeholder charts
  const packageOnly = !!(layer.amib && amibCatalog);
  const described = manifest ?? (packageOnly ? { meta: { source: "Saline water intrusion and salinity package supplied by the project team", spatial: "Pakistan coast" } } : null);
  const seeAlso = () => {
    const { layer: to, hazard } = layer.seeAlso;
    setState({ amibView: { ...getState().amibView, [to]: { ...getState().amibView[to], hazard, variant: 0, raw: null } } });
    selectLayer(to);
    focusLayer(to);
  };
  return (
    <>
      {s.activeLayers.length ? (
        <div className="overlay-note"><span className="field-label">On the map</span>
          {s.activeLayers.map((id) => { const l = LAYERS.find((x) => x.id === id); return <span className="chip" key={id} style={{ "--layer": l.color }}>{l.title}</span>; })}
        </div>
      ) : null}
      {layer.amib ? <AmibSsp layer={layer} catalog={amibCatalog} />
        : hasSsp(layer) ? <SspKeys layer={layer} note="Mangrove projections exist for 2030, 2040 and 2050 (Cellular Automata–Markov model); mapped years are the same in every scenario." /> : null}
      {manifest && !s.activeLayers.includes(layer.id) ? (
        <div className="show-on-map"><button className="xchip" onClick={() => toggleLayer(layer.id, true)}>Show on the map</button><small className="muted">The map then follows the year on the timeline.</small></div>
      ) : null}
      {layer.id === "sealevel" ? <Exposure levels={levels} selected={s.floodId} /> : null}
      {packageOnly ? <AmibPanel layer={layer} catalog={amibCatalog} />
        : chartCfg ? (
          <section className="block">
            <div className="chart-tabs" role="tablist">
              {layer.charts.map((c, i) => <button key={c.title} role="tab" className={`ctab ${i === s.chartIndex ? "active" : ""}`} aria-selected={i === s.chartIndex} onClick={() => setState({ chartIndex: i })}>{c.title}</button>)}
            </div>
            <Chart cfg={chartCfg} data={data} />
            {!data ? <NoData><p>This visualization will display {chartCfg.placeholder.replace(/ will appear here$/, "").toLowerCase()} once the dataset is connected.</p><span className="src"><i>Data source</i>Pending integration</span></NoData> : null}
          </section>
        ) : <section className="block"><NoData><p>This layer's data is served by the portal's data API, which is not running.</p></NoData></section>}
      {layer.seeAlso ? <section className="block see-also"><Markup as="p" className="about" html={layer.seeAlso.text} /><button className="xchip" onClick={seeAlso}>Open Coastal Hazards</button></section> : null}
      {packageOnly ? null /* the package section shows the layer's video itself */
        : layer.video ? <Clip video={layer.video} />
        : layer.indicators.length ? <Indicators layer={layer} title="Key indicators" /> : null}
      <About layer={layer} manifest={described} />
    </>
  );
}

function Body({ layer }) {
  // each is undefined while loading and null when the data API is not running
  const plastics = useAsync(() => (layer.plastics ? loadPlastics() : null), [layer.id]);
  const amib = useAsync(() => (layer.amib ? loadAmibCatalog() : null), [layer.id]);
  if (isOmLayer(layer)) return <OmPanelBody />;
  if (isNpLayer(layer)) return <NpPanelBody />;
  if (plastics === undefined || amib === undefined) return null;
  if (layer.plastics && plastics) return <PlasticsPanel layer={layer} d={plastics} />;
  return <StandardBody layer={layer} amibCatalog={amib} />;
}

export function AnalysisPanel() {
  const id = useStore((s) => s.primaryLayer);
  const layer = LAYERS.find((l) => l.id === id);
  const scroller = useRef(null);
  useEffect(() => { if (scroller.current) scroller.current.scrollTop = 0; }, [id]); // a new layer starts at the top; choices inside a panel keep the reader's place
  return (
    <aside id="analysis" className="analysis" aria-label="Analysis">
      <div className="panel-scroll" id="panelBody" ref={scroller}>
        <div className="fade" key={id} style={{ "--layer": layer.color }}>
          <header className="layer-head">
            <Markup className="layer-head-icon" html={layer.icon} />
            <div><h2>{layer.title}</h2><Markup as="p" html={layer.lead} /></div>
          </header>
          <Body key={id} layer={layer} />
        </div>
      </div>
    </aside>
  );
}
