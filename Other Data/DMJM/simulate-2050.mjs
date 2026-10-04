// Scenario simulation of coastal plastic debris to 2050 (Monte Carlo).
// Run from this folder:  node simulate-2050.mjs
//
// Baseline  = per-site mean of the survey CSV (uncertainty by bootstrap of each site's surveys).
// Change    = national drivers below, applied to every site alike.
// Assumption: debris density on a beach scales in proportion to the plastic leaking
//             into the environment that year. Site-specific change is NOT modelled.
// Output is a scenario range, not a forecast. microplastic_risk_index is not projected
// (it is a bounded 0-100 derived index whose formula is not in the dataset).

import { readFileSync, writeFileSync } from "node:fs";

const CSV = "Pakistan_Coastal_Plastic_Debris_Demo_Dataset (1).csv";
const BASE_YEAR = 2026;
const END_YEAR = 2050;
const DRAWS = 10000;
const SEED = 20261002;
const METRICS = ["plastic_items_per_100m", "plastic_kg_per_100m"];

// Annual growth of plastic waste generated, %/yr (triangular: min, mode, max).
//   1.5  census-based projection, 3.2 Mt -> 4.79 Mt by 2050 (Springer 2026, s10163-026-02688-z)
//        and UN WPP 2024 population alone, 255.2 M (2025) -> 372 M (2050) = 1.5 %/yr
//   2.0  UNEP figures, 12.17 Mt (2020) -> 22.04 Mt (2050)
//   6.5  WWF/UNDP "12 Mt by 2040" from roughly 3.3-3.9 Mt today (base year approximate)
const WASTE_GROWTH = { min: 1.5, mode: 2.0, max: 6.5 };

// Leakage multiplier reached in 2050 relative to the no-policy path (uniform range).
// These two ranges are ASSUMPTIONS to be replaced by the team's policy targets.
const SCENARIOS = [
  { id: "bau", label: "Business as usual",
    note: "Waste grows; mismanaged share stays at today's level (about 70 %).",
    leakEnd: null },
  { id: "improved", label: "Improved waste management",
    note: "Waste grows; mismanaged share falls to 40-60 % of today's by 2050 (assumed).",
    leakEnd: [0.4, 0.6], onGrowth: true },
  { id: "strong", label: "Strong policy",
    note: "Leakage falls to 15-35 % of today's by 2050, on the path of the OECD Global Ambition scenario (near-zero leakage by 2060).",
    leakEnd: [0.15, 0.35], onGrowth: false },
];

