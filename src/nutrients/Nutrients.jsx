/**
 * The Nutrients & Plankton screens (see np.js for what they show and why). While the layer is open the shell is in
 * the same mode as for Ocean and Fisheries (.om-mode, src/App.jsx), so everything sits where the ocean package's parts do
 * and wears their styles (src/oceanMonitoring/om.css):
 *   - left: the layer list and legend (NpLeft);
 *   - top: the layer's title card and its opacity (NpTop);
 *   - bottom: the month slider (NpDock, in place of the portal timeline), with the portal's layer dock lying above it;
 *   - right: the analysis panel's body is NpPanelBody: findings for the chosen place and month, plain-words key points,
 *     charts that follow the slider (a click on a monthly chart moves it), and how the data was made.
 * The data has no emissions scenarios, so the slider has no scenario buttons.
 */
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Chart, registerables } from "chart.js";
import * as np from "./np.js";
import "./np.css";

Chart.register(...registerables);
const { useNp } = np;
export const isNpLayer = (layer) => layer?.mapLayer?.type === "nutrients";
/** Loads the data when the portal layer becomes the open one. */
export function useNpStart(layer) {
  useEffect(() => { if (isNpLayer(layer)) np.start(); }, [layer?.id]);
}

const ICONS = {
  leaf: '<path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14Z"/><path d="M5 19 13 11"/>',
  pulse: '<path d="M3 12h4l2-6 4 12 2-6h6"/>',
  dots: '<circle cx="7" cy="8" r="2"/><circle cx="16" cy="6" r="2"/><circle cx="12" cy="14" r="2"/><circle cx="18" cy="17" r="2"/><circle cx="6" cy="18" r="2"/>',
  wave: '<path d="M3 9c3-3 6 3 9 0s6-3 9 0"/><path d="M3 15c3-3 6 3 9 0s6-3 9 0"/>',
  flask: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3"/><path d="M7.5 15h9"/>',
};
const Svg = ({ paths, size = 16, stroke = "currentColor", width = 2, fill = "none" }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill={fill} stroke={stroke} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: paths }} />
);
const Chev = () => <Svg paths='<path d="m9 6 6 6-6 6"/>' size={15} />;
const isChange = (l) => l.kind === "season" || l.kind === "year";
const stopsOf = (l) => (l.kind === "woa" ? np.NUTRIENT_STOPS[l.key] : isChange(l) ? np.CHANGE_STOPS : np.CHL_STOPS);
/** The month a layer shows: the slider's, or the map's own (April 2026). */
const monthOf = (l, idx) => (l.kind === "grid" ? np.data().months.indexOf(np.data().chlorophyll.date) : idx);

/* ---------------- left: layer list and legend */
function LayerButton({ id, tc }) {
  const l = np.LAYERS[id], on = useNp((s) => s.layer === id);
  return (
    <button className={`lyr ${on ? "on" : ""}`} style={{ "--tc": tc }} onClick={() => np.selectLayer(id)} aria-pressed={on}>
      <div className="t"><span className="radio" /><span>{l.title}</span></div>
      <div className="sub">{l.sub}</div>
      <div className="badges">{l.badges.map((b) => <span key={b} className={`b ${/^not |context only/.test(b) ? "warn" : ""}`}>{b}</span>)}</div>
    </button>
  );
}

