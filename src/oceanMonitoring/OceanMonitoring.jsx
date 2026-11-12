/**
 * The ocean monitoring package's screens, in the portal's dark look (see om.js for what they show and why).
 * While the Ocean or Fisheries layer is open (OM mode, src/App.jsx), the map area changes as in the package's own app:
 *   - left: the package's layer list (OmLeft), down to just above its legend, scrolling;
 *   - top: the layer's title card and the map tools (opacity, compare, measurement points);
 *   - bottom: the package's year slider (OmDock, in place of the portal timeline), with the portal's layer dock lying
 *     above it (src/components/Sidebar.jsx, .om-mode in styles.css);
 *   - the free map area: the national cards (catch, national index) and the compare map;
 *   - right: the analysis panel's body is the package's panel (OmPanelBody).
 */
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { BASEMAPS } from "../config/basemaps.js";
import { getState, useStore } from "../state.js";
import * as om from "./om.js";
import "./om.css";

const { useOm, TABS, SCEN } = om;
export const isOmLayer = (layer) => layer?.mapLayer?.type === "oceanMonitoring";

const ICONS = {
  map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z"/><path d="M9 4v14M15 6v14"/>',
  drop: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z"/>',
  thermo: '<path d="M14 14.76V5a2 2 0 1 0-4 0v9.76a4 4 0 1 0 4 0Z"/>',
  wave: '<path d="M3 9c3 0 3-2 6-2s3 2 6 2 3-2 6-2"/><path d="M3 15c3 0 3-2 6-2s3 2 6 2 3-2 6-2"/>',
  fish: '<path d="M3 12c3-4 7-5 11-3l5-3v12l-5-3c-4 2-8 1-11-3Z"/><circle cx="14.5" cy="11" r=".8" fill="#fff"/>',
  gauge: '<path d="M4 16a8 8 0 1 1 16 0"/><path d="m12 16 4-5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
};
const Svg = ({ paths, size = 16, stroke = "currentColor", width = 2, fill = "none" }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill={fill} stroke={stroke} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: paths }} />
);
const Chev = () => <Svg paths='<path d="m9 6 6 6-6 6"/>' size={15} />;
const Html = ({ as: Tag = "div", html, ...rest }) => <Tag {...rest} dangerouslySetInnerHTML={{ __html: html }} />;

/** Opens the portal layer's own tab when that layer becomes the open one (Ocean: pH; Fisheries: fish stocks). */
export function useOmTab(layer) {
  useEffect(() => { if (isOmLayer(layer)) om.selectTab(layer.mapLayer.tab); }, [layer?.id]);
}

/* ---------------- left: layer list and legend */
function LayerButton({ id, color }) {
  const l = om.layers()[id], on = useOm((s) => s.layer === id);
  const proj = l.projection ? om.layers()[l.projection] : null;
  const title = l.title.replace(/, each year \(time slider\)| \(time slider\)/, "").replace(/ \(CMEMS-LSCE\)$/, "");
  const sub = l.type === "layer_set" ? `${l.period} · slider: ${l.items.map((x) => x[1]).join(", ")}`
    : l.type === "raster_series" ? `${l.years[0]}-${l.years[l.years.length - 1]} · year slider${proj ? " + projection to 2050" : ""}`
      : (l.period || "") + (l.overlay ? " · dots = significant" : "");
  return (
    <button className={`lyr ${on ? "on" : ""}`} style={{ "--tc": color }} onClick={() => om.selectLayer(id)} aria-pressed={on}>
      <div className="t"><span className="radio" /><span>{title}</span></div>
      <div className="sub">{sub}</div>
      <div className="badges">
        {(l.badges || []).map((b) => <span key={b} className={`b ${/not official|preliminary|not robust/.test(b) ? "warn" : ""}`}>{b}</span>)}
        {proj ? <span className="b proj">projection 2030-2050</span> : null}
      </div>
    </button>
  );
}

