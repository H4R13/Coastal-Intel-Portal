/**
 * Line chart over years that follows the timeline: the part up to the current year is drawn bright, the rest faint,
 * with a cursor line, a dot on each series and a read-out of the values at that year.
 *   <TimeChart groups={[{ name, color?, points: [{ x: year, y }] }]} yLabel unit />
 */
import { useId } from "react";
import { useStore } from "../state.js";
import { MODES } from "../config/layers.js";

/** First year of the timeline. Yearly charts drop anything earlier and start their axis here, so they all line up with it. */
export const FIRST_YEAR = Math.min(...MODES.map((m) => m.from));

const W = 340, H = 200, M = { l: 46, r: 12, t: 14, b: 30 };
const PALETTE = ["var(--layer, var(--accent))", "#c9a3e6", "#7fd0c8", "#d8b77a", "#9fb4ff", "#e79ac0", "#b9d27a", "#f2c179"];
/* Scenario lines always get the same three colours, whatever the layer: low/good blue, medium/normal orange,
   high/worst red; measured series are near-white. Other series take the palette in order. */
const SCENARIO_COLORS = [[/ssp1|126|\blow\b|good/i, "#5fa8e8"], [/ssp2|245|medium|normal/i, "#f79420"], [/ssp5|585|\bhigh\b|worst/i, "#e5534b"], [/observ|mapped|measured|histor/i, "#e5e8e5"]];
function colorsFor(groups) {
  const used = new Set();
  return groups.map((g, i) => {
    const fixed = g.color ?? SCENARIO_COLORS.find(([re]) => re.test(g.name))?.[1]; // a series may bring its own colour
    const color = fixed && !used.has(fixed) ? fixed : PALETTE[i % PALETTE.length]; // two series of one scenario: the second takes a palette colour
    used.add(color);
    return color;
  });
}
export const fmt = (v) => (Number.isInteger(v) ? String(v) : Math.abs(v) < 1e-3 || Math.abs(v) >= 1e6 ? v.toExponential(2) : String(+v.toPrecision(4)));

export function TimeChart({ groups: all, yLabel = "", unit = "" }) {
  const year = useStore((s) => s.year);
  const clip = `tc-${useId().replace(/:/g, "")}-clip`;
  const yearly = all.every((g) => g.points.every((p) => p.x > 1800 && p.x < 2300));
  const groups = yearly ? all.map((g) => ({ ...g, points: g.points.filter((p) => p.x >= FIRST_YEAR) })).filter((g) => g.points.length) : all;
  if (!groups.length) return <p className="caveat">No values from {FIRST_YEAR} on.</p>;

  const pts = groups.flatMap((g) => g.points), xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const pad = (Math.max(...ys) - Math.min(...ys)) * 0.06 || 1;
  const colors = colorsFor(groups);
  const x0 = yearly ? FIRST_YEAR : Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad;
  const px = (x) => M.l + ((x - x0) / (x1 - x0 || 1)) * (W - M.l - M.r);
  const py = (y) => H - M.b - ((y - y0) / (y1 - y0 || 1)) * (H - M.t - M.b);
  const lines = groups.map((g, i) => <polyline key={i} className="ln" style={{ stroke: colors[i] }} points={g.points.map((p) => `${px(p.x).toFixed(1)},${py(p.y).toFixed(1)}`).join(" ")} />);
  const yTicks = [y0 + pad, (y0 + y1) / 2, y1 - pad];

  const at = Math.min(x1, Math.max(x0, year)), cx = px(at);
  const now = groups.map((g) => g.points.filter((q) => q.x <= at).pop()); // each series' latest value at or before this year

  return (
    <div className="tc">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${yLabel} by year`}>
        <defs><clipPath id={clip}><rect className="tc-clip" x="0" y="0" width={cx} height={H} /></clipPath></defs>
        {yTicks.map((y, i) => (
          <g key={i}><line className="gd" x1={M.l} x2={W - M.r} y1={py(y)} y2={py(y)} /><text className="axl" x={M.l - 5} y={py(y) + 3} textAnchor="end">{fmt(y)}</text></g>
        ))}
        <line className="ax" x1={M.l} y1={H - M.b} x2={W - M.r} y2={H - M.b} />
        <text className="axl" x={M.l} y={H - 16}>{x0}</text><text className="axl" x={W - M.r} y={H - 16} textAnchor="end">{x1}</text>
        <text className="axl" x={(M.l + W - M.r) / 2} y={H - 4} textAnchor="middle">{yLabel}{unit ? ` (${unit})` : ""}</text>
        <g className="tc-rest">{lines}</g>
        <g clipPath={`url(#${clip})`}>{lines}</g>
        <line className="tc-cur" x1={cx} x2={cx} y1={M.t - 4} y2={H - M.b} />
        <text className="tc-year" x={Math.min(W - M.r - 12, Math.max(M.l + 12, cx))} y={M.t - 6} textAnchor="middle">{at}</text>
        {groups.map((g, i) => now[i] && <circle key={i} className="tc-dot" r="3" style={{ fill: colors[i] }} cx={px(now[i].x)} cy={py(now[i].y)} />)}
      </svg>
      {/* every series is always listed, so all scenarios are named even before the timeline reaches them */}
      <div className="tc-read">
        {groups.map((g, i) => {
          const p = now[i];
          return (
            <span key={i}><i style={{ background: colors[i] }} />{g.name}{" "}
              {p ? <><b>{fmt(p.y)}</b>{unit ? ` ${unit}` : ""}{p.x !== at ? <> <em>({p.x})</em></> : null}</> : <em>from {g.points[0].x}</em>}
            </span>
          );
        })}
      </div>
    </div>
  );
}
