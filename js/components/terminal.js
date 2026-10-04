/**
 * The portal's terminal: a command-line window over the map that runs a health check of the portal and prints the
 * result line by line. It opens from the memory-chip button at the bottom right, and once by itself when the page
 * loads (after the intro), where it closes again when the check has finished.
 *   openTerminal({ auto })   auto = true: run the check, then close; resolves when the window has closed
 * The server half of the check is server/diagnostics.mjs (GET api/diagnostics); the browser half is clientChecks below.
 * Typing works when it was opened by hand: help, diag, layers, clear, exit.
 * The window is handled the macOS way, with the three lights at the top left: red closes, yellow minimises it into
 * the chip button (which brings it back), green fills the screen and back.
 */
import { LAYERS } from "../config/layers.js";
import { getState } from "../state.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const TAG = { ok: "  OK  ", warn: " WARN ", fail: " FAIL " };
export const CHIP_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="7" width="19" height="9" rx="1.5"/><path d="M6 10v3M9.5 10v3M14.5 10v3M18 10v3M12 16v1.5M5 16v2.5M8 16v2.5M16 16v2.5M19 16v2.5"/></svg>`;

/** Checks only the browser can make: the map, the page and what it has loaded. */
async function clientChecks() {
  const out = [], add = (name, status, detail) => out.push({ group: "This browser", name, status, detail });
  const map = window.__map, gl = map?.getCanvas().getContext("webgl2") ?? map?.getCanvas().getContext("webgl");
  add("Map engine", map ? "ok" : "fail", map ? `MapLibre ${window.maplibregl?.getVersion?.() ?? ""} · ${gl ? "graphics running" : "no graphics context"} · zoom ${map.getZoom().toFixed(1)}` : "the map did not start");
  const sw = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration().catch(() => null) : null;
  add("Tile cache in the browser", sw?.active ? "ok" : "warn", sw?.active ? "service worker active: basemap tiles are kept between visits" : "not active yet: it starts on the next reload");
  const nav = performance.getEntriesByType("navigation")[0], mem = performance.memory;
  add("Page", "ok", `${performance.getEntriesByType("resource").length} files loaded${nav ? ` · ready in ${(nav.domContentLoadedEventEnd / 1000).toFixed(1)} s` : ""}${mem ? ` · ${Math.round(mem.usedJSHeapSize / 1048576)} MB of browser memory` : ""} · screen ${window.innerWidth}×${window.innerHeight}`);
  const s = getState();
  add("Layers on the map", "ok", s.activeLayers.length ? s.activeLayers.map((id) => LAYERS.find((l) => l.id === id)?.title).join(", ") : "none switched on");
  return out;
}

let open = null; // the one terminal window, while it is on screen
export function openTerminal({ auto = false } = {}) {
  if (open) { open.restore(); return open.closed; }
  const el = document.createElement("div");
  el.className = "term";
  el.innerHTML = `<div class="term-win" role="dialog" aria-label="Portal terminal">
    <div class="term-bar"><span class="term-lights"><button class="red" data-win="close" aria-label="Close" title="Close (Esc)"></button><button class="yellow" data-win="min" aria-label="Minimise" title="Minimise"></button><button class="green" data-win="zoom" aria-label="Full screen" title="Full screen"></button></span><b>ngt@coastal-portal — diagnostics</b><span class="term-lights-pad"></span></div>
    <div class="term-out" aria-live="polite"></div>
    <form class="term-in" autocomplete="off"><span>ngt@portal:~$</span><input type="text" spellcheck="false" aria-label="Command" /></form>
  </div>`;
  document.body.appendChild(el);
  const outEl = el.querySelector(".term-out"), input = el.querySelector("input"), form = el.querySelector(".term-in");
  let done, settle, alive = true;
  const closed = new Promise((r) => (done = r)), settled = new Promise((r) => (settle = r)); // settled: closed, or put away after the automatic check
  const chip = document.querySelector(".term-btn");
  const restore = () => { el.classList.remove("min"); chip?.classList.remove("has-min"); input.focus(); };
  const minimise = () => { el.classList.add("min"); chip?.classList.add("has-min"); };
  const close = () => { if (!alive) return; alive = false; chip?.classList.remove("has-min"); el.classList.add("leaving"); document.removeEventListener("keydown", onKey); setTimeout(() => { el.remove(); open = null; done(); settle(); }, 260); };
  const onKey = (e) => { if (e.key === "Escape" && !el.classList.contains("min")) close(); };
  document.addEventListener("keydown", onKey);
  const WINDOW = { close, min: minimise, zoom: () => el.classList.toggle("zoomed") };
  el.querySelectorAll("[data-win]").forEach((b) => b.addEventListener("click", () => WINDOW[b.dataset.win]()));
  el.querySelector(".term-bar").addEventListener("dblclick", (e) => { if (!e.target.closest("[data-win]")) WINDOW.zoom(); }); // as on a Mac title bar
  el.addEventListener("mousedown", (e) => { if (e.target === el) minimise(); });
  open = { closed, restore };

  const print = (html, cls = "") => { const p = document.createElement("div"); p.className = `term-line ${cls}`; p.innerHTML = html; outEl.appendChild(p); outEl.scrollTop = outEl.scrollHeight; return p; };
  const row = (c) => print(`<span class="term-tag ${c.status}">[${TAG[c.status]}]</span> <b>${esc(c.name)}</b> <span class="term-dim">${esc(c.detail)}</span>`);

  async function diagnose() {
    print(`<span class="term-prompt">ngt@portal:~$</span> diag --all`);
    const pending = print(`<span class="term-dim">asking the server<span class="term-wait"></span></span>`);
    const t = performance.now();
    let reason = "the server did not answer. Is it running (npm start)?";
    const report = await fetch("api/diagnostics", { cache: "no-store" }).then((r) => { if (r.ok) return r.json(); if (r.status === 404) reason = "the running server is older than this page and has no system check yet: stop it (Ctrl+C) and run npm start"; else reason = `the server answered with error ${r.status}`; return null; }).catch(() => null);
    const took = Math.round(performance.now() - t);
    pending.remove();
    const checks = report ? report.checks : [{ group: "Services", name: "Data API", status: "fail", detail: `${reason} · PostgreSQL, the cache and the layer data could not be checked` }];
    if (report) checks.unshift({ group: "Services", name: "Data API", status: took > 3000 ? "warn" : "ok", detail: `answered in ${took} ms` });
    checks.push(...(await clientChecks()));
    let group = null;
    for (const c of checks) {
      if (!alive) return null;
      if (c.group !== group) { group = c.group; print(`<span class="term-head">── ${esc(group)} ${"─".repeat(Math.max(4, 58 - group.length))}</span>`); await sleep(auto ? 90 : 60); }
      row(c);
      await sleep(auto ? 110 : 45);
    }
    const n = (st) => checks.filter((c) => c.status === st).length;
    print(`<span class="term-sum ${n("fail") ? "fail" : n("warn") ? "warn" : "ok"}">${n("ok")} passed · ${n("warn")} warning${n("warn") === 1 ? "" : "s"} · ${n("fail")} failed</span> <span class="term-dim">${new Date().toLocaleTimeString()}</span>`);
    return { fail: n("fail"), warn: n("warn") };
  }

  const COMMANDS = {
    help: () => print(`<span class="term-dim">diag</span>    run the health check again<br><span class="term-dim">layers</span>  list the portal's layers<br><span class="term-dim">clear</span>   clear the screen<br><span class="term-dim">exit</span>    close this window (or the red light, or Esc)`),
    diag: diagnose,
    layers: () => { const on = getState().activeLayers; LAYERS.forEach((l) => print(`<span class="term-tag ${on.includes(l.id) ? "ok" : "off"}">[${on.includes(l.id) ? "  ON  " : " off  "}]</span> <b>${esc(l.title)}</b> <span class="term-dim">${esc(l.descriptor)}</span>`)); },
    clear: () => { outEl.innerHTML = ""; },
    exit: close,
  };
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const cmd = input.value.trim().toLowerCase(); input.value = "";
    if (!cmd) return;
    if (cmd !== "diag") print(`<span class="term-prompt">ngt@portal:~$</span> ${esc(cmd)}`);
    await (COMMANDS[cmd.split(/\s+/)[0]] ?? (() => print(`<span class="term-dim">unknown command "${esc(cmd)}": type help</span>`)))();
  });

  (async () => {
    form.hidden = true;
    print(`<span class="term-dim">NGT coastal portal · system check</span>`);
    await sleep(auto ? 350 : 120);
    const result = await diagnose();
    if (!alive) return;
    if (auto) {
      // on page load the window gets out of the way by itself; it lingers when something failed so it can be read
      print(`<span class="term-dim">${result?.fail ? "Something failed: this window minimises in a few seconds. The chip button, bottom right, brings it back." : "All set. Opening the portal…"}</span>`);
      await sleep(result?.fail ? 6500 : 1500);
      if (!alive) return;
      if (result?.fail) { form.hidden = false; minimise(); settle(); } else close(); // a failed check is kept, minimised, so it can be read again
    } else { form.hidden = false; print(`<span class="term-dim">type help for commands</span>`); input.focus(); }
  })();
  return auto ? settled : closed;
}

/** The round chip button at the bottom right of the map. */
export function TerminalButton(root) {
  const b = document.createElement("button");
  b.className = "term-btn";
  b.setAttribute("aria-label", "Open the portal terminal and run a health check");
  b.title = "System check";
  b.innerHTML = CHIP_ICON;
  b.addEventListener("click", () => openTerminal());
  root.appendChild(b);
}
