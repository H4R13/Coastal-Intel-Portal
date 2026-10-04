/**
 * The assistant button (a robot face under the map toggles) and the warnings it raises when the portal opens.
 *   AssistantButton(root)   adds the button; clicking it opens a small greeting bubble above it (no chat behind it yet)
 *   announce()              lights the button up and shows three warnings for 4.1 seconds
 * The warnings are worked out from the portal's own data at that moment (see WARNINGS): each is a number the team's
 * datasets already contain, with its year and what kind of number it is. A warning whose data is not available is
 * left out; nothing is made up to fill the gap.
 */
import { PRESENT_YEAR } from "../config/layers.js";

const SHOW_MS = 4100;
const ROBOT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="7.5" width="16" height="12" rx="3.5"/><path d="M12 7.5V4.2"/><circle cx="12" cy="3.3" r="1.1"/><circle cx="9" cy="12.6" r="1.25" fill="currentColor"/><circle cx="15" cy="12.6" r="1.25" fill="currentColor"/><path d="M9.3 16.2h5.4M2.2 12v3.5M21.8 12v3.5"/></svg>`;
const get = (url) => fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);
const at = (series, year) => { const i = series?.year.indexOf(year) ?? -1; return i < 0 ? null : series.p50[i]; };
const n = (v, d = 0) => (+v.toFixed(d)).toLocaleString("en");

/* Each returns { when, title, text } or null. `when` is the year the number is about; the three soonest are shown. */
const WARNINGS = [
  async () => { // marine heatwaves: measured days per year (the package's own five-year figure and top year)
    const summary = await get("api/ocean/data/mhw_summary");
    const now = summary?.find((r) => r.region === "Whole EEZ" && r.definition === "fixed");
    if (!now) return null;
    return { when: PRESENT_YEAR, title: "Marine heatwaves · now", text: `${n(now.days_last5)} heatwave days a year over the last five years; ${n(now.days_mean_1991_2020)} was normal for 1991–2020. Worst years: ${now.top3_years_days}.` };
  },
  async () => { // coastal erosion: the team's projection of land lost
    const d = await get("api/layers/erosion/series"), mapped = d?.series.find((s) => s.name === "Mapped")?.points.at(-1), proj = d?.series.find((s) => s.name === "Projected")?.points;
    const by = proj?.find((p) => p.x === 2030);
    if (!mapped || !by) return null;
    return { when: 2030, title: "Coastal erosion · by 2030", text: `A further ${n(by.y - mapped.y)} km² of land projected lost to the sea, about ${n((by.y - mapped.y) / (2030 - mapped.x))} km² a year.` };
  },
  async () => { // fresh groundwater under the Indus Delta: modelled usable area
    const d = await get("api/amib/series/C"), s = d?.["usable fresh-lens area (P >= 0.7)"]?.series.find((x) => x.scenario === "current ssp245");
    const a = at(s, PRESENT_YEAR), b = at(s, 2030);
    if (a == null || b == null || b >= a) return null;
    return { when: 2030, title: "Fresh groundwater, Indus Delta · by 2030", text: `Usable fresh groundwater modelled to shrink from ${n(a)} to ${n(b)} km² (medium emissions, river flow as today).` };
  },
  async () => { // sea level at the delta, including land sinking
    const d = await get("api/amib/series/D"), s = d?.["relative sea-level rise (AR6 climate + InSAR land motion)"]?.series.find((x) => x.zone === "indus_delta" && x.scenario === "ssp245");
    const b = at(s, 2050);
    if (b == null) return null;
    return { when: 2050, title: "Sea level, Indus Delta · by 2050", text: `${n(b * 100)} cm of rise relative to the land (1995–2014 level), medium emissions, land sinking included.` };
  },
];

let button = null, bubble = null;
function place(el, gap = 12) { // fixed to the page, above the button: the sidebar clips anything inside it
  const r = button.getBoundingClientRect();
  el.style.left = `${Math.round(r.left)}px`;
  el.style.bottom = `${Math.round(window.innerHeight - r.top + gap)}px`;
}

export function AssistantButton(root) {
  button = document.createElement("button");
  button.className = "bot-btn";
  button.setAttribute("aria-label", "Assistant");
  button.title = "Assistant";
  button.innerHTML = ROBOT;
  root.appendChild(button);
  button.addEventListener("click", (e) => {
    e.stopPropagation();
    if (bubble) return hide();
    bubble = Object.assign(document.createElement("div"), { className: "bot-pop", innerHTML: `<b>Hi!</b><span>I'm the portal assistant. Chat isn't connected yet.</span>` });
    bubble.setAttribute("role", "status");
    document.body.appendChild(bubble);
    place(bubble);
  });
  const hide = () => { bubble?.remove(); bubble = null; };
  document.addEventListener("click", (e) => { if (bubble && !bubble.contains(e.target)) hide(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
}

/** Light the button up and show the three soonest warnings, all at once, for 4.1 seconds. */
export async function announce() {
  if (!button) return;
  const found = (await Promise.all(WARNINGS.map((w) => w().catch(() => null)))).filter(Boolean).sort((a, b) => a.when - b.when).slice(0, 3);
  button.classList.add("lit");
  setTimeout(() => button.classList.remove("lit"), SHOW_MS + 600);
  if (!found.length) return;
  const box = document.createElement("div");
  box.className = "bot-alerts";
  box.setAttribute("role", "alert");
  box.innerHTML = found.map((w, i) => `<div class="bot-alert" style="--i:${i}"><b>${w.title}</b><span>${w.text}</span></div>`).join("");
  document.body.appendChild(box);
  place(box, 14);
  setTimeout(() => { box.classList.add("out"); setTimeout(() => box.remove(), 400); }, SHOW_MS);
}
