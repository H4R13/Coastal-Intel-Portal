/**
 * National fisheries numbers on the map. Topics 9-11 of the ocean package are one value for the whole country, so there
 * is no grid to draw: the sea zone is tinted one colour for the value of the timeline year, and a balloon states it.
 * The colour says how high the number is, not where in the sea anything happens.
 */
import { loadDoc } from "./oceanData.js";

/* topic → the package file and column the value comes from. `max` is the top of the colour scale. */
export const NATIONAL = {
  // the package's own indicator (stock_status_indicator, 26.35 % in 2023) is this sum for the final year
  9: { doc: "ssp_catch", label: "Catch from over-exploited or collapsed stocks", unit: "%", max: 40, period: "1950–2023", value: (r) => r["over-exploited_pct"] + r.collapsed_pct },
  10: { doc: "shell_share_series", label: "Molluscs in the catch", unit: "%", max: 4, period: "1950–2023", value: (r) => r.molluscs_pct },
  11: { doc: "national_index", label: "Potential impact (national index, 0–1)", unit: "", max: 1, period: null, fixed: (rows) => rows.find((r) => /^PI\b/.test(r.component))?.value },
};

/* low → high: blue, green, purple, red */
const RAMP = ["#3b82f6", "#22c55e", "#8b5cf6", "#ef4444"];
export const NATIONAL_RAMP = `linear-gradient(to right, ${RAMP.join(", ")})`;
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
function colorAt(t) {
  const p = Math.min(1, Math.max(0, t)) * (RAMP.length - 1), i = Math.min(RAMP.length - 2, Math.floor(p)), a = rgb(RAMP[i]), b = rgb(RAMP[i + 1]);
  return `rgb(${a.map((c, k) => Math.round(c + (b[k] - c) * (p - i))).join(",")})`;
}

/* ---- short trend forecast (owner request) ----
 * Random walk with drift, the standard benchmark for a yearly series: each year ahead adds the average yearly change
 * of the fitting window to the last measured value. The likely range is the 80 % prediction interval,
 * sd(changes) · sqrt(h · (1 + h / (n - 1))) for h years ahead. It is a statistical extrapolation of the package's
 * numbers, not part of the package and not a stock assessment, and it stops at HORIZON. */
const FIT_FROM = 1990, HORIZON = 2030, Z80 = 1.2816, TEST_YEARS = 7;
function driftForecast(points, until) {
  const fit = points.filter((p) => p.year >= FIT_FROM), steps = fit.slice(1).map((p, i) => p.value - fit[i].value), n = steps.length;
  const drift = steps.reduce((a, b) => a + b, 0) / n, sd = Math.sqrt(steps.reduce((a, b) => a + (b - drift) ** 2, 0) / (n - 1)), last = fit.at(-1);
  const clamp = (v) => Math.min(100, Math.max(0, v)), out = [];
  for (let h = 1; last.year + h <= until; h++) {
    const mid = last.value + drift * h, half = Z80 * sd * Math.sqrt(h * (1 + h / (n - 1)));
    out.push({ year: last.year + h, value: clamp(mid), lo: clamp(mid - half), hi: clamp(mid + half) });
  }
  return out;
}
const pointsOf = (def, data) => Object.values(Object.values(data)[0])[0].map((r) => ({ year: r.year, value: def.value(r) })); // { country: { source: [rows by year] } }

/** The measured series, its forecast to HORIZON, and how far the same method was off when tested on the last years. */
export async function nationalSeries(step) {
  const def = NATIONAL[step], data = def && !def.fixed && (await loadDoc(`data/${def.doc}`));
  if (!data) return null;
  const points = pointsOf(def, data), last = points.at(-1), held = points.slice(-TEST_YEARS);
  const test = driftForecast(points.slice(0, -TEST_YEARS), last.year); // forecast the held-back years from the ones before
  const error = test.reduce((a, f, i) => a + Math.abs(f.value - held[i].value), 0) / test.length;
  return { def, points, forecast: driftForecast(points, HORIZON), test: { from: held[0].year, to: last.year, error } };
}

/** The series chart for the panel, in the shape js/ocean/oceanFigures.js draws: a catalog-like entry and its data. */
export async function forecastFigure(step) {
  const s = await nationalSeries(step);
  if (!s) return null;
  const last = s.points.at(-1), ahead = [{ year: last.year, value: last.value, lo: last.value, hi: last.value }, ...s.forecast], col = (k) => ahead.map((f) => ({ year: f.year, value: f[k] }));
  return {
    l: {
      id: `national_forecast_${step}`, title: `${s.def.label}: measured, and trend forecast to ${HORIZON}`, badges: ["statistical extrapolation", "not from the data package"],
      shows: `The forecast continues the average yearly change of ${FIT_FROM}–${last.year} (random walk with drift); the range is where the value is expected to fall 8 times in 10. Tested on the past: forecasting ${s.test.from}–${s.test.to} from the years before was off by ${s.test.error.toFixed(1)} percentage points on average. It is not a stock assessment and says nothing beyond ${HORIZON}.`,
      chart: { type: "line_trend", x: "year", y: "value", y_label: `${s.def.label} (${s.def.unit})` },
    },
    data: { Pakistan: { Measured: s.points, "Trend forecast": col("value"), "Likely range, low": col("lo"), "Likely range, high": col("hi") } },
  };
}

/**
 * The value to show for a topic and timeline year: { def, value, year, color } plus { forecast, lo, hi } once the
 * timeline is past the last measured year. Null when the data is not there.
 */
export async function nationalAt(step, year) {
  const def = NATIONAL[step], data = def && (await loadDoc(`data/${def.doc}`));
  if (!data) return null;
  if (def.fixed) { const value = def.fixed(data); return typeof value === "number" ? { def, value, year: null, color: colorAt(value / def.max) } : null; }
  const s = await nationalSeries(step), last = s.points.at(-1);
  if (year > last.year) {
    const f = s.forecast.filter((p) => p.year <= year).pop(); // past the horizon: the last forecast year
    return { def, ...f, forecast: true, color: colorAt(f.value / def.max) };
  }
  const p = s.points.filter((q) => q.year <= year).pop() ?? s.points[0]; // the newest year at or before the timeline year
  return { def, value: p.value, year: p.year, color: colorAt(p.value / def.max) };
}