// ---------- helpers ----------
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const uniform = (lo, hi) => lo + (hi - lo) * rand();
function triangular({ min, mode, max }) {
  const u = rand(), f = (mode - min) / (max - min);
  return u < f ? min + Math.sqrt(u * (max - min) * (mode - min))
               : max - Math.sqrt((1 - u) * (max - min) * (max - mode));
}
const quantile = (sorted, q) => {
  const p = (sorted.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (p - lo);
};
const round = (v, d) => Number(v.toFixed(d));

// ---------- data ----------
const lines = readFileSync(new URL(CSV, import.meta.url), "utf8").trim().split(/\r?\n/);
const header = lines[0].split(",");
const rows = lines.slice(1).map((l) => Object.fromEntries(l.split(",").map((v, i) => [header[i], v])));

const sites = new Map();
for (const r of rows) {
  if (!sites.has(r.coastal_site)) sites.set(r.coastal_site, { area: r.province_area, lat: [], lon: [], surveys: [] });
  const s = sites.get(r.coastal_site);
  s.lat.push(+r.latitude); s.lon.push(+r.longitude);
  s.surveys.push(Object.fromEntries(METRICS.map((m) => [m, +r[m]])));
}
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

// ---------- simulation ----------
const years = [];
for (let y = BASE_YEAR; y <= END_YEAR; y++) years.push(y);
const span = END_YEAR - BASE_YEAR;
const siteNames = [...sites.keys()];
const groups = [...siteNames, "All sites"];

// store[scenario][group][metric][yearIndex] = Float64Array(DRAWS)
const store = {};
for (const sc of SCENARIOS) {
  store[sc.id] = {};
  for (const g of groups) {
    store[sc.id][g] = {};
    for (const m of METRICS) store[sc.id][g][m] = years.map(() => new Float64Array(DRAWS));
  }
}

for (let d = 0; d < DRAWS; d++) {
  // one bootstrap baseline per site per draw, shared by all scenarios
  const base = {};
  for (const name of siteNames) {
    const sv = sites.get(name).surveys, pick = sv.map(() => sv[Math.floor(rand() * sv.length)]);
    base[name] = Object.fromEntries(METRICS.map((m) => [m, mean(pick.map((p) => p[m]))]));
  }
  const g = triangular(WASTE_GROWTH) / 100;
  for (const sc of SCENARIOS) {
    const end = sc.leakEnd ? uniform(...sc.leakEnd) : 1;
    years.forEach((y, yi) => {
      const t = y - BASE_YEAR;
      const policy = 1 + (end - 1) * (t / span);
      const mult = sc.leakEnd && !sc.onGrowth ? policy : Math.pow(1 + g, t) * policy;
      for (const m of METRICS) {
        let sum = 0;
        for (const name of siteNames) {
          const v = base[name][m] * mult;
          store[sc.id][name][m][yi][d] = v;
          sum += v;
        }
        store[sc.id]["All sites"][m][yi][d] = sum / siteNames.length;
      }
    });
  }
}

// ---------- output ----------
const out = {
  generated: new Date().toISOString().slice(0, 10),
  kind: "scenario simulation (not a forecast)",
  baseline: { file: CSV, surveys: rows.length, sites: siteNames.length, period: "2025-01 to 2026-09", provenance: "unverified - source references not recorded in the file" },
  method: { draws: DRAWS, seed: SEED, baseYear: BASE_YEAR, wasteGrowthPctPerYear: WASTE_GROWTH,
            assumption: "Beach debris density scales with national plastic leakage; no site-specific change." },
  scenarios: SCENARIOS.map(({ id, label, note }) => ({ id, label, note })),
  years,
  sites: Object.fromEntries(siteNames.map((n) => [n, { area: sites.get(n).area, lat: round(mean(sites.get(n).lat), 5), lon: round(mean(sites.get(n).lon), 5) }])),
  results: {},
};
const csv = ["scenario,site,metric,year,p5,p50,p95"];
for (const sc of SCENARIOS) {
  out.results[sc.id] = {};
  for (const grp of groups) {
    out.results[sc.id][grp] = {};
    for (const m of METRICS) {
      const dp = m.includes("kg") ? 2 : 0;
      const series = { p5: [], p50: [], p95: [] };
      years.forEach((y, yi) => {
        const a = store[sc.id][grp][m][yi].slice().sort();
        const q = [0.05, 0.5, 0.95].map((p) => round(quantile(a, p), dp));
        series.p5.push(q[0]); series.p50.push(q[1]); series.p95.push(q[2]);
        csv.push([sc.id, grp, m, y, ...q].join(","));
      });
      out.results[sc.id][grp][m] = series;
    }
  }
}
writeFileSync(new URL("projection_2050.json", import.meta.url), JSON.stringify(out));
writeFileSync(new URL("projection_2050.csv", import.meta.url), csv.join("\n") + "\n");

// console summary
const yi = (y) => y - BASE_YEAR;
console.log(`${rows.length} surveys, ${siteNames.length} sites, ${DRAWS} draws\n`);
for (const m of METRICS) {
  console.log(`${m} - all-site mean, median (5th-95th percentile)`);
  for (const sc of SCENARIOS) {
    const s = out.results[sc.id]["All sites"][m];
    const cell = (y) => `${s.p50[yi(y)]} (${s.p5[yi(y)]}-${s.p95[yi(y)]})`;
    console.log(`  ${sc.label.padEnd(26)} 2026: ${cell(2026).padEnd(18)} 2035: ${cell(2035).padEnd(20)} 2050: ${cell(2050)}`);
  }
  console.log();
}
console.log("plastic_items_per_100m in 2050 by site, median (5th-95th)");
for (const n of siteNames) {
  const c = SCENARIOS.map((sc) => { const s = out.results[sc.id][n][METRICS[0]]; return `${s.p50[span]} (${s.p5[span]}-${s.p95[span]})`.padEnd(20); });
  console.log(`  ${n.padEnd(15)} now ${String(out.results.bau[n][METRICS[0]].p50[0]).padEnd(5)} ${c.join(" ")}`);
}
