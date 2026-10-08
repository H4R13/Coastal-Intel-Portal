/**
 * The right-hand analysis panel: the time-range tabs and the body of the layer whose dock icon is selected.
 * Layers backed by the ocean package or the plastics material have their own body (OceanPanel, PlasticsPanel); every
 * other layer gets the standard body, with the package section (AmibPanel) in place of its charts when it has one.
 * When a layer's data is not available (the data API is not running) it falls back to the standard placeholders.
 */
import { useEffect, useLayoutEffect, useRef } from "react";
import { LAYERS, MODES } from "../config/layers.js";
import { getState, setState, setMode, toggleLayer, selectLayer, setSsp, focusLayer, useStore, SSP_SCENARIO } from "../state.js";
import { loadManifest } from "../map/manifest.js";
import { loadCatalog } from "../ocean/oceanData.js";
import { loadAmibCatalog } from "../amib/amibData.js";
import { loadPlastics } from "../plastics/plastics.js";
import { Chart, loadChartData } from "../components/Chart.jsx";
import { Markup, useAsync } from "../lib.jsx";
import { SspKeys, hasSsp } from "./SspKeys.jsx";
import { AmibPanel, AmibSsp } from "./AmibPanel.jsx";
import { OceanPanel, OceanSsp } from "./OceanPanel.jsx";
import { PlasticsPanel } from "./PlasticsPanel.jsx";

/** Historical / Normal / Forecast segmented control with a sliding highlight; each tab is a year range. */
function ModeTabs() {
  const mode = useStore((s) => s.mode);
  const root = useRef(null), ink = useRef(null);
  useLayoutEffect(() => {
    const place = () => {
      const tab = root.current?.querySelector(".mode.active");
      if (tab) { ink.current.style.width = `${tab.offsetWidth}px`; ink.current.style.transform = `translateX(${tab.offsetLeft}px)`; }
    };
    place();
    document.fonts?.ready.then(place);
    window.addEventListener("resize", place);
    const seen = new ResizeObserver(place); // the panel can slide in after first paint, so re-measure when the control resizes
    seen.observe(root.current);
    return () => { window.removeEventListener("resize", place); seen.disconnect(); };
  }, [mode]);
  return (
    <nav className="modes" id="modes" role="tablist" aria-label="Analysis mode" ref={root}>
      {MODES.map((m) => <button key={m.id} role="tab" className={`mode ${m.id === mode ? "active" : ""}`} aria-selected={m.id === mode} title={`${m.from}–${m.to}`} onClick={() => setMode(m.id)}>{m.label}</button>)}
      <span className="mode-ink" aria-hidden="true" ref={ink} />
    </nav>
  );
}

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

function Outlook({ layer, manifest, selected }) {
  const scenarios = manifest?.scenarios ?? [];
  const pick = (value) => { const ssp = Object.keys(SSP_SCENARIO).find((k) => SSP_SCENARIO[k] === value); ssp ? setSsp(ssp) : setState({ scenario: value }); };
  return (
    <section className="block outlook">
      {hasSsp(layer) ? null : (
        <div className="field">
          <label className="field-label" htmlFor="scenario">Scenario</label>
          <div className="select">
            {scenarios.length
              ? <select id="scenario" value={selected} onChange={(e) => pick(e.target.value)}>{scenarios.map((sc) => <option key={sc.id} value={sc.id}>{sc.label}</option>)}</select>
              : <select id="scenario" disabled><option>Select scenario</option></select>}
          </div>
          <small className="muted">{scenarios.length ? manifest.note ?? "" : "Scenarios will be listed once projection data is connected."}</small>
        </div>
      )}
      <div className="field"><span className="field-label">Selected layer</span><strong className="sel-layer" style={{ "--layer": layer.color }}>{layer.title}</strong></div>
      <dl className="indicators one">
        <div className="ind"><dt>Projected change</dt><dd className="empty">—</dd></div>
        <div className="ind"><dt>Confidence</dt><dd className="empty">—</dd></div>
        <div className="ind"><dt>Source</dt><dd className="empty">—</dd></div>
      </dl>
    </section>
  );
}

const NoData = ({ children }) => <div className="empty-note"><b>No data connected yet</b>{children}</div>;

/** The body of a layer without its own panel: scenario keys, outlook, exposure, charts or the package section, about. */
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
  const described = manifest ?? (packageOnly ? { meta: { source: "Saltwater intrusion and salinity package supplied by the project team", spatial: "Pakistan coast" } } : null);
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
      {s.mode === "forecast" ? <Outlook layer={layer} manifest={manifest} selected={s.scenario} /> : null}
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
      {layer.indicators.length && !packageOnly ? <Indicators layer={layer} title={s.mode === "forecast" ? "Forecast indicators" : "Key indicators"} /> : null}
      <About layer={layer} manifest={described} />
    </>
  );
}

function Body({ layer }) {
  // each is undefined while loading and null when the data API is not running
  const ocean = useAsync(() => (layer.ocean ? loadCatalog() : null), [layer.id]);
  const plastics = useAsync(() => (layer.plastics ? loadPlastics() : null), [layer.id]);
  const amib = useAsync(() => (layer.amib ? loadAmibCatalog() : null), [layer.id]);
  if (ocean === undefined || plastics === undefined || amib === undefined) return null;
  if (layer.ocean && ocean) return <>{hasSsp(layer) ? <OceanSsp layer={layer} catalog={ocean} /> : null}<OceanPanel layer={layer} catalog={ocean} /></>;
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
      <div className="panel-head"><ModeTabs /></div>
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
