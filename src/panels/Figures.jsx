/**
 * Figures for the ocean package's charts and tables (catalog layers of type "timeseries" and "table"); the plastics
 * panel draws its figures with the same cards.
 * Each one is drawn the way its catalog entry asks where that fits a side panel:
 *   year series            → lines that follow the timeline (region / product / measure pickers)
 *   bar, grouped_bar, horizontal_bar, dot_plot → horizontal bars or dots with the package's reference lines
 *   strip_plot             → one row of dots per indicator, the highlighted country marked
 *   big_number             → the headline value
 *   everything else        → a tile that opens the table full screen
 * Every chart card can flip to its data table, and every card opens full screen.
 *   <FigureCard l={catalog entry} data={its data} />;  kindOf(l, data) → "stat" | "chart" | "table"
 *   <FigureSections figures={[{ l, data }]} />   the cards grouped into Key figures, Charts and Data tables
 */
import { useState } from "react";
import { Icon, PopBox, PopButton, usePop } from "../lib.jsx";
import { TimeChart, FIRST_YEAR } from "../components/TimeChart.jsx";

export const num = (v) => (typeof v !== "number" ? String(v ?? "") : Number.isInteger(v) ? String(v) : Math.abs(v) < 1e-3 || Math.abs(v) >= 1e6 ? v.toExponential(2) : String(+v.toPrecision(4)));
const cell = (v) => (v == null ? "–" : v === true ? "✓" : v === false ? "✗" : Array.isArray(v) ? v.map(num).join("–") : num(v));
const NAMES = { ph: "pH", sst: "SST", omega: "Omega", PI: "PI" };
const pretty = (k) => { if (NAMES[k]) return NAMES[k]; const s = String(k).replace(/_pct\b/g, " %").replace(/_km2\b/g, " km²").replace(/_/g, " ").trim(); return s.charAt(0).toUpperCase() + s.slice(1); };
const titleOf = (l) => String(l.title).replace(/\s*\(table\)\s*$/i, "");
const PALETTE = ["var(--layer, var(--accent))", "#c9a3e6", "#7fd0c8", "#d8b77a", "#9fb4ff", "#e79ac0", "#b9d27a", "#f2c179"];
const BAR_TYPES = ["bar", "grouped_bar", "horizontal_bar", "dot_plot"];
const TABLE_ICON = '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M3.5 14.5h17M9.5 9.5v10"/>';

export function kindOf(l, data) {
  if (!data) return "table";
  if (!Array.isArray(data)) return "chart";
  if (l.chart?.type === "big_number") return "stat";
  return BAR_TYPES.includes(l.chart?.type) || l.chart?.type === "strip_plot" ? "chart" : "table";
}

/** A row of chips to pick one of several values; nothing when there is only one. */
function Chips({ values, current, onPick, label = (v) => v }) {
  if (values.length < 2) return null;
  return <div className="xchips">{values.map((v) => <button key={v} className={`xchip ${v === current ? "active" : ""}`} onClick={() => onPick(v)}>{label(v)}</button>)}</div>;
}

/* ---- tables ---- */
/** Series files are { region: { product: [rows] } }; flatten them for a table. */
const early = (r) => (typeof r.year === "number" && r.year < FIRST_YEAR) || (typeof r.time === "string" && +r.time.slice(0, 4) < FIRST_YEAR); // before the timeline: not shown anywhere
const flatten = (data) => (Array.isArray(data) ? data : Object.entries(data).flatMap(([region, byProduct]) => Object.entries(byProduct).flatMap(([product, rows]) => rows.filter((r) => !early(r)).map((r) => ({ region, product, ...r })))));
const ID_COLUMNS = ["region", "product", "definition", "variant", "scenario", "metric", "benchmark", "where", "model"];
const Td = ({ v }) => <td className={typeof v === "number" ? "n" : typeof v === "string" && v.length > 40 ? "txt" : ""}>{cell(v)}</td>;

function Table({ rows, columns }) {
  if (!rows.length) return <p className="caveat">No rows.</p>;
  const cols = columns?.filter((c) => c in rows[0]) ?? Object.keys(rows[0]);
  // a few records with many fields read better turned on their side: one column per record
  if (!columns && cols.length > 8 && rows.length <= 8) {
    const ids = ID_COLUMNS.filter((c) => cols.includes(c));
    return (
      <div className="otable"><table>
        <thead><tr><th></th>{rows.map((r, i) => <th key={i}>{ids.map((k) => r[k]).join(" · ") || `#${i + 1}`}</th>)}</tr></thead>
        <tbody>{cols.filter((c) => !ids.includes(c)).map((c) => <tr key={c}><th>{pretty(c)}</th>{rows.map((r, i) => <Td key={i} v={r[c]} />)}</tr>)}</tbody>
      </table></div>
    );
  }
  return (
    <>
      <div className="otable"><table>
        <thead><tr>{cols.map((c) => <th key={c}>{pretty(c)}</th>)}</tr></thead>
        <tbody>{rows.slice(0, 400).map((r, i) => <tr key={i}>{cols.map((c) => <Td key={c} v={r[c]} />)}</tr>)}</tbody>
      </table></div>
      {rows.length > 400 ? <p className="caveat">First 400 of {rows.length} rows.</p> : null}
    </>
  );
}
const TableOf = ({ l, data }) => <Table rows={flatten(data)} columns={l.chart?.type === "table_with_markers" ? l.chart.columns : null} />;

