/**
 * Chart of a layer's own series (layer.charts in src/config/layers.js).
 * With no data → a labelled, data-pending frame (no invented values).
 * With data → minimal line / bar rendering. Expected shape:
 *   data = { series: [{ name, points: [{ x: number|string, y: number }] }] }
 */
import { useStore } from "../state.js";
import { PopBox, PopButton } from "../lib.jsx";
import { TimeChart } from "./TimeChart.jsx";
import { GainLossChart } from "./GainLossChart.jsx";

const W = 340, H = 200, M = { l: 44, r: 12, t: 12, b: 34 };
const X0 = M.l, X1 = W - M.r, Y0 = H - M.b, Y1 = M.t;

function Frame({ cfg }) {
  const unit = cfg.unit && cfg.unit !== "—" ? ` (${cfg.unit})` : "";
  return (
    <>
      <line className="ax" x1={X0} y1={Y0} x2={X1} y2={Y0} />
      <line className="ax" x1={X0} y1={Y0} x2={X0} y2={Y1} />
      <text className="axl" x={(X0 + X1) / 2} y={H - 6} textAnchor="middle">{cfg.xLabel}</text>
      <text className="axl" transform={`translate(12 ${(Y0 + Y1) / 2}) rotate(-90)`} textAnchor="middle">{cfg.yLabel}{unit}</text>
    </>
  );
}

function Pending({ cfg }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${cfg.title} — dataset required`}>
      {[0.25, 0.5, 0.75].map((f) => <line key={f} className="gd" x1={X0} x2={X1} y1={Y0 - (Y0 - Y1) * f} y2={Y0 - (Y0 - Y1) * f} />)}
      <Frame cfg={cfg} />
      <text className="pend" x={(X0 + X1) / 2} y={(Y0 + Y1) / 2 - 2} textAnchor="middle">Dataset required</text>
      <text className="pend-sub" x={(X0 + X1) / 2} y={(Y0 + Y1) / 2 + 16} textAnchor="middle">{cfg.placeholder}</text>
    </svg>
  );
}

function Plotted({ cfg, data }) {
  const year = useStore((s) => s.year);
  const series = data.series ?? [];
  const pts = series.flatMap((s) => s.points);
  if (!pts.length) return <Pending cfg={cfg} />;
  if (cfg.type === "gainloss") return <GainLossChart data={data} />;
  const cat = typeof pts[0].x === "string";
  if (!cat && cfg.type !== "bar") return <TimeChart groups={series} yLabel={cfg.yLabel} unit={data.unit ?? cfg.unit} />; // follows the timeline
  const xs = cat ? [...new Set(pts.map((p) => p.x))] : pts.map((p) => p.x);
  const xMin = cat ? 0 : Math.min(...xs), xMax = cat ? xs.length - 1 || 1 : Math.max(...xs);
  const yMax = Math.max(0, ...pts.map((p) => p.y)), yMin = Math.min(0, ...pts.map((p) => p.y));
  const px = (x) => M.l + ((cat ? xs.indexOf(x) : x) - xMin) / (xMax - xMin || 1) * (W - M.l - M.r);
  const py = (y) => H - M.b - ((y - yMin) / (yMax - yMin || 1)) * (H - M.t - M.b);
  const bw = Math.max(4, ((W - M.l - M.r) / xs.length) * 0.5);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={cfg.title}>
      <Frame cfg={cfg} />
      {cfg.type === "bar"
        // bars that carry the year their period starts (from) fade until the timeline reaches them
        ? pts.map((p, i) => <rect key={i} className={`bar ${p.from != null && p.from >= year ? "ahead" : ""}`} x={px(p.x) - bw / 2} y={Math.min(py(p.y), py(0))} width={bw} height={Math.abs(py(p.y) - py(0))} rx="1.5" />)
        : series.map((s, i) => <polyline key={i} className={`ln s${i % 4}`} points={s.points.map((p) => `${px(p.x)},${py(p.y)}`).join(" ")} />)}
    </svg>
  );
}

export async function loadChartData(cfg) {
  if (!cfg?.endpoint) return null;
  try { return await (await fetch(cfg.endpoint)).json(); } catch { return null; }
}

export function Chart({ cfg, data = null }) {
  const Box = data ? PopBox : "figure";
  return (
    <Box className={`chart ${data ? "" : "is-pending"}`} data-type={cfg.type}>
      <figcaption><span className="chart-title">{cfg.title}</span><span className="chart-tag">{data ? cfg.unit ?? "" : "No data connected"}</span>{data ? <PopButton /> : null}</figcaption>
      {data ? <Plotted cfg={cfg} data={data} /> : <Pending cfg={cfg} />}
    </Box>
  );
}