function Tab({ t }) {
  const open = useNp((s) => s.open.includes(t.id)), groupsOpen = useNp((s) => s.groupsOpen), layer = useNp((s) => s.layer);
  return (
    <div className={`tabg ${open ? "open" : ""}`} style={{ "--tc": t.tc }}>
      <button className="tabh" aria-expanded={open} onClick={() => np.toggleTab(t.id)}>
        <span className="ic" style={{ background: t.color }}><Svg paths={ICONS[t.icon]} stroke="#fff" width={1.8} /></span>
        <span>{t.title}<span className="st">{t.steps}</span></span>
        <Chev />
      </button>
      {open ? (
        <div className="tabb">
          {t.groups.map((g) => {
            const key = `${t.id}:${g.title}`, gOpen = groupsOpen.includes(key);
            return (
              <div className={`grp ${gOpen ? "open" : ""} ${g.layers.includes(layer) ? "has-on" : ""}`} key={key}>
                <button className="grph" aria-expanded={gOpen} onClick={() => np.toggleGroup(key)}><i className="dot" />{g.title}<span className="cnt">{g.layers.length}</span><Chev /></button>
                {gOpen ? <div className="grpb">{g.layers.map((id) => <LayerButton key={id} id={id} tc={t.tc} />)}</div> : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function Legend() {
  const layer = useNp((s) => s.layer), insVar = useNp((s) => s.insVar);
  if (!layer) return null;
  if (np.isInsitu(layer)) {
    const l = np.LAYERS[layer], plankton = l.mode === "plankton", key = insVar ?? np.insVars()[0]?.key, stops = plankton ? np.INS_STOPS : key ? np.measuredStops(key) : np.INS_STOPS;
    return (
      <div className="om-legend legend-om">
        <span className="card-kicker">Legend</span>
        <div className="t"><b>{plankton ? "Records per 25 km square" : `${(key ?? "").replace(/_/g, " ")}`}</b><span>{plankton ? "log scale" : key ? np.domUnit(key) : ""}</span></div>
        <div className="ramp" style={{ background: np.gradient(stops) }} />
        <div className="r">{stops.map(([v], k) => <span key={k} style={{ left: `${(100 * k) / (stops.length - 1)}%` }}>{plankton ? v : +v.toPrecision(3)}</span>)}</div>
        <div className="d">{plankton ? "Presence only: a record says a species was seen, not how much" : "One dot per sample, in the source's own unit; colours span the 5th to 95th percentile"}</div>
        <div className="d">Blank = no record, not "none there"</div>
      </div>
    );
  }
  const l = np.LAYERS[layer], hist = l.kind === "hmap", ramp = hist ? np.data().hist.ramps[l.ramp] : null, stops = hist ? ramp.stops : stopsOf(l), change = isChange(l);
  const label = hist ? l.short : l.kind === "woa" ? `Surface ${l.short.toLowerCase()}` : l.kind === "season" ? "Against the usual for the month" : l.kind === "year" ? "Against the same month a year before" : "Chlorophyll-a";
  return (
    <div className="om-legend legend-om">
      <span className="card-kicker">Legend</span>
      <div className="t"><b>{label}</b><span>{change ? "%" : l.unit}</span></div>
      <div className="ramp" style={{ background: np.gradient(stops) }} />
      <div className="r">{stops.map(([v], k) => <span key={k} style={{ left: `${(100 * k) / (stops.length - 1)}%` }}>{change && v > 0 ? `+${v}` : v}</span>)}</div>
      {hist && ramp.log ? <div className="d">Log scale: each step is about three times more algae</div> : null}
      {l.ramp === "concern" ? <div className="d">1 very low, 2 low, 3 moderate, 4 high, 5 very high relative concern</div> : null}
      {hist && (!l.still || l.note === "trend") ? <div className="d">Blank water: {l.note === "trend" ? "too few complete seasons for a trend" : "no valid reading (cloud, haze or sediment)"}, never zero</div> : null}
      {hist && l.still && l.note !== "trend" ? <div className="d">Blank: {l.note === "concern" ? "not scored (outside the coastal band or too little data)" : "no model value there"}</div> : null}
      {hist ? <div className="d">{l.note === "scenario" || l.note === "change" ? "Model-derived (three climate models), not a forecast" : l.note === "concern" ? "Screening index, not a safety rating" : "Satellite-derived, not field-calibrated"}</div> : null}
      {l.kind === "points" || l.kind === "grid" ? <div className="d">Log scale: each step is about three times more algae</div> : null}
      {change ? <div className="d">Above or below the usual describes the record, not a safety limit</div> : null}
      {l.kind !== "woa" && l.kind !== "grid" && !hist ? <div className="d"><i className="hollow" />No valid satellite reading that month</div> : null}
      {l.kind === "grid" ? <div className="d">Blank water: no valid reading (cloud, haze or sediment)</div> : null}
      {l.kind === "woa" ? <div className="d">White dots: the five monitoring points, for reference</div> : null}
      {hist ? null : <div className="d"><i className="dash" />Nearby water pixel used where the creek itself had no readings</div>}
    </div>
  );
}

export function NpLeft() {
  const ready = useNp((s) => s.ready), error = useNp((s) => s.error);
  useEffect(() => { np.start(); }, []);
  return (
    <div className="om-left">
      <section className="om-side" aria-label="Nutrients and plankton layers">
        <div className="side-h"><span className="card-kicker">Nutrients &amp; plankton layers</span></div>
        <div className="side-body">
          {error ? <p className="note-sm">{error}</p> : !ready ? <p className="note-sm">Loading the nutrients and plankton data…</p> : np.tabs().map((t) => <Tab key={t.id} t={t} />)}
        </div>
      </section>
      {ready ? <Legend /> : null}
    </div>
  );
}

/* ---------------- top: title card and opacity */
export function NpTop() {
  const ready = useNp((s) => s.ready), layer = useNp((s) => s.layer), idx = useNp((s) => s.idx), hi = useNp((s) => s.hi), opacity = useNp((s) => s.opacity);
  const box = useRef(null), tools = useRef(null);
  useLayoutEffect(() => { // to the right of the portal's title plate, up to the tools (as the ocean package's title card)
    const place = () => {
      const brand = document.querySelector(".brand-float"), area = box.current?.closest(".map-area");
      if (!brand || !area || !box.current || !tools.current) return;
      const a = area.getBoundingClientRect(), left = brand.getBoundingClientRect().right - a.left + 14;
      const right = (tools.current.offsetWidth ? tools.current.getBoundingClientRect().left : a.right) - a.left - 14;
      box.current.style.left = `${left}px`;
      box.current.style.maxWidth = `${Math.max(220, Math.min(460, right - left))}px`;
    };
    place();
    window.addEventListener("resize", place); window.addEventListener("panelschange", place);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("panelschange", place); };
  });
  const l = ready && layer ? np.LAYERS[layer] : null, t = l && np.tabOf(layer);
  const hk = l?.kind === "hmap" ? np.histFrames(layer)[hi].key : null;
  const when = !l ? "" : l.kind === "insitu" ? "all years" : l.still ? l.label(hk) : hk ? (hk.length === 4 ? `${hk} (yearly average)` : np.monthLabel(hk)) : l.kind === "woa" ? `${np.data()[l.key].period} average` : np.monthLabel(monthOf(l, idx));
  return (
    <>
      <div className="om-title" ref={box} hidden={!l}>
        {l ? <>
          <div className="k" style={{ color: t.tc }}>{t.title} · {t.steps}</div>
          <div className="v">{l.title}</div>
          <div className="s"><b>{when}</b> · {l.shows}</div>
        </> : null}
      </div>
      <div className="om-tools" ref={tools}>
        {l && (l.kind === "grid" || l.kind === "woa" || l.kind === "hmap") ? <label className="om-pill om-opacity"><span>Opacity</span><input type="range" min="0" max="100" value={Math.round(opacity * 100)} onChange={(e) => np.setOpacity(e.target.value / 100)} /></label> : null}
      </div>
    </>
  );
}

/* ---------------- bottom: the month slider, January 2020 to April 2026 */
export function NpDock() {
  const ready = useNp((s) => s.ready), layer = useNp((s) => s.layer), hi = useNp((s) => s.hi), playing = useNp((s) => s.playing);
  return ready && np.isStill(layer) ? <StillDock key={layer} layer={layer} hi={hi} /> : ready && np.isHist(layer) ? <HistDock key={layer} layer={layer} hi={hi} playing={playing} /> : <PlaceDock />;
}
function PlaceDock() {
  const ready = useNp((s) => s.ready), layer = useNp((s) => s.layer), idx = useNp((s) => s.idx), playing = useNp((s) => s.playing), point = useNp((s) => s.point);
  const root = useRef(null), slider = useRef(null);
  const [W, setW] = useState(300);
  const show = ready && np.hasMonths(layer);
  useLayoutEffect(() => { // the layer dock lies on top of the slider: tell it how tall the slider is
    const shell = root.current?.closest(".shell"), el = root.current;
    if (!el || !shell) return undefined;
    const ro = new ResizeObserver(() => { shell.style.setProperty("--om-dock-h", `${el.offsetHeight}px`); if (slider.current) setW(slider.current.getBoundingClientRect().width || 300); });
    ro.observe(el);
    return () => { ro.disconnect(); shell.style.setProperty("--om-dock-h", "0px"); };
  }, [show]);
  if (!show) return null;
  const D = np.data(), n = D.months.length, at = (i) => `${(100 * i) / (n - 1)}%`;
  const gap = 34 * (parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--fs")) || 1); // a year label's width
  const ticks = D.months.flatMap((m, i) => (m.endsWith("-01") ? [i] : [])).filter((i, k, all) => k === 0 || ((i - all[k - 1]) / (n - 1)) * W >= gap);
  const p = np.placeOf(point), missing = D.months.flatMap((m, i) => (p.values[i] == null ? [i] : []));
  return (
    <div className="om-dock np-dock" ref={root}>
      <button className={`tl-play ${playing ? "on" : ""}`} aria-label={playing ? "Pause" : "Play through the months"} onClick={np.play}>
        <Svg fill="currentColor" stroke="none" paths={playing ? '<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/>' : '<path d="M8 5.5v13l11-6.5Z"/>'} />
      </button>
      <div className="om-year">{D.months[idx].slice(0, 4)}<small className="np-month">{np.monthName(idx)}</small></div>
      <div className="om-slider" ref={slider}>
        <div className="track"><div className="track-obs" style={{ width: "100%" }} /><div className="track-fill" style={{ width: at(idx) }} /></div>
        <div className="np-gaps" aria-hidden="true">{missing.map((i) => <i key={i} style={{ left: at(i) }} />)}</div>
        <input type="range" min="0" max={n - 1} step="1" aria-label="Month" value={idx} onChange={(e) => { np.stop(); np.setIdx(+e.target.value); }} />
        <div className="ticks">
          {ticks.map((i) => <Fragment key={i}><i style={{ left: at(i) }} /><span style={{ left: at(i) }}>{D.months[i].slice(0, 4)}</span></Fragment>)}
        </div>
      </div>
      <div className="np-dock-note"><b>Monthly satellite record</b><span>No emission scenarios · marks: no reading at {p.name}</span></div>
    </div>
  );
}

/* ---------------- NDMA history (1998-2025): the slider */
/** The slider for the NDMA pictures: a month for the monthly layers, a year for the yearly ones. */
function HistDock({ layer, hi, playing }) {
  const root = useRef(null), slider = useRef(null);
  const [W, setW] = useState(300);
  useLayoutEffect(() => {
    const shell = root.current?.closest(".shell"), el = root.current;
    if (!el || !shell) return undefined;
    const ro = new ResizeObserver(() => { shell.style.setProperty("--om-dock-h", `${el.offsetHeight}px`); if (slider.current) setW(slider.current.getBoundingClientRect().width || 300); });
    ro.observe(el);
    return () => { ro.disconnect(); shell.style.setProperty("--om-dock-h", "0px"); };
  }, []);
  const l = np.LAYERS[layer], frames = np.histFrames(layer), n = frames.length, at = (i) => `${(100 * i) / (n - 1)}%`;
  const gap = 34 * (parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--fs")) || 1);
  const ticks = frames.flatMap((f, i) => (+f.key.slice(0, 4) % 5 === 0 && (l.annual || f.key.endsWith("-01")) ? [i] : [])).filter((i, k, all) => k === 0 || ((i - all[k - 1]) / (n - 1)) * W >= gap);
  const water = np.data().hist.sets.sst.frames[0].valid;
  const sparse = l.set.startsWith("chl") ? frames.flatMap((f, i) => (f.valid < 0.1 * water ? [i] : [])) : []; // pictures with almost no reading
  const key = frames[hi].key;
  return (
    <div className="om-dock np-dock" ref={root}>
      <button className={`tl-play ${playing ? "on" : ""}`} aria-label={playing ? "Pause" : "Play through the pictures"} onClick={np.play}>
        <Svg fill="currentColor" stroke="none" paths={playing ? '<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/>' : '<path d="M8 5.5v13l11-6.5Z"/>'} />
      </button>
      <div className="om-year">{key.slice(0, 4)}{l.annual ? null : <small className="np-month">{np.monthLabel(key).split(" ")[0]}</small>}</div>
      <div className="om-slider" ref={slider}>
        <div className="track"><div className="track-obs" style={{ width: "100%" }} /><div className="track-fill" style={{ width: at(hi) }} /></div>
        <div className="np-gaps" aria-hidden="true">{sparse.map((i) => <i key={i} style={{ left: at(i) }} />)}</div>
        <input type="range" min="0" max={n - 1} step="1" aria-label={l.annual ? "Year" : "Month"} value={hi} onChange={(e) => { np.stop(); np.setHi(+e.target.value); }} />
        <div className="ticks">
          {ticks.map((i) => <Fragment key={i}><i style={{ left: at(i) }} /><span style={{ left: at(i) }}>{frames[i].key.slice(0, 4)}</span></Fragment>)}
        </div>
      </div>
      <div className="np-dock-note"><b>Satellite record, 1998-2025</b><span>Ends December 2025{sparse.length ? " · marks: almost no chlorophyll reading" : ""}</span></div>
    </div>
  );
}

/* ---------------- right: findings, key points and charts for the chosen place and month */
const AXIS = { ticks: { color: "#9db4b7", font: { size: 10 } }, grid: { color: "rgba(148,163,184,.14)" }, border: { color: "rgba(148,163,184,.3)" } };
const LOG_TICKS = [0.1, 0.3, 1, 3, 10, 30, 100];
const logAxis = (title) => ({ ...AXIS, type: "logarithmic", title: { display: !!title, text: title, color: "#9db4b7", font: { size: 10 } },
  afterBuildTicks: (ax) => { ax.ticks = LOG_TICKS.filter((v) => v >= ax.min && v <= ax.max).map((value) => ({ value })); }, ticks: { ...AXIS.ticks, callback: (v) => v } });
const monthAxis = () => ({ ...AXIS, ticks: { ...AXIS.ticks, autoSkip: false, maxRotation: 0, callback: (v) => (np.data().months[v].endsWith("-01") ? np.data().months[v].slice(0, 4) : null) } });
/** The slider's month as a dashed line across a monthly chart (chart.$line = index). */
const MONTH_LINE = { id: "npLine", afterDatasetsDraw(c) {
  if (c.$line == null) return;
  const a = c.chartArea, x = c.scales.x.getPixelForValue(c.$line);
  if (!(x >= a.left && x <= a.right)) return;
  const g = c.ctx; g.save(); g.strokeStyle = "rgba(230,238,240,.85)"; g.lineWidth = 1.5; g.setLineDash([4, 3]);
  g.beginPath(); g.moveTo(x, a.top); g.lineTo(x, a.bottom); g.stroke(); g.restore();
} };
const PLACE_COLORS = ["#e2582c", "#e6d43a", "#6fcf8f", "#6cc3df", "#a48be0"];
const toMonth = (e, _els, chart) => { const v = Math.round(chart.scales.x.getValueForPixel(e.x)); if (Number.isFinite(v)) { np.stop(); np.setIdx(v); } };
const options = (extra) => ({ responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: "index", intersect: false },
  plugins: { legend: { display: false }, tooltip: { backgroundColor: "#10232b", borderColor: "rgba(120,201,194,.4)", borderWidth: 1 } }, ...extra });

/** A chart card: the chart is made again when `deps` change; only the month line moves with the slider. */
function ChartCard({ title, sub, height = 210, make, deps, line = null }) {
  const canvas = useRef(null), chart = useRef(null);
  useEffect(() => { chart.current = new Chart(canvas.current, make()); chart.current.$line = line; chart.current.draw(); return () => chart.current?.destroy(); }, deps);
  useEffect(() => { if (chart.current) { chart.current.$line = line; chart.current.draw(); } }, [line]);
  return (
    <div className="ccard np-card">
      <div className="ccard-h"><div className="tt">{title}<span>{sub}</span></div></div>
      <div className="chart-wrap" style={{ height }}><canvas ref={canvas} /></div>
    </div>
  );
}

/** Points, change against the usual, change against a year before: everything follows the slider's month. */
function MonthBody({ l, p, i, tc }) {
  const D = np.data(), f = np.figures(p, i), M = np.monthLabel(i), mn = np.monthName(i);
  const big = l.kind === "points" ? f.v : l.kind === "season" ? f.vsUsual : f.vsYear;
  const shown = (x) => { const v = np.shownValue(l.id, x, i); return v == null ? "no reading" : isChange(l) ? np.pct(v) : np.fmt(v); };
  const valid = D.places.filter((x) => x.values[i] != null).sort((a, b) => b.values[i] - a.values[i]);
  const offshore = np.placeOf("offshore"), med = (x) => { const v = x.values.filter((q) => q != null).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
  const usualText = f.u ? `${mn} usually holds ${np.fmt(f.u.median)} mg/m³ here (2020-2024 median of ${f.u.n} readings, range ${np.fmt(f.u.min)}-${np.fmt(f.u.max)})` : `Fewer than three ${mn} readings in 2020-2024, so there is no usual to compare with`;
  const pos = { above: `more than in any ${mn} of 2020-2024`, below: `less than in any ${mn} of 2020-2024`, within: `inside the range of the ${mn}s of 2020-2024` }[f.pos];
  const ahead = l.kind === "season" ? valid.filter((x) => (np.figures(x, i).vsUsual ?? 0) > 0).length : valid.filter((x) => (np.figures(x, i).vsYear ?? 0) > 0).length;
  const counted = valid.filter((x) => (l.kind === "season" ? np.figures(x, i).vsUsual : np.figures(x, i).vsYear) != null).length;
  const points = [
    f.v == null ? `There is no valid satellite reading at ${p.name} for ${M}: clouds, haze or muddy water hid the surface, and the month is left empty.`
      : l.kind === "points" ? `In ${M} the surface water at ${p.name} held ${np.fmt(f.v)} mg/m³ of chlorophyll-a${pos ? `, ${pos}` : ""}.`
        : l.kind === "season" ? (f.u ? `${p.name} in ${M}: ${np.pct(f.vsUsual)} against the usual ${mn} (${np.fmt(f.u.median)} mg/m³), ${pos}.` : `${p.name} has fewer than three ${mn} readings in 2020-2024, so ${M} cannot be set against a usual.`)
          : (f.yr != null ? `${p.name} in ${M}: ${np.fmt(f.v)} mg/m³, ${np.pct(f.vsYear)} against ${np.monthLabel(i - 12)} (${np.fmt(f.yr)}).` : `${p.name} has no reading for ${i >= 12 ? np.monthLabel(i - 12) : "a year before"}, so ${M} cannot be set against it.`),
    l.kind === "points" && valid.length > 1 ? `Highest this month: ${valid[0].name} (${np.fmt(valid[0].values[i])}); lowest: ${valid.at(-1).name} (${np.fmt(valid.at(-1).values[i])}).` : null,
    isChange(l) && counted ? `${ahead} of the ${counted} places that can be compared are ${l.kind === "season" ? "above their usual" : "higher than a year before"} this month.` : null,
    p.id !== "offshore" && med(offshore) ? `Over all months ${p.name} carries about ${(med(p) / med(offshore)).toFixed(1)} times the chlorophyll of the offshore comparison pixel (medians ${np.fmt(med(p))} and ${np.fmt(med(offshore))} mg/m³).` : null,
    "Chlorophyll-a measures how much algae (phytoplankton) is in the water, not which species or whether it is toxic: a high value alone is not a harmful bloom.",
  ].filter(Boolean);
  const series = (x) => x.values.map((v) => v ?? null);
  const usualLine = (k) => D.months.map((_, j) => np.usual(p, j)?.[k] ?? null);
  return (
    <>
      <div className="facts">
        <div className="ft">Key findings: {p.name}<span>{M}</span></div>
        <div className="big" style={{ color: tc }}>{big == null ? "No reading" : l.kind === "points" ? np.fmt(big) : np.pct(big)}<small>{l.kind === "points" ? "mg/m³ chlorophyll-a" : l.kind === "season" ? `against the usual ${mn}` : "against a year before"}</small></div>
        <div className="grid">{D.places.map((x) => <div className={`cell ${x.id === p.id ? "np-on" : ""}`} key={x.id}><div className="r">{x.name}</div><div className="v">{shown(x)}</div></div>)}</div>
        <ul>
          <li>{usualText}</li>
          {f.u && f.v != null ? <li>Against the usual: {np.pct(f.vsUsual)}, {pos}</li> : null}
          <li>{f.prev != null && f.v != null ? `Against ${np.monthLabel(i - 1)}: ${np.pct(f.vsPrev)} (${np.fmt(f.prev)} mg/m³)` : i > 0 ? `No comparison with ${np.monthLabel(i - 1)}: a reading is missing` : "First month of the record"}</li>
          <li>{f.yr != null && f.v != null ? `Against ${np.monthLabel(i - 12)}: ${np.pct(f.vsYear)} (${np.fmt(f.yr)} mg/m³)` : i >= 12 ? `No comparison with ${np.monthLabel(i - 12)}: a reading is missing` : "No year before in the record (it starts in January 2020)"}</li>
          <li>{f.valid} of {D.months.length} months have a valid reading at this pixel</li>
          {p.nearby ? <li>Nearby water pixel, {p.offset_km} km from the place asked for, which had no valid readings; the same pixel is used every month</li> : null}
        </ul>
      </div>
      <div className="kpts"><div className="ft">Key points<span>in simple words</span></div><ul>{points.map((x) => <li key={x}>{x}</li>)}</ul></div>
      {isChange(l) ? (
        <ChartCard title={`${p.name}: ${l.kind === "season" ? "against the usual, month by month" : "against a year before, month by month"}`} sub="% · bars coloured as on the map · dashed line = the slider's month · click to move it"
          deps={[l.id, p.id]} line={i} make={() => {
            const v = D.months.map((_, j) => (l.kind === "season" ? np.figures(p, j).vsUsual : np.figures(p, j).vsYear));
            return { type: "bar", data: { labels: D.months, datasets: [{ label: "%", data: v, backgroundColor: v.map((x) => (x == null ? "transparent" : np.changeColor(x))), borderWidth: 0, barPercentage: 1, categoryPercentage: 0.9 }] },
              options: options({ onClick: toMonth, scales: { x: monthAxis(), y: { ...AXIS, ticks: { ...AXIS.ticks, callback: (q) => `${q > 0 ? "+" : ""}${q} %` } } },
                plugins: { legend: { display: false }, tooltip: { callbacks: { title: (it) => np.monthLabel(it[0].dataIndex), label: (it) => np.pct(it.parsed.y) } } } }), plugins: [MONTH_LINE] };
          }} />
      ) : null}
      <ChartCard title={`${p.name}: every month, 2020-2026`} sub="mg/m³ · log scale · dashed = usual for the month (2020-2024 median), band = its range · click to move the slider"
        deps={[p.id]} line={i} make={() => ({ type: "line",
          data: { labels: D.months, datasets: [
            { label: "Highest usual", data: usualLine("max"), borderWidth: 0, pointRadius: 0, backgroundColor: "rgba(120,201,194,.16)", fill: "+1" },
            { label: "Lowest usual", data: usualLine("min"), borderWidth: 0, pointRadius: 0, fill: false },
            { label: "Usual", data: usualLine("median"), borderColor: "rgba(230,238,240,.6)", borderWidth: 1.2, borderDash: [4, 3], pointRadius: 0 },
            { label: p.name, data: series(p), borderColor: tc, backgroundColor: tc, borderWidth: 2, pointRadius: 2, spanGaps: false },
          ] },
          options: options({ onClick: toMonth, scales: { x: monthAxis(), y: logAxis() },
            plugins: { legend: { display: false }, tooltip: { filter: (it) => it.datasetIndex >= 2, callbacks: { title: (it) => np.monthLabel(it[0].dataIndex), label: (it) => `${it.dataset.label}: ${np.fmt(it.parsed.y)} mg/m³` } } } }),
          plugins: [MONTH_LINE] })} />
      <ChartCard title="All five places" sub="mg/m³ · log scale · the chosen place drawn thicker · click to move the slider" height={230}
        deps={[p.id]} line={i} make={() => ({ type: "line",
          data: { labels: D.months, datasets: D.places.map((x, k) => ({ label: x.name, data: series(x), borderColor: PLACE_COLORS[k], backgroundColor: PLACE_COLORS[k], borderWidth: x.id === p.id ? 2.6 : 1.1, pointRadius: x.id === p.id ? 1.8 : 0, spanGaps: false, order: x.id === p.id ? 0 : 1 })) },
          options: options({ onClick: toMonth, scales: { x: monthAxis(), y: logAxis() },
            plugins: { legend: { display: true, position: "bottom", labels: { color: "#bccdce", font: { size: 10.5 }, boxWidth: 10, boxHeight: 3 } }, tooltip: { callbacks: { title: (it) => np.monthLabel(it[0].dataIndex), label: (it) => `${it.dataset.label}: ${np.fmt(it.parsed.y)}` } } } }),
          plugins: [MONTH_LINE] })} />
      <UsualYear p={p} i={i} tc={tc} />
    </>
  );
}

/** The usual year at a place (median and range of each calendar month, 2020-2024) with the slider's year on top. */
function UsualYear({ p, i, tc }) {
  const D = np.data(), year = D.months[i].slice(0, 4), cal = (k) => D.months.findIndex((m) => +m.slice(5) === k + 1); // any index of that calendar month
  const u = Array.from({ length: 12 }, (_, k) => np.usual(p, cal(k)));
  const thisYear = Array.from({ length: 12 }, (_, k) => { const j = D.months.indexOf(`${year}-${String(k + 1).padStart(2, "0")}`); return j < 0 ? null : p.values[j]; });
  return (
    <ChartCard title={`The usual year at ${p.name}, and ${year}`} sub={`mg/m³ · log scale · line = 2020-2024 median of each month, band = its range · dots = ${year} · gaps: months with fewer than three readings`}
      deps={[p.id, year]} make={() => ({ type: "line",
        data: { labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], datasets: [
          { label: "Highest", data: u.map((x) => x?.max ?? null), borderWidth: 0, pointRadius: 0, backgroundColor: "rgba(120,201,194,.16)", fill: "+1" },
          { label: "Lowest", data: u.map((x) => x?.min ?? null), borderWidth: 0, pointRadius: 0, fill: false },
          { label: "Usual (median)", data: u.map((x) => x?.median ?? null), borderColor: "rgba(230,238,240,.75)", borderWidth: 1.6, pointRadius: 0, tension: 0.25 },
          { label: year, data: thisYear, borderColor: tc, backgroundColor: tc, showLine: false, pointRadius: 4 },
        ] },
        options: options({ scales: { x: AXIS, y: logAxis() }, plugins: { legend: { display: false }, tooltip: { filter: (it) => it.datasetIndex >= 2, callbacks: { label: (it) => `${it.dataset.label}: ${np.fmt(it.parsed.y)} mg/m³` } } } }) })} />
  );
}

/** The April 2026 map: how much of the water holds how much algae, and the five places in that month. */
function MapBody({ p, i, tc }) {
  const D = np.data(), g = D.chlorophyll, v = g.cells.map((c) => c[2]).sort((a, b) => a - b), q = (f) => v[Math.min(v.length - 1, Math.floor(f * v.length))];
  const bins = [[0, 0.3], [0.3, 1], [1, 3], [3, 10], [10, Infinity]].map(([a, b]) => ({ a, b, n: v.filter((x) => x >= a && x < b).length }));
  const f = np.figures(p, i), here = D.places.filter((x) => x.values[i] != null).map((x) => x.values[i]);
  const points = [
    `Half the water pixels hold less than ${np.fmt(q(0.5))} mg/m³ of chlorophyll-a; one in ten holds more than ${np.fmt(q(0.9))}.`,
    here.length ? `The monitoring points read ${np.fmt(Math.min(...here))} to ${np.fmt(Math.max(...here))} mg/m³ this month.` : null,
    "One month only: a single picture cannot show a trend. The monitoring points carry the months, from January 2020.",
  ].filter(Boolean);
  return (
    <>
      <div className="facts">
        <div className="ft">Key findings: this map<span>{np.monthLabel(g.date)}</span></div>
        <div className="big" style={{ color: tc }}>{f.v == null ? "No reading" : np.fmt(f.v)}<small>mg/m³ at {p.name}</small></div>
        <div className="grid">{D.places.map((x) => <div className={`cell ${x.id === p.id ? "np-on" : ""}`} key={x.id}><div className="r">{x.name}</div><div className="v">{x.values[i] == null ? "no reading" : np.fmt(x.values[i])}</div></div>)}</div>
        <ul>
          <li>{g.cells.length.toLocaleString("en")} of {g.cells_total.toLocaleString("en")} pixels in the frame have a value ({Math.round((100 * g.cells.length) / g.cells_total)} %); the rest is land or had no valid reading</li>
          <li>Median pixel {np.fmt(q(0.5))} mg/m³, highest {np.fmt(v.at(-1))} mg/m³</li>
        </ul>
      </div>
      <div className="kpts"><div className="ft">Key points<span>in simple words</span></div><ul>{points.map((x) => <li key={x}>{x}</li>)}</ul></div>
      <div className="ccard np-card">
        <div className="ccard-h"><div className="tt">How much of the water holds how much algae<span>share of the {g.cells.length.toLocaleString("en")} water pixels · {np.monthLabel(g.date)}</span></div></div>
        <div className="np-bins">{bins.map((b) => (
          <div className="np-bin" key={b.a}>
            <span>{b.b === Infinity ? `${b.a} and more` : `${b.a}-${b.b}`}</span>
            <div><i style={{ width: `${(100 * b.n) / v.length}%`, background: np.chlColor(b.b === Infinity ? 15 : Math.sqrt(Math.max(b.a, 0.1) * b.b)) }} /></div>
            <b>{Math.round((100 * b.n) / v.length)} %</b>
          </div>
        ))}</div>
      </div>
    </>
  );
}

/* ---------------- NDMA trends, scenarios and the concern snapshot: one picture per choice, never animated */
function StillDock({ layer, hi }) {
  const root = useRef(null);
  useLayoutEffect(() => {
    const shell = root.current?.closest(".shell"), el = root.current;
    if (!el || !shell) return undefined;
    const ro = new ResizeObserver(() => shell.style.setProperty("--om-dock-h", `${el.offsetHeight}px`));
    ro.observe(el);
    return () => { ro.disconnect(); shell.style.setProperty("--om-dock-h", "0px"); };
  }, []);
  const l = np.LAYERS[layer], frames = np.histFrames(layer);
  return (
    <div className="om-dock np-dock" ref={root}>
      <div className="regs" role="group" aria-label="Choice">{frames.map((f, i) => <button key={f.key} className={`rg ${i === hi ? "on" : ""}`} onClick={() => np.setHi(i)}>{l.label(f.key)}</button>)}</div>
      <div className="np-dock-note"><b>{l.title}</b><span>{l.note === "trend" ? "One summary of 1998-2025, not a year-by-year series" : l.note === "concern" ? "One month only: not today's conditions" : "Model projection, not a forecast"}</span></div>
    </div>
  );
}

/** Findings for a trend, scenario or concern map: what the whole map says, and the clicked pixel. */
function StillBody({ l, tc }) {
  const hi = useNp((s) => s.hi), pick = useNp((s) => s.pick), H = np.data().hist, frames = np.histFrames(l.id), fr = frames[hi], water = H.sets.sst.frames[0].valid;
  const pd = pick?.data?.[l.set], pv = pd?.values?.[hi] ?? null, f = (x) => (x == null ? "—" : Math.abs(x) >= 10 ? x.toFixed(0) : x.toFixed(l.unit === "mg/m³" ? 2 : Math.abs(x) < 1 ? 2 : 1));
  const pct = (a, b) => { const p = (100 * a) / (b || 1); return p > 0 && p < 1 ? "under 1 %" : `${Math.round(p)} %`; };
  const sign = (x) => (x > 0 ? `+${f(x)}` : f(x));
  const CLASS = ["", "very low", "low", "moderate", "high", "very high"];
  const points = [];
  if (l.note === "trend") {
    if (!fr.tested) points.push(`No significance test was possible for this season (${fr.valid.toLocaleString("en")} of ${water.toLocaleString("en")} water pixels have a trend at all): that means no inference, not "no change".`);
    else points.push(`${pct(fr.significant, fr.tested)} of the tested water has a significant trend (${fr.up.toLocaleString("en")} pixels up, ${fr.down.toLocaleString("en")} down); elsewhere the change is within year-to-year noise.`);
    points.push(l.set === "trend_chl" ? "Shown as % change per decade. A trend is a summary of 28 seasons, not a prediction, and says nothing about the cause." : "Shown in °C per decade. A trend is a summary of 28 seasons, not a prediction.");
  } else if (l.note === "concern") {
    const c = fr.classes ?? {}, tot = Object.values(c).reduce((a, x) => a + x, 0);
    points.push(`Of the ${tot.toLocaleString("en")} coastal water pixels scored: ${[1, 2, 3, 4, 5].filter((k) => c[k]).map((k) => `${pct(c[k], tot)} ${CLASS[k]}`).join(", ")} relative concern${!c[4] && !c[5] ? "; none high or very high" : ""}.`);
    points.push("It ranks places against each other for one month. It is not a safety rating and uses no measured nutrients or oxygen.");
  } else {
    points.push(l.note === "change" ? `Across the water the change ranges from ${sign(H.sets[l.set].min)} to ${sign(H.sets[l.set].max)} ${l.unit}.` : `Across the water, from ${f(H.sets[l.set].min)} to ${f(H.sets[l.set].max)} ${l.unit} over all scenarios and windows.`);
    points.push("The median of three climate models: a range of plausible futures, not a forecast. The windows overlap, so 2041-2060 is not a single year.");
  }
  return (
    <>
      <div className="facts">
        <div className="ft">Key findings: {l.short}<span>{l.label(fr.key)}</span></div>
        <div className="big" style={{ color: tc }}>{pick ? (pv == null ? "—" : l.note === "concern" ? CLASS[pv] : `${l.note === "trend" || l.note === "change" ? sign(pv) : f(pv)}`) : "Click"}<small>{pick ? (pv == null ? "no value at the clicked pixel" : l.note === "concern" ? "relative concern at the clicked pixel" : `${l.unit} at the clicked pixel`) : "the map to read a pixel"}</small></div>
        <ul>{points.map((x) => <li key={x}>{x}</li>)}</ul>
      </div>
    </>
  );
}

/** Findings, key points and charts for an NDMA history layer: the whole-coast mean for the slider's date, and the clicked pixel. */
function HistBody({ l, tc }) {
  const hi = useNp((s) => s.hi), pick = useNp((s) => s.pick), H = np.data().hist, frames = np.histFrames(l.id), key = frames[hi].key;
  const isChl = l.set.startsWith("chl"), v = isChl ? "chl" : "sst", reg = H.regional, water = H.sets.sst.frames[0].valid;
  const f = (x) => (isChl ? np.fmt(x) : x.toFixed(1)), unit = l.unit;
  const frame = frames[hi], cover = frame.valid / water;
  const monthly = !l.annual, mean = monthly ? reg[hi]?.[v]?.mean ?? null : null;
  const rows = reg.filter((x) => x[v]), ok = (x) => !isChl || x[v].valid >= 0.5 * water; // chlorophyll means from a small part of the water are not compared
  const sameMonth = monthly ? rows.filter((x) => x.month.slice(5) === key.slice(5) && ok(x)) : [];
  const avgSame = sameMonth.length ? sameMonth.reduce((a, x) => a + x[v].mean, 0) / sameMonth.length : null;
  const solid = rows.filter(ok), hiM = solid.length ? solid.reduce((a, x) => (x[v].mean > a[v].mean ? x : a)) : null, loM = solid.length ? solid.reduce((a, x) => (x[v].mean < a[v].mean ? x : a)) : null;
  const yr = key.slice(0, 4), yearMeans = rows.filter((x) => x.month.startsWith(yr) && ok(x));
  const pd = pick?.data[l.set], pv = pd ? pd.values[hi] : null, pValid = pd ? pd.values.filter((x) => x != null) : [];
  const pMed = pValid.length ? [...pValid].sort((a, b) => a - b)[Math.floor(pValid.length / 2)] : null;
  const low = isChl && cover < 0.2, when = monthly ? np.monthLabel(key) : key;
  const points = [
    monthly ? (mean == null ? `No regional mean for ${when}.` : `In ${when} the mean over the pixels that had a reading was ${f(mean)} ${unit}${isChl ? ` of chlorophyll-a, from ${Math.round(100 * cover)} % of the water` : ""}.`)
      : `The picture for ${key} is the average of the months with a reading, drawn only where at least nine months had one: ${Math.round(100 * cover)} % of the water.`,
    low ? "Clouds, haze or sediment hid most of the water this month (such months are all in June-August, mostly before 2016), so the mean describes only the few pixels that were seen. It is not the coast as a whole." : null,
    monthly && avgSame != null && mean != null && !low ? `Across the ${sameMonth.length} years that can be compared, the regional mean for ${np.monthLabel(key).split(" ")[0]} averages ${f(avgSame)} ${unit}; this one is ${mean > avgSame ? "above" : "below"} that.` : null,
    hiM && loM ? `Over 1998-2025 the ${isChl ? "highest" : "warmest"} monthly mean is ${f(hiM[v].mean)} ${unit} (${np.monthLabel(hiM.month)}) and the ${isChl ? "lowest" : "coolest"} ${f(loM[v].mean)} (${np.monthLabel(loM.month)})${isChl ? ", counting only months with a reading over at least half of the water" : ""}.` : null,
    isChl ? "Chlorophyll-a measures how much algae (phytoplankton) is in the surface water, not which species or whether it is toxic; a high value alone is not a harmful bloom." : "This is a blended temperature analysis at about 25 km; on its own it says nothing about oxygen, nutrients or plankton.",
    "Satellite-derived and not field-calibrated: no water sample has been used to check these values.",
  ].filter(Boolean);
  const labels = reg.map((x) => x.month);
  const xMonth = () => ({ ...AXIS, ticks: { ...AXIS.ticks, autoSkip: false, maxRotation: 0, callback: (i) => (labels[i]?.endsWith("-01") && (+labels[i].slice(0, 4) - 1998) % 4 === 0 ? labels[i].slice(0, 4) : null) } });
  const yAxis = () => (isChl ? logAxis() : { ...AXIS, ticks: { ...AXIS.ticks, callback: (q) => `${q} °C` } });
  const toFrame = (monthsChart) => (e, _els, chart) => { const q = Math.round(chart.scales.x.getValueForPixel(e.x)); if (Number.isFinite(q)) { np.stop(); np.setHi(l.annual && monthsChart ? Math.floor(q / 12) : q); } };
  const line = monthly ? hi : hi * 12 + 6;
  const regSeries = reg.map((x) => (x[v] && ok(x) ? x[v].mean : null)), allSeries = reg.map((x) => x[v]?.mean ?? null);
  return (
    <>
      <div className="facts">
        <div className="ft">Key findings: the whole coast<span>{when}</span></div>
        <div className="big" style={{ color: tc }}>{monthly ? (mean == null ? "No mean" : f(mean)) : `${Math.round(100 * cover)} %`}<small>{monthly ? `${unit} · mean over the pixels with a reading` : "of the water has a yearly value"}</small></div>
        <ul>
          <li>{frame.valid.toLocaleString("en")} of {water.toLocaleString("en")} water pixels have a value ({Math.round(100 * cover)} %); the rest had no valid reading and stay blank</li>
          {monthly && avgSame != null && mean != null ? <li>The same calendar month, 1998-2025: regional mean {f(avgSame)} {unit} on average ({sameMonth.length} comparable years)</li> : null}
          {!monthly && yearMeans.length ? <li>Monthly regional means in {yr}: {f(Math.min(...yearMeans.map((x) => x[v].mean)))} to {f(Math.max(...yearMeans.map((x) => x[v].mean)))} {unit} ({yearMeans.length} months counted)</li> : null}
          <li>{pick ? (pd ? `Clicked pixel (${pd.lat.toFixed(2)}° N, ${pd.lon.toFixed(2)}° E): ${pv == null ? "no reading for this date" : `${f(pv)} ${unit}`}${pMed != null ? ` · median over the record ${f(pMed)} ${unit}, ${pValid.length} of ${pd.values.length} ${l.annual ? "years" : "months"} with a reading` : ""}` : "Reading the clicked pixel…") : "Click the map to read a pixel's own record"}</li>
        </ul>
      </div>
      <div className="kpts"><div className="ft">Key points<span>in simple words</span></div><ul>{points.map((x) => <li key={x}>{x}</li>)}</ul></div>
      <ChartCard title="The whole coast, every month 1998-2025" sub={`${unit}${isChl ? " · log scale · faint line: months with a reading over under half of the water" : ""} · dashed line = the slider · click to move it`}
        deps={[l.id]} line={line} make={() => ({ type: "line",
          data: { labels, datasets: [
            ...(isChl ? [{ label: "Few pixels", data: allSeries, borderColor: "rgba(157,180,183,.35)", borderWidth: 1, pointRadius: 0, spanGaps: false }] : []),
            { label: "Regional mean", data: regSeries, borderColor: tc, backgroundColor: tc, borderWidth: 1.8, pointRadius: 0, spanGaps: false },
          ] },
          options: options({ onClick: toFrame(true), scales: { x: xMonth(), y: yAxis() },
            plugins: { legend: { display: false }, tooltip: { callbacks: { title: (it) => np.monthLabel(labels[it[0].dataIndex]), label: (it) => `${it.dataset.label}: ${f(it.parsed.y)} ${unit}` } } } }),
          plugins: [MONTH_LINE] })} />
      {isChl ? (
        <ChartCard title="How much of the water was seen" sub="% of the water pixels with a chlorophyll reading · lowest in some June-August months (cloud) · click to move the slider" height={150}
          deps={[l.id]} line={line} make={() => ({ type: "bar",
            data: { labels, datasets: [{ label: "%", data: reg.map((x) => Math.round((100 * x.chl.valid) / water)), backgroundColor: "rgba(120,201,194,.7)", borderWidth: 0, barPercentage: 1, categoryPercentage: 1 }] },
            options: options({ onClick: toFrame(true), scales: { x: xMonth(), y: { ...AXIS, min: 0, max: 100, ticks: { ...AXIS.ticks, callback: (q) => `${q} %` } } },
              plugins: { legend: { display: false }, tooltip: { callbacks: { title: (it) => np.monthLabel(labels[it[0].dataIndex]), label: (it) => `${it.parsed.y} % of the water` } } } }),
            plugins: [MONTH_LINE] })} />
      ) : null}
      {pd ? (
        <ChartCard title={`The clicked pixel (${pd.lat.toFixed(2)}° N, ${pd.lon.toFixed(2)}° E)`} sub={`${unit}${isChl ? " · log scale" : ""} · gaps = no reading · click to move the slider`} height={190}
          deps={[l.id, pd.col, pd.row]} line={hi} make={() => ({ type: "line",
            data: { labels: pd.keys, datasets: [{ label: "Pixel", data: pd.values, borderColor: "#e6eef0", backgroundColor: "#e6eef0", borderWidth: 1.4, pointRadius: l.annual ? 3 : 1.2, spanGaps: false }] },
            options: options({ onClick: toFrame(false), scales: { x: { ...AXIS, ticks: { ...AXIS.ticks, autoSkip: false, maxRotation: 0, callback: (i) => { const k = pd.keys[i]; return (l.annual || k.endsWith("-01")) && (+k.slice(0, 4) - 1998) % 4 === 0 ? k.slice(0, 4) : null; } } }, y: yAxis() },
              plugins: { legend: { display: false }, tooltip: { callbacks: { title: (it) => (l.annual ? pd.keys[it[0].dataIndex] : np.monthLabel(pd.keys[it[0].dataIndex])), label: (it) => `${f(it.parsed.y)} ${unit}` } } } }),
            plugins: [MONTH_LINE] })} />
      ) : null}
    </>
  );
}

const DECADES = ["1950s", "1960s", "1970s", "1980s", "1990s", "2000s", "2010s", "2020s"];
const decadeChart = (counts, color, label) => ({ type: "bar", data: { labels: DECADES, datasets: [{ label, data: DECADES.map((d) => counts[d] ?? 0), backgroundColor: color, borderWidth: 0 }] },
  options: options({ scales: { x: AXIS, y: { ...AXIS, ticks: { ...AXIS.ticks, callback: (q) => q.toLocaleString("en") } } }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (it) => `${it.parsed.y.toLocaleString("en")} ${label}` } } } }) });

/** Records from open databases: plankton species presence, or measured values. */
function InsituBody({ l, tc }) {
  const I = np.data().insitu, sel = useNp((s) => s.insPick), vsel = useNp((s) => s.insVar);
  const top = I.datasets[0], share = top ? top.rows / (I.plankton.records || 1) : 0;
  const sources = (
    <div className="ntab">
      <div className="ntab-h">Where the records come from<span>dataset · records · licence (keep the source's citation when you reuse them)</span></div>
      <table><thead><tr><th>Dataset</th><th className="n">Rows</th><th>Licence</th></tr></thead>
        <tbody>{I.datasets.slice(0, 12).map((d) => <tr key={d.id}><td>{d.title ?? d.id}</td><td className="n">{d.rows.toLocaleString("en")}</td><td>{d.license ?? "see source"}</td></tr>)}</tbody></table>
    </div>
  );
  if (l.mode === "plankton") {
    const P = I.plankton, c = sel?.kind === "cell" ? P.cells[sel.i] : null, dec = Object.entries(P.decades).sort((a, b) => b[1] - a[1])[0];
    const points = [
      `${P.records.toLocaleString("en")} records of ${P.taxa} named kinds of plankton fall in ${P.cells.length} squares of 25 km. A record means a species was seen in a water sample there; it says nothing about how much.`,
      dec ? `${Math.round((100 * dec[1]) / P.records)} % of the records are from the ${dec[0]}.` : null,
      top && share > 0.5 ? `${Math.round(100 * share)} % of the records come from one dataset (${top.title ?? top.id}). The map therefore shows mostly where research ships sampled, not where plankton lives.` : null,
      I.registry ? `${P.coastal_records.toLocaleString("en")} records lie within 100 km of the Pakistan shore; the rest are in the wider northern Arabian Sea.` : null,
      "Records that failed screening (flagged positions, unclear names or licences, sediment samples) were held back and are not drawn.",
    ].filter(Boolean);
    return (
      <>
        <div className="facts">
          <div className="ft">Key findings: plankton records<span>OBIS · 1950 on</span></div>
          <div className="big" style={{ color: tc }}>{P.records.toLocaleString("en")}<small>records · {P.taxa} kinds</small></div>
          <ul>
            <li>{c ? `Selected square ${c.lat.toFixed(3)}° N, ${c.lon.toFixed(3)}° E: ${c.n.toLocaleString("en")} records${c.years ? `, ${c.years[0]}-${c.years[1]}` : ""}${c.coastal ? `, ${c.coastal} within 100 km of the shore` : ""}` : "Click a square to see what was recorded there"}</li>
            {c ? Object.entries(c.taxa).slice(0, 6).map(([t, k]) => <li key={t}>{t}: {k.toLocaleString("en")}</li>) : P.top_taxa.slice(0, 6).map(([t, k]) => <li key={t}>{t}: {k.toLocaleString("en")} records</li>)}
          </ul>
        </div>
        <div className="kpts"><div className="ft">Key points<span>in simple words</span></div><ul>{points.map((x) => <li key={x}>{x}</li>)}</ul></div>
        <ChartCard title="Records per decade" sub="how many of the records were collected in each decade" height={170} deps={[l.id]} make={() => decadeChart(P.decades, tc, "records")} />
        {sources}
      </>
    );
  }
  const vars = np.insVars(), key = vsel ?? vars[0]?.key, V = vars.find((v) => v.key === key), unit = key ? np.domUnit(key) : "";
  const dsel = useNp((s) => s.insDepth), band = np.insBand(), counts = key ? np.insBandCounts(key) : {};
  const rows = key ? np.insRows(key) : [], vals = rows.map((m) => m.value).sort((a, b) => a - b), q = (f) => vals[Math.min(vals.length - 1, Math.floor(f * vals.length))];
  const m = sel?.kind === "point" ? I.measured[sel.i] : null;
  return (
    <>
      <div className="regs" role="group" aria-label="Measured variable">{vars.map((v) => <button key={v.key} className={`rg ${v.key === key ? "on" : ""}`} onClick={() => np.setInsVar(v.key)}>{v.key.replace(/_/g, " ")}</button>)}</div>
      {V ? <div className="regs" role="group" aria-label="Depth" data-depth={dsel}>{np.DEPTHS.map((b) => <button key={b.id} className={`rg ${b.id === band.id ? "on" : ""}`} disabled={!counts[b.id]} onClick={() => np.setInsDepth(b.id)}>{b.label} ({(counts[b.id] ?? 0).toLocaleString("en")})</button>)}</div> : null}
      {V && !rows.length ? <p className="note-sm">No {key.replace(/_/g, " ")} readings at {band.label.toLowerCase()}. Pick another depth above.</p> : null}
      {V && rows.length ? (
        <>
          <div className="facts">
            <div className="ft">Key findings: {key.replace(/_/g, " ")}<span>{band.label} · {V.years ? `${V.years[0]}-${V.years[1]}` : "dates unknown"}</span></div>
            <div className="big" style={{ color: tc }}>{rows.length.toLocaleString("en")}<small>readings in {unit || "the source's unit"} · {new Set(rows.map((r) => `${r.lat},${r.lon}`)).size} places</small></div>
            <ul>
              {I.thinned?.rows && band.id !== "surface" && (key === "salinity" || key === "water_temperature") ? <li>Ship CTD profiles are drawn at standard depths ({I.thinned.levels_m.slice(0, 5).join(", ")} … m), each the actual reading nearest that depth; the {I.thinned.rows.toLocaleString("en")} readings in between are kept in the data but not drawn</li> : null}
              {band.id === "all" ? <li>Readings from different depths are drawn together; the shallowest sits on top. Pick one depth to compare like with like</li> : null}
              <li>Lowest {+vals[0].toPrecision(3)}, middle {+q(0.5).toPrecision(3)}, highest {+vals.at(-1).toPrecision(3)} {unit}</li>
              {key === "chlorophyll_a_hplc" ? <li>Measured in a laboratory (HPLC) on water samples from the Tara Oceans expedition, March 2010: the most reliable chlorophyll held, but only a few samples on one cruise</li> : null}
              {key === "chlorophyll_a_insitu" ? <li>These are sensor fluorescence readings (Argo floats and ship fluorometers), not chlorophyll measured on a water sample; see "chlorophyll a extracted" and "chlorophyll a hplc" for those</li> : null}
              {key === "chlorophyll_a_extracted" ? <li>Chlorophyll extracted from ship water samples (World Ocean Database bottles): measured on the sample, mostly 1960s-1990s</li> : null}
              <li>Single samples at single places and times, not a map of the whole sea: the dots show where someone measured</li>
              {V.units.length > 1 ? <li>Other units found ({V.units.filter((x) => x !== unit).join(", ")}) are not mixed in: only {unit} is drawn</li> : null}
              <li>{m ? `Selected: ${m.value} ${m.unit}, ${m.date ?? "date unknown"}${m.depth != null ? `, ${m.depth} m deep` : ""} (${m.src})` : "Click a dot to see its value, date and depth"}</li>
            </ul>
          </div>
          <ChartCard title="Samples per decade" sub="how many samples were collected in each decade" height={170} deps={[l.id, key]} make={() => decadeChart(V.decades, tc, "samples")} />
        </>
      ) : V ? null : <p className="note-sm">No measured values are loaded yet.</p>}
      {sources}
    </>
  );
}

/** A long-term nutrient average: the cell nearest each place, the cells as a table, and how the nutrients connect to algae. */
function NutrientBody({ l, p, tc }) {
  const D = np.data(), w = D[l.key], other = l.key === "nitrate" ? "phosphate" : "nitrate";
  const c = np.nearestCell(l.key, p), n = np.nearestCell("nitrate", p), ph = np.nearestCell("phosphate", p);
  const vals = w.cells.map((x) => x[2]), key = (x) => `${x[0]},${x[1]}`, partner = new Map(D[other].cells.map((x) => [key(x), x[2]]));
  const chl = p.values.filter((x) => x != null).sort((a, b) => a - b), chlMed = chl[Math.floor(chl.length / 2)];
  const ratio = n && ph && n.lat === ph.lat && n.lon === ph.lon ? n.value / ph.value : null;
  const points = [
    c ? `${l.short} near ${p.name}: ${c.value.toFixed(2)} µmol/kg, the 1965-2022 average at the sea surface (cell centred ${c.lat}° N, ${c.lon}° E).` : null,
    ratio ? `Nitrate is about ${ratio.toFixed(1)} times phosphate there. Algae use them at about 16 to 1, so in these offshore averages nitrogen runs out first: extra nitrogen, from rivers or waste water, is what lets algae grow more.` : null,
    chl.length ? `Algae at ${p.name} over 2020-2026: median ${np.fmt(chlMed)} mg/m³ of chlorophyll-a (${chl.length} months with a reading).` : null,
    "These are averages over 1965-2022 on cells about 100 km across: they do not show the creeks, single years or today's water. Field samples are needed to judge enrichment.",
  ].filter(Boolean);
  return (
    <>
      <div className="facts">
        <div className="ft">Key findings: {p.name}<span>{w.period} average</span></div>
        <div className="big" style={{ color: tc }}>{c ? c.value.toFixed(2) : "—"}<small>µmol/kg {l.short.toLowerCase()} in the nearest cell</small></div>
        <div className="grid">{D.places.map((x) => { const y = np.nearestCell(l.key, x); return <div className={`cell ${x.id === p.id ? "np-on" : ""}`} key={x.id}><div className="r">{x.name}</div><div className="v">{y ? y.value.toFixed(2) : "—"}</div></div>; })}</div>
        <ul>
          <li>{w.cells.length} of {w.cells_total} cells have a value, {Math.min(...vals).toFixed(2)} to {Math.max(...vals).toFixed(2)} µmol/kg; the others are land or not analysed</li>
          {c ? <li>The nearest cell's centre is about {c.km} km from the monitoring pixel</li> : null}
          <li>Sea surface (0 m), {w.cell_deg}° cells</li>
        </ul>
      </div>
      <div className="kpts"><div className="ft">Key points<span>in simple words</span></div><ul>{points.map((x) => <li key={x}>{x}</li>)}</ul></div>
      <div className="ntab">
        <div className="ntab-h">Every cell with a value<span>µmol/kg · N:P = nitrate ÷ phosphate · highlighted: nearest to {p.name}</span></div>
        <table>
          <thead><tr><th>Cell centre</th><th className="n">Nitrate</th><th className="n">Phosphate</th><th className="n">N:P</th></tr></thead>
          <tbody>{[...w.cells].sort((a, b) => b[0] - a[0] || a[1] - b[1]).map((x) => {
            const nv = l.key === "nitrate" ? x[2] : partner.get(key(x)), pv = l.key === "phosphate" ? x[2] : partner.get(key(x));
            return <tr key={key(x)} className={c && c.lat === x[0] && c.lon === x[1] ? "on" : ""}><td>{x[0]}° N, {x[1]}° E</td><td className="n">{nv?.toFixed(2) ?? "—"}</td><td className="n">{pv?.toFixed(2) ?? "—"}</td><td className="n">{nv != null && pv ? (nv / pv).toFixed(1) : "—"}</td></tr>;
          })}</tbody>
        </table>
      </div>
    </>
  );
}

function How({ l }) {
  const S = np.data().sources;
  const N = np.data().hist?.notes;
  if (l.kind === "insitu") return <div className="why"><b>How it was made.</b> Open-database records inside 60-70 E, 20-27 N from 1950, downloaded unedited and screened by DMJM's agent under rules set by the portal developer: records with flagged positions or depths, unaccepted names, unclear licences or sediment context are held back, never altered. Each record keeps its source and licence. Plankton rows are presence only: no count or concentration is made from them.<br /><span className="muted">Observations, not a survey: coverage follows where research ships went</span></div>;
  const text = l.still
    ? `${N.package}. ${N[l.note]} ${l.note === "scenario" || l.note === "change" ? "" : N.area}`
    : l.kind === "hmap"
    ? `${N.package}. ${l.set.startsWith("chl") ? N.chl : N.sst} ${l.annual ? N.annual : ""} ${N.gaps} ${N.area}`
    : l.kind === "woa"
    ? `NOAA World Ocean Atlas 2023: objectively analysed annual average of ${l.short.toLowerCase()} at the sea surface, ${S.woa.period}, one-degree cells, as prepared by ${S.observatory.name}${S.observatory.version ? ` v${S.observatory.version}` : ""} on ${S.observatory.prepared_on}. Land and unanalysed cells are left out.`
    : l.kind === "grid"
      ? `One monthly satellite composite (${S.chlorophyll.provider}, dataset ${S.chlorophyll.dataset_id}, about ${S.chlorophyll.resolution_km} km pixels) for ${np.monthLabel(np.data().chlorophyll.date)}, as prepared by ${S.observatory.name}. Native pixels, no interpolation; clouds and land are left blank.`
      : `Monthly satellite chlorophyll-a (dataset ${S.points.dataset_id}, about ${S.points.resolution_km} km) at one fixed pixel per place, retrieved ${S.points.retrieved_at.slice(0, 10)} by ${S.observatory.name}. Months without a valid reading are left empty. The usual for a month is the median of that calendar month in ${np.data().baseline_years.join("-")}, when at least three of those years have a reading (the observatory's rule); a month inside those years is part of its own usual.`;
  return <div className="why"><b>How it was made.</b> {text}<br /><span className="muted">{l.kind === "woa" ? "Long-term average · regional context, not a creek measurement" : "Satellite biomass estimate · not a field sample, species count or toxin test"}</span></div>;
}

export function NpPanelBody() {
  const ready = useNp((s) => s.ready), error = useNp((s) => s.error), layer = useNp((s) => s.layer), idx = useNp((s) => s.idx), point = useNp((s) => s.point);
  const top = useRef(null);
  useEffect(() => { np.start(); }, []);
  useEffect(() => { const sc = top.current?.closest(".panel-scroll"); if (sc) sc.scrollTop = 0; }, [layer]); // another layer starts at the top of the panel
  if (error) return <p className="note-sm">{error}</p>;
  if (!ready || !layer) return <p className="note-sm">Loading the nutrients and plankton data…</p>;
  const l = np.LAYERS[layer], t = np.tabOf(layer), D = np.data(), p = np.placeOf(point), i = monthOf(l, idx);
  return (
    <div className="om-panel np-panel" style={{ "--tc": t.tc }} ref={top}>
      <div className="ph"><div className="k" style={{ color: t.tc }}>{t.title} · {t.steps}</div><h2>{l.title}</h2><p>{l.shows}</p></div>
      {l.kind === "hmap" || l.kind === "insitu" ? null : <div className="regs" role="group" aria-label="Monitoring point">{D.places.map((x) => <button key={x.id} className={`rg ${x.id === point ? "on" : ""}`} onClick={() => np.setPoint(x.id)}>{x.name}</button>)}</div>}
      {l.kind === "insitu" ? <InsituBody key={l.id} l={l} tc={t.tc} /> : l.still ? <StillBody key={l.id} l={l} tc={t.tc} /> : l.kind === "hmap" ? <HistBody key={l.id} l={l} tc={t.tc} /> : l.kind === "woa" ? <NutrientBody l={l} p={p} tc={t.tc} /> : l.kind === "grid" ? <MapBody p={p} i={i} tc={t.tc} /> : <MonthBody key={l.id} l={l} p={p} i={i} tc={t.tc} />}
      <How l={l} />
    </div>
  );
}