function Tab({ t }) {
  const open = useOm((s) => s.open.includes(t.id)), groupsOpen = useOm((s) => s.groupsOpen), layer = useOm((s) => s.layer), vectors = useOm((s) => s.vectors);
  const color = om.tabColor(t), L = om.layers();
  return (
    <div className={`tabg ${open ? "open" : ""}`} style={{ "--tc": color }}>
      <button className="tabh" aria-expanded={open} onClick={() => om.toggleTab(t.id)}>
        <span className="ic" style={{ background: t.color }}><Svg paths={ICONS[t.icon]} stroke="#fff" width={1.8} /></span>
        <span>{t.title}{t.main ? <span className="main">MAIN</span> : null}<span className="st">{t.steps}</span></span>
        <Chev />
      </button>
      {open ? (
        <div className="tabb">
          {(t.vectors || []).filter((v) => L[v]).map((v) => (
            <label className="chk" key={v}><input type="checkbox" checked={!!vectors[v]} onChange={(e) => om.setVector(v, e.target.checked)} /> {L[v].title}</label>
          ))}
          {(t.groups || []).map((g) => {
            const ids = om.groupLayers(g); if (!ids.length) return null;
            const key = `${t.id}:${g.title}`, gOpen = groupsOpen.includes(key), has = ids.includes(layer);
            return (
              <div className={`grp ${gOpen ? "open" : ""} ${has ? "has-on" : ""}`} key={key}>
                <button className="grph" aria-expanded={gOpen} onClick={() => om.toggleGroup(key)}><i className="dot" />{g.title}<span className="cnt">{ids.length}</span><Chev /></button>
                {gOpen ? <div className="grpb">{ids.map((id) => <LayerButton key={id} id={id} color={color} />)}</div> : null}
              </div>
            );
          })}
          {(t.chartOnly || []).map((c) => (
            <button key={c.id} className={`lyr ${layer === c.id ? "on" : ""}`} style={{ "--tc": color }} onClick={() => om.selectLayer(c.id)}>
              <div className="t"><span className="radio" /><span>{c.title}</span></div>
              <div className="sub">charts in the right panel (national data, no map layer)</div>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function OmLeft() {
  const ready = useOm((s) => s.ready), error = useOm((s) => s.error), legend = useOm((s) => s.legend);
  useEffect(() => { om.start(); }, []);
  return (
    <div className="om-left">
      <section className="om-side" aria-label="Ocean monitoring layers">
        <div className="side-h"><span className="card-kicker">Ocean monitoring layers</span></div>
        <div className="side-body">
          {error ? <p className="note-sm">{error}</p> : !ready ? <p className="note-sm">Loading the ocean monitoring package…</p> : TABS.map((t) => <Tab key={t.id} t={t} />)}
        </div>
      </section>
      {legend ? <Html className="om-legend legend-om" html={`<span class="card-kicker">Legend</span>${legend}`} /> : null}
    </div>
  );
}

/* ---------------- top: title card and map tools */
export function OmTop() {
  const title = useOm((s) => s.title), opacity = useOm((s) => s.opacity), cmp = useOm((s) => s.cmp), compare = useOm((s) => s.compare);
  const meas = useOm((s) => s.meas), measOn = useOm((s) => s.measOn), loading = useOm((s) => s.loading), card = useOm((s) => s.card);
  const box = useRef(null);
  const tools = useRef(null);
  useLayoutEffect(() => { // to the right of the portal's title plate, up to the tools
    const place = () => {
      const brand = document.querySelector(".brand-float"), area = box.current?.closest(".map-area");
      if (!brand || !area || !box.current || !tools.current) return;
      const a = area.getBoundingClientRect(), left = brand.getBoundingClientRect().right - a.left + 14;
      const right = (tools.current.offsetWidth ? tools.current.getBoundingClientRect().left : a.right) - a.left - 14;
      box.current.style.left = `${left}px`;
      box.current.style.maxWidth = `${Math.max(220, Math.min(460, right - left))}px`;
      // the national cards start below the title card
      area.closest(".shell")?.style.setProperty("--om-top", `${Math.max(110, box.current.hidden ? 0 : box.current.getBoundingClientRect().bottom - a.top + 14)}px`);
    };
    place();
    window.addEventListener("resize", place); window.addEventListener("panelschange", place);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("panelschange", place); };
  });
  return (
    <>
      <div className="om-title" ref={box} hidden={!title}>
        {title ? <>
          <div className="k" style={{ color: title.color }}>{title.k}</div>
          <div className="v">{title.v}</div>
          {title.s || title.when ? <div className="s">{title.when ? <b>{title.when}</b> : null}{title.when && title.s ? " · " : null}{title.s}</div> : null}
        </> : null}
      </div>
      <div className="om-tools" ref={tools}>
        {card ? null : <label className="om-pill om-opacity"><span>Opacity</span><input type="range" min="0" max="100" value={Math.round(opacity * 100)} onChange={(e) => om.setOpacity(e.target.value / 100)} /></label>}
        {cmp ? (
          <button className="om-pill" aria-pressed={compare} onClick={() => om.setCompare(!compare)} title="Compare this layer with its linked layer, side by side">
            <Svg paths='<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>' /><span>{compare ? "Close compare" : `Compare with: ${cmp.label}`}</span>
          </button>
        ) : null}
        {meas ? (
          <button className="om-pill om-meas" aria-pressed={measOn} onClick={om.toggleMeas} title="Show where the checks were measured">
            <span className="sw"><i /></span><span>{meas.label}</span>
          </button>
        ) : null}
        {meas && measOn ? <Html className="om-pill om-meas-legend" html={meas.legend} /> : null}
      </div>
      {loading ? <div className="om-loading">Loading…</div> : null}
    </>
  );
}

/* ---------------- bottom: the year slider (observed years, then 2030-2050 for the chosen scenario) */
function pos(entries, i) {
  const nObs = entries.filter((e) => e.kind !== "proj").length, nP = entries.length - nObs;
  if (!nP) return nObs > 1 ? i / (nObs - 1) : 0;
  if (i < nObs) return 0.76 * (nObs > 1 ? i / (nObs - 1) : 0);
  return 0.855 + 0.145 * (nP > 1 ? (i - nObs) / (nP - 1) : 1);
}
function nearest(entries, v) {
  let best = 0, d = 9;
  entries.forEach((_, i) => { const x = Math.abs(pos(entries, i) - v); if (x < d) { d = x; best = i; } });
  return best;
}
/** Year labels under the slider: as many as fit its width, never overlapping (the package's drawTicks). */
function tickList(entries, W) {
  const n = entries.length, firstProj = entries.findIndex((e) => e.kind === "proj");
  const isLastObs = (i) => firstProj > 0 && i === firstProj - 1;
  const want = entries.map((e, i) => e.kind === "drv" || e.kind === "proj" || isLastObs(i) || i === 0 || e.year % 10 === 0);
  // priority: the end of the slider (2050), the last observed year, the other projection decades, the first year, the decades
  const rank = (i) => (i === n - 1 ? 0 : isLastObs(i) ? 1 : entries[i].kind === "proj" ? 2 : i === 0 ? 3 : 4);
  const placed = [], gap = 34 * (parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--fs")) || 1); // a year label's width
  entries.map((e, i) => i).filter((i) => want[i]).sort((a, b) => rank(a) - rank(b) || a - b).forEach((i) => {
    const x = pos(entries, i) * W;
    if (placed.every((p) => Math.abs(p - x) >= (entries[i].kind === "drv" ? 30 : gap))) placed.push(x); else want[i] = false;
  });
  return entries.map((e, i) => (want[i] ? i : -1)).filter((i) => i >= 0);
}

export function OmDock() {
  const entries = useOm((s) => s.entries), idx = useOm((s) => s.idx), playing = useOm((s) => s.playing), layer = useOm((s) => s.layer);
  const scenario = useStore((s) => s.oceanScenario);
  const root = useRef(null), slider = useRef(null);
  const [W, setW] = useState(300);
  useLayoutEffect(() => { // the factor dock lies on top of the slider: tell it how tall the slider is
    const shell = root.current?.closest(".shell"), el = root.current;
    if (!el || !shell) return undefined;
    const ro = new ResizeObserver(() => { shell.style.setProperty("--om-dock-h", `${el.offsetHeight}px`); if (slider.current) setW(slider.current.getBoundingClientRect().width || 300); });
    ro.observe(el);
    if (slider.current) ro.observe(slider.current); // the scenario buttons come and go and take room from the slider
    return () => { ro.disconnect(); shell.style.setProperty("--om-dock-h", "0px"); };
  }, [entries.length > 1]);
  if (entries.length < 2) return null;
  const e = entries[idx] || {}, firstProj = entries.findIndex((x) => x.kind === "proj");
  const cut = firstProj > 0 ? (pos(entries, firstProj - 1) + pos(entries, firstProj)) / 2 : 1;
  const tc = om.tabColor(TABS.find((t) => (t.groups || []).some((g) => g.layers.includes(layer))) ?? TABS[1]);
  return (
    <div className="om-dock" ref={root}>
      <button className={`tl-play ${playing ? "on" : ""}`} aria-label={playing ? "Pause" : "Play through the years"} onClick={om.play}>
        <Svg fill="currentColor" stroke="none" paths={playing ? '<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/>' : '<path d="M8 5.5v13l11-6.5Z"/>'} />
      </button>
      <div className="om-year">{e.kind === "drv" ? <><span className="drv" style={{ color: tc }}>{e.label}</span><small>{e.step}</small></> : e.year ? <>{e.year}{e.kind === "proj" ? <small>projection</small> : null}</> : null}</div>
      <div className={`om-slider ${e.kind === "proj" ? "proj" : ""}`} ref={slider}>
        <div className="track">
          <div className="track-obs" style={{ width: `${cut * 100}%` }} />
          {firstProj >= 0 ? <div className="track-proj" style={{ left: `${cut * 100}%` }} /> : null}
          <div className="track-fill" style={{ width: `${pos(entries, idx) * 100}%` }} />
        </div>
        <input type="range" min="0" max="1000" step="1" aria-label="Year" value={Math.round(pos(entries, idx) * 1000)}
          onChange={(ev) => { om.stop(); om.setIdx(nearest(entries, ev.target.value / 1000)); }} />
        <div className="ticks">
          {tickList(entries, W).map((i) => {
            const x = entries[i], n = entries.length;
            return (
              <Fragment key={i}>
                <i style={{ left: `${pos(entries, i) * 100}%` }} />
                <span className={x.kind === "proj" ? "pj" : x.kind === "drv" ? "dv" : ""} style={{ left: `${pos(entries, i) * 100}%`, ...(x.kind === "drv" && i === 0 ? { transform: "none" } : x.kind === "drv" && i === n - 1 ? { transform: "translateX(-100%)" } : {}), ...(x.kind === "drv" ? { color: tc } : {}) }}>{x.label || x.year}</span>
              </Fragment>
            );
          })}
        </div>
      </div>
      {firstProj >= 0 ? (
        <div className="scen" role="group" aria-label="Emission scenario">
          {Object.entries(SCEN).map(([k, v]) => <button key={k} title={v.code} data-ssp={k} className={k === scenario ? "on" : ""} style={k === scenario ? { background: v.color } : undefined} onClick={() => om.pickScenario(k)}>{v.label}</button>)}
        </div>
      ) : null}
    </div>
  );
}

/* ---------------- the free map area: national cards and the compare map */
function CatchCard() {
  const card = useOm((s) => s.card), idx = useOm((s) => s.idx);
  const canvas = useRef(null), chart = useRef(null);
  const { D, rows } = card, r = rows[idx];
  useEffect(() => {
    const { Chart } = om.pkg;
    chart.current = new Chart(canvas.current, { type: "line",
      data: { datasets: [{ label: "Total catch", data: rows.map((x) => ({ x: x.year, y: x.total / 1000 })), borderColor: "#5aa9dc", borderWidth: 2, backgroundColor: "rgba(43,128,180,.22)", fill: "start", pointRadius: 0, tension: 0.15 },
        { label: "Shell-building molluscs", data: rows.map((x) => ({ x: x.year, y: x.molluscs / 1000 })), borderColor: "#a48be0", borderWidth: 2, backgroundColor: "rgba(99,66,179,.35)", fill: "start", pointRadius: 0, tension: 0.15 }] },
      options: { responsive: true, maintainAspectRatio: false, animation: false, parsing: false, interaction: { mode: "x", intersect: false },
        scales: { x: { type: "linear", min: rows[0].year, max: rows[rows.length - 1].year, ticks: { stepSize: 20, callback: (v) => v, font: { size: 10 } }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { maxTicksLimit: 4, font: { size: 10 } }, grid: { color: "rgba(148,163,184,.18)" } } },
        plugins: { legend: { display: true, position: "bottom", labels: { font: { size: 10.5 }, boxHeight: 3 } }, yearLine: { year: null },
          tooltip: { callbacks: { title: (items) => (items.length ? String(Math.round(items[0].parsed.x)) : ""), label: (i) => `${i.dataset.label}: ${i.parsed.y.toFixed(1)}k t` } } } } });
    return () => chart.current?.destroy();
  }, [rows]);
  useEffect(() => { if (chart.current && r) { chart.current.options.plugins.yearLine.year = r.year; chart.current.update("none"); } }, [r]);
  if (!r) return null;
  const tot = r.total, k = (v) => `${(v / 1000).toFixed(1)}k t`, val = (row, key) => (typeof key === "function" ? key(row) : row[key]) || 0;
  return (
    <div className="om-card catch-card">
      <div className="cc-k">Pakistan's sea catch · <span>{r.year}</span></div>
      <div className="cc-hero">
        <div><b>{Math.round(tot).toLocaleString()}</b><span>tonnes caught (FAO, all of Pakistan)</span></div>
        <div className="cc-shell"><b>{`${Math.round(r.molluscs).toLocaleString()} t · ${((100 * r.molluscs) / tot).toFixed(1)} %`}</b><span>shell-building molluscs</span></div>
      </div>
      <div className="cc-bar" role="img" aria-label={D.parts.map((p) => `${p[1]} ${((100 * val(r, p[0])) / tot).toFixed(1)} %`).join(", ")}>
        {D.parts.map((p) => { const v = val(r, p[0]), pc = (100 * v) / tot; return pc > 0 ? <i key={p[1]} style={{ flex: `${pc} 0 0`, background: p[2] }} title={`${p[1]}: ${k(v)} (${pc.toFixed(1)} %)`} /> : null; })}
      </div>
      <div className="cc-rows">
        {D.parts.map((p) => { const v = val(r, p[0]); return <div key={p[1]} className={`cc-row ${/Molluscs/.test(p[1]) ? "sh" : ""}`}><i style={{ background: p[2] }} /><span>{p[1]}</span><b>{k(v)}</b><em>{((100 * v) / tot).toFixed(1)} %</em></div>; })}
      </div>
      <div className="cc-spark"><div className="cc-st">Total catch 1950-2023 <span>thousand tonnes · line = year on the slider</span></div><div className="cc-canvas"><canvas ref={canvas} /></div></div>
      <div className="cc-tag">Pakistan total · not location-specific</div>
    </div>
  );
}

function IndexCard() {
  const [html, setHtml] = useState("");
  useEffect(() => { om.indexCardHtml().then(setHtml).catch((e) => setHtml(`<p class="note-sm">Could not read the national index: ${e.message}</p>`)); }, []);
  return <Html className="om-card index-card" html={html} />;
}

/** The second map of Compare, over the right half of the free map area, with the same basemap as the main map. */
function Map2() {
  const host = useRef(null), area = useRef(null);
  const splitL = useOm((s) => s.splitL), splitR = useOm((s) => s.splitR);
  useLayoutEffect(() => {
    const bm = BASEMAPS.find((b) => b.id === getState().basemap);
    const style = bm?.type === "raster"
      ? { version: 8, sources: { bm: { type: "raster", tiles: bm.tiles, tileSize: bm.tileSize ?? 256, maxzoom: bm.maxzoom } }, layers: [{ id: "bg", type: "background", paint: { "background-color": "#0a1d2a" } }, { id: "bm", type: "raster", source: "bm", paint: bm.paint ?? {} }] }
      : "https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json";
    const done = om.initMap2(host.current, style);
    const place = () => { // the main map keeps its EEZ in the left half: tell om.js where the halves meet
      const a = area.current?.getBoundingClientRect(), m = host.current?.closest(".map-area")?.getBoundingClientRect();
      if (a && m) om.setHalf({ left: a.left - m.left, mid: a.left - m.left + a.width / 2 });
    };
    place();
    const ro = new ResizeObserver(place); ro.observe(area.current);
    return () => { ro.disconnect(); om.setHalf(null); done(); };
  }, []);
  return (
    <div className="om-split" ref={area}>
      <div className="om-map2" ref={host} />
      <div className="split-line" />
      <div className="split-lab l">{splitL}</div>
      <div className="split-lab r">{splitR}</div>
    </div>
  );
}

export function OmFree() {
  const card = useOm((s) => s.card?.id), compare = useOm((s) => s.compare);
  return (
    <>
      {compare ? <Map2 /> : null}
      {card ? <div className="om-free">{card === "catch" ? <CatchCard /> : card === "nindex" ? <IndexCard /> : null}</div> : null}
    </>
  );
}

/* ---------------- right: the package's panel, drawn by om.js into this element */
export function OmPanelBody() {
  const el = useRef(null), error = useOm((s) => s.error);
  useEffect(() => { om.setPanelRoot(el.current); return () => om.setPanelRoot(null); }, []);
  return <>{error ? <p className="note-sm">{error}</p> : null}<div className="om-panel" ref={el} /></>;
}

/** The package's floating chart windows (a click on a chart card) open here. */
export const OmFloats = () => <div id="floats" className="om-floats" />;