/* ---- year series ---- */
/** Monthly rows ("2004-01") become one point per full year: the mean of its twelve months. */
function yearly(rows, xKey, k) {
  if (xKey === "year") return rows.filter((r) => r[k] != null).map((r) => ({ x: r.year, y: r[k] }));
  const byYear = new Map();
  for (const r of rows) if (r[k] != null) { const y = +String(r[xKey]).slice(0, 4); byYear.set(y, [...(byYear.get(y) ?? []), r[k]]); }
  return [...byYear].filter(([, v]) => v.length === 12).map(([x, v]) => ({ x, y: v.reduce((a, b) => a + b, 0) / 12 }));
}

function SeriesFigure({ l, data, pick, set }) {
  const c = l.chart ?? {}, facets = Object.keys(data);
  const facet = facets.includes(pick.facet) ? pick.facet : facets.includes("Whole EEZ") ? "Whole EEZ" : facets[0];
  const products = Object.keys(data[facet]), first = data[facet][products[0]] ?? [];
  const xKey = first[0] && "year" in first[0] ? "year" : "time";
  const numeric = Object.keys(first[0] ?? {}).filter((k) => k !== xKey && first.some((r) => typeof r[k] === "number"));
  const colorOf = (k) => (typeof c.colors === "object" ? c.colors[k] ?? c.colors[k.replace(/_pct$/, "")] : undefined);
  // columns the entry draws together on one axis (heatwave classes, stock-status shares, index parts)
  const together = c.type !== "line_monthly_annual" && [].concat(Array.isArray(c.y) ? c.y : Array.isArray(c.panels) ? c.panels[0].y : [], c.line ?? []).filter((k) => numeric.includes(k));
  let groups, yLabel, extra = null;
  if (together?.length > 1) {
    const product = products.includes(pick.product) ? pick.product : products[0];
    groups = together.map((k) => ({ name: pretty(k), color: colorOf(k), points: yearly(data[facet][product], xKey, k) }));
    extra = <Chips values={products} current={product} onPick={(v) => set({ product: v })} label={pretty} />;
    yLabel = typeof c.y_label === "string" ? c.y_label : "";
  } else {
    const asked = typeof c.y === "string" ? c.y.split(" or ") : [].concat(c.y ?? []);
    const measures = [...asked.filter((k) => numeric.includes(k)), ...numeric.filter((k) => !asked.includes(k) && !/(_sd|_lo|_hi)$|^n_models$/.test(k))];
    const measure = measures.includes(pick.measure) ? pick.measure : measures[0];
    const label = (k) => (typeof c.y_label === "object" ? c.y_label[k] : k === c.y ? c.y_label : null) ?? pretty(k);
    groups = products.map((p) => ({ name: c.labels?.[p] ?? p, color: c.series_colors?.[p], points: yearly(data[facet][p], xKey, measure) }));
    if (measures.length > 1) {
      extra = (
        <div className="select omeasure"><select aria-label="Measure" value={measure} onChange={(e) => set({ measure: e.target.value })}>
          {measures.map((k) => <option key={k} value={k}>{label(k)}</option>)}
        </select></div>
      );
    }
    yLabel = label(measure);
  }
  groups = groups.filter((g) => g.points.length);
  return (
    <>
      <Chips values={facets} current={facet} onPick={(v) => set({ facet: v })} />
      {extra}
      {groups.length ? <TimeChart groups={groups} yLabel={yLabel} /> : <p className="caveat">No values for this choice.</p>}
      {groups.length && xKey !== "year" ? <p className="caveat">Each point is the mean of that year's twelve monthly values.</p> : null}
    </>
  );
}

/* ---- bars and dots ---- */
function BarsFigure({ l, rows: allRows, pick, set }) {
  const c = l.chart, flat = c.type === "horizontal_bar" || c.type === "dot_plot";
  let labelKey = flat ? c.y : c.x, picker = null, rows = allRows;
  const keys = [].concat(flat ? c.x : c.y);
  const labels = [...new Set(rows.map((r) => r[labelKey]))];
  if (c.series && labels.length < rows.length) { // several rows per label (one per product): pick the label, list the products
    const facet = labels.includes(pick.facet) ? pick.facet : labels[0];
    picker = <Chips values={labels} current={facet} onPick={(v) => set({ facet: v })} />;
    rows = rows.filter((r) => r[labelKey] === facet);
    labelKey = c.series;
  }
  if (/descending/.test(c.sort ?? "")) rows = [...rows].sort((a, b) => (b[keys[0]] ?? -Infinity) - (a[keys[0]] ?? -Infinity));
  const refs = Array.isArray(c.reference_lines) ? c.reference_lines.filter((r) => typeof r.y === "number") : [];
  const values = rows.flatMap((r) => keys.map((k) => r[k])).filter((v) => typeof v === "number");
  if (!values.length) return <Table rows={rows} />;
  const lo = Math.min(0, ...values), hi = Math.max(c.y_range?.[1] ?? 0, ...values, ...refs.map((r) => r.y)), pos = (v) => ((v - lo) / (hi - lo || 1)) * 100;
  const cats = c.color_by ? [...new Set(rows.map((r) => r[c.color_by]))] : [];
  const catColor = (v) => (typeof c.colors === "object" && c.colors[v]) || PALETTE[cats.indexOf(v) % PALETTE.length];
  const colorOf = (r, i) => (c.color_by ? catColor(r[c.color_by]) : PALETTE[i % PALETTE.length]);
  const key = keys.length > 1 ? keys.map((k, i) => [pretty(k), PALETTE[i % PALETTE.length]]) : cats.map((v) => [v, catColor(v)]);
  const axis = (flat ? c.x_label : c.y_label) ?? (keys.length === 1 ? pretty(keys[0]) : "");
  return (
    <>
      {picker}
      <ul className="obars">
        {rows.map((r, n) => (
          <li key={n} className={c.highlight && r[labelKey] === c.highlight ? "hl" : ""}>
            <span className="obar-name">{r[labelKey]}</span>
            {keys.map((k, i) => {
              const v = r[k];
              if (typeof v !== "number") return null;
              return (
                <div className="obar" key={k}>
                  <div className="obar-track">
                    {c.type === "dot_plot"
                      ? <i className="dot" style={{ left: `${pos(v)}%`, background: colorOf(r, i) }} />
                      : <i style={{ left: `${pos(Math.min(v, 0))}%`, width: `${Math.abs(pos(v) - pos(0))}%`, background: colorOf(r, i) }} />}
                    {refs.map((x, j) => <u key={j} style={{ left: `${pos(x.y)}%` }} />)}
                  </div>
                  <b>{num(v)}</b>
                </div>
              );
            })}
          </li>
        ))}
      </ul>
      {key.length || refs.length ? (
        <div className="okey">
          {key.map(([name, color]) => <span key={name}><i style={{ background: color }} />{name}</span>)}
          {refs.map((x, j) => <span key={j}><u />{x.label ?? num(x.y)}</span>)}
        </div>
      ) : null}
      {axis ? <p className="oaxis">{axis}</p> : null}
    </>
  );
}

/** One row of dots per indicator, every record a dot, the highlighted one large with its value. */
function StripFigure({ l, rows }) {
  const c = l.chart, [hKey, hValue] = Object.entries(c.highlight ?? {}).find(([k]) => k !== "label") ?? [], W = 340, ROW = 58, PAD = 12;
  const me = rows.find((r) => String(r[hKey]) === String(hValue));
  return (
    <>
      <svg viewBox={`0 0 ${W} ${c.x.length * ROW + 6}`} role="img" aria-label={titleOf(l)}>
        {c.x.map((k, i) => {
          const vals = rows.map((r) => r[k]).filter((v) => typeof v === "number"), lo = Math.min(...vals), hi = Math.max(...vals), y = i * ROW + 38;
          const x = (v) => PAD + ((v - lo) / (hi - lo || 1)) * (W - 2 * PAD);
          return (
            <g key={k}>
              <text className="pend-sub" x={PAD} y={y - 24}>{pretty(k)}</text>
              <line className="ax" x1={PAD} x2={W - PAD} y1={y} y2={y} />
              {vals.map((v, j) => <circle key={j} className="ostrip-dot" cx={x(v).toFixed(1)} cy={y} r="2.6" />)}
              <text className="axl" x={PAD} y={y + 14}>{num(lo)}</text><text className="axl" x={W - PAD} y={y + 14} textAnchor="end">{num(hi)}</text>
              {typeof me?.[k] === "number" ? (
                <>
                  <circle className="ostrip-me" cx={x(me[k]).toFixed(1)} cy={y} r="5" />
                  <text className="ostrip-val" x={Math.min(W - PAD - 14, Math.max(PAD + 14, x(me[k]))).toFixed(1)} y={y - 9} textAnchor="middle">{num(me[k])}</text>
                </>
              ) : null}
            </g>
          );
        })}
      </svg>
      <div className="okey"><span><i className="ostrip-key" />{c.highlight?.label ?? "Highlighted"}</span><span><i className="ostrip-key other" />Each of the other {rows.length - (me ? 1 : 0)} countries</span></div>
    </>
  );
}

function Stats({ l, rows }) {
  const c = l.chart;
  return (
    <div className="ostats">
      {rows.map((r, i) => (
        <div className="ostat" key={i}>
          {r.benchmark ? <span className="ostat-name">{r.benchmark}</span> : null}
          <b>{num(r[c.value])}{c.unit ? <small>{c.unit}</small> : null}</b>
          <span>{c.caption in r ? `${pretty(c.caption)}: ${num(r[c.caption])}` : c.caption ?? ""}{r.year ? ` · ${r.year}` : ""}</span>
        </div>
      ))}
    </div>
  );
}

/* ---- cards ---- */
const Badges = ({ l }) => ((l.badges ?? []).length ? <div className="obadges">{l.badges.map((b) => <span className="obadge" key={b}>{b}</span>)}</div> : null);

function TileHead({ title, small, open = false }) {
  const pop = usePop();
  return (
    <div className="otile-head">
      <Icon width={1.6} paths={TABLE_ICON} />
      <div><span className="chart-title">{title}</span><small>{small}</small></div>
      {open && pop ? <button className="oflip" title="Open the table full screen" onClick={pop}>Open</button> : null}
    </div>
  );
}

/** A card keeps its own choices (region, product, measure, chart or table); its full-screen copy shows the same ones. */
export function FigureCard({ l, data }) {
  const [pick, setPick] = useState({});
  const set = (patch) => setPick((p) => ({ ...p, ...patch }));
  const kind = kindOf(l, data), title = titleOf(l);
  if (!data) return <div className="otile"><TileHead title={title} small="Data not available" /></div>;
  if (kind === "chart") {
    return (
      <PopBox className="chart ocard">
        <figcaption>
          <span className="chart-title">{title}</span>
          <button className="oflip" title="Switch between the chart and its numbers" onClick={() => set({ mode: pick.mode === "table" ? "" : "table" })}>{pick.mode === "table" ? "Chart" : "Table"}</button>
          <PopButton />
        </figcaption>
        <div className="ocard-body">
          {pick.mode === "table" ? <TableOf l={l} data={data} />
            : !Array.isArray(data) ? <SeriesFigure l={l} data={data} pick={pick} set={set} />
            : l.chart.type === "strip_plot" ? <StripFigure l={l} rows={data} />
            : <BarsFigure l={l} rows={data} pick={pick} set={set} />}
        </div>
        <p className="ocard-about">{l.shows}</p><Badges l={l} />
      </PopBox>
    );
  }
  const rows = flatten(data), size = `${rows.length} row${rows.length === 1 ? "" : "s"} · ${Object.keys(rows[0] ?? {}).length} columns`;
  if (kind === "stat") {
    return (
      <PopBox className="chart ocard">
        <figcaption><span className="chart-title">{title}</span><PopButton /></figcaption>
        <Stats l={l} rows={rows} />
        <p className="ocard-about">{l.shows}</p><Badges l={l} />
        <div className="otable-wrap"><TableOf l={l} data={data} /></div>
      </PopBox>
    );
  }
  return (
    <PopBox as="div" className="otile">
      <TileHead title={title} small={size} open />
      <p className="ocard-about">{l.shows}</p>
      <div className="otable-wrap"><Badges l={l} /><TableOf l={l} data={data} /></div>
    </PopBox>
  );
}

/** figures: [{ l, data }] → the three sections; `first` is an extra chart card put before the others. */
export function FigureSections({ figures, first = null }) {
  const of = (kind) => figures.filter((f) => kindOf(f.l, f.data) === kind);
  const section = (title, cls, list, lead = null) => (list.length || lead ? (
    <section className="block"><h3 className="sec-title">{title}</h3><div className={cls}>
      {lead ? <FigureCard key={lead.l.id} l={lead.l} data={lead.data} /> : null}
      {list.map((f) => <FigureCard key={f.l.id} l={f.l} data={f.data} />)}
    </div></section>
  ) : null);
  return <>{section("Key figures", "ocards", of("stat"))}{section("Charts", "ocards", of("chart"), first)}{section("Data tables", "otiles", of("table"))}</>;
}
