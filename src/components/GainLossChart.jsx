/**
 * Mangrove gross gain and loss per year (api/layers/mangroves/gainloss, from the team's mangrove_by_year_1985_2050.csv):
 * gain as a bar above the line, loss below it, each year against the one before. Mapped years, then the projection of
 * the scenario chosen with the SSP keys. Follows the timeline like TimeChart: years not yet reached are faint, and the
 * read-out gives that year's figures; pointing at a year shows that one instead.
 *   data = { unit, series: [{ name, scenario, points: [{ x: year, gain, loss, net }] }] }
 */
import { useState } from "react";
import { useStore, SSP_SCENARIO } from "../state.js";
import { SSPS } from "../amib/hazards.js";
import { FIRST_YEAR, fmt } from "./TimeChart.jsx";

const W = 340, H = 200, M = { l: 46, r: 12, t: 16, b: 30 };
export const GAIN = "#2ca596", LOSS = "#d4763a"; // checked for colour-blind separation on the panel's dark surface

export function GainLossChart({ data }) {
  const year = useStore((s) => s.year), ssp = useStore((s) => s.ssp);
  const [hover, setHover] = useState(null);
  const series = data.series ?? [];
  const observed = series.find((s) => s.scenario === "observed")?.points ?? [];
  const wanted = SSP_SCENARIO[ssp];
  const projection = series.find((s) => s.scenario === wanted) ?? series.find((s) => s.scenario !== "observed");
  const lastMapped = observed.at(-1)?.x ?? -Infinity;
  const pts = [...observed, ...(projection?.points ?? []).filter((p) => p.x > lastMapped)].filter((p) => p.x >= FIRST_YEAR);
  if (!pts.length) return <p className="caveat">No gain or loss figures from {FIRST_YEAR} on.</p>;

  const unit = data.unit ?? "km²";
  const x0 = FIRST_YEAR, x1 = pts.at(-1).x;
  const band = (W - M.l - M.r) / (x1 - x0 + 1), bw = Math.max(1.5, band - 1.5); // a thin gap between neighbouring years
  const px = (x) => M.l + (x - x0) * band; // left edge of that year's column
  const top = Math.max(...pts.map((p) => p.gain)) * 1.08 || 1, bottom = Math.max(...pts.map((p) => p.loss)) * 1.08 || 1;
  const py = (y) => M.t + ((top - y) / (top + bottom)) * (H - M.t - M.b);
  const zero = py(0);

  const at = hover ?? Math.min(x1, Math.max(x0, year));
  const cur = pts.find((p) => p.x === at) ?? pts.filter((p) => p.x <= at).pop();
  const projected = (x) => x > lastMapped;
  const sspShort = SSPS.find((s) => SSP_SCENARIO[s.id] === projection?.scenario)?.short ?? projection?.name;
  const signed = (v) => (v > 0 ? `+${fmt(v)}` : v < 0 ? `−${fmt(-v)}` : "0");

  return (
    <div className="tc gl">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Mangrove gain and loss by year, ${x0}–${x1}`} onMouseLeave={() => setHover(null)}>
        {[[top / 1.08, signed(Math.round(top / 1.08))], [0, "0"], [-bottom / 1.08, signed(-Math.round(bottom / 1.08))]].map(([y, label], i) => (
          <g key={i}>
            <line className={y === 0 ? "ax" : "gd"} x1={M.l} x2={W - M.r} y1={py(y)} y2={py(y)} />
            <text className="axl" x={M.l - 5} y={py(y) + 3} textAnchor="end">{label}</text>
          </g>
        ))}
        {lastMapped < x1 ? (
          <g className="gl-split">
            <line x1={px(lastMapped + 1)} x2={px(lastMapped + 1)} y1={M.t - 6} y2={H - M.b} />
            <text className="axl" x={px(lastMapped + 1) + 4} y={M.t - 6}>Projected · {sspShort}</text>
          </g>
        ) : null}
        {pts.map((p) => {
          const ahead = p.x > at, x = px(p.x) + (band - bw) / 2;
          return (
            <g key={p.x} className={`${ahead ? "ahead" : ""} ${projected(p.x) ? "proj" : ""}`}>
              {p.gain > 0 ? <rect className="gl-bar" style={{ fill: GAIN }} x={x} y={py(p.gain)} width={bw} height={zero - py(p.gain)} rx="1" /> : null}
              {p.loss > 0 ? <rect className="gl-bar" style={{ fill: LOSS }} x={x} y={zero} width={bw} height={py(-p.loss) - zero} rx="1" /> : null}
              <rect className="gl-hit" x={px(p.x)} y={M.t} width={band} height={H - M.t - M.b} onMouseEnter={() => setHover(p.x)} />
            </g>
          );
        })}
        <line className="tc-cur" x1={px(at) + band / 2} x2={px(at) + band / 2} y1={M.t} y2={H - M.b} />
        <text className="axl" x={M.l} y={H - 16}>{x0}</text><text className="axl" x={W - M.r} y={H - 16} textAnchor="end">{x1}</text>
        <text className="axl" x={(M.l + W - M.r) / 2} y={H - 4} textAnchor="middle">Change from the year before ({unit})</text>
      </svg>
      <div className="tc-read">
        <span><b>{cur?.x ?? at}</b>{cur && projected(cur.x) ? <em>projected, {sspShort}</em> : <em>mapped</em>}</span>
        <span><i style={{ background: GAIN }} />Gain {cur ? <b>{signed(cur.gain)}</b> : "—"}</span>
        <span><i style={{ background: LOSS }} />Loss {cur ? <b>{signed(-cur.loss)}</b> : "—"}</span>
        <span>Net {cur?.net != null ? <b>{signed(cur.net)}</b> : "—"} {unit}</span>
      </div>
    </div>
  );
}
