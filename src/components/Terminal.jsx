/**
 * The portal's terminal: a command-line window over the map that runs a health check of the portal and prints the
 * result line by line. It opens from the memory-chip button at the bottom right, and once by itself when the page
 * loads (after the intro), where it closes again when the check has finished.
 *   openTerminal({ auto })   auto = true: run the check, then close; resolves when the window has closed
 *   <Terminal />             the window (mounted once in App);  <TerminalButton />  the chip button on the map
 * The server half of the check is server/diagnostics.mjs (GET api/diagnostics); the browser half is clientChecks below.
 * Typing works when it was opened by hand: help, diag, layers, clear, exit.
 * The window is handled the macOS way, with the three lights at the top left: red closes, yellow minimises it into
 * the chip button (which brings it back), green fills the screen and back.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import maplibregl from "maplibre-gl";
import { LAYERS } from "../config/layers.js";
import { getState } from "../state.js";
import { Icon } from "../lib.jsx";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TAG = { ok: "  OK  ", warn: " WARN ", fail: " FAIL " };
const CHIP = '<rect x="2.5" y="7" width="19" height="9" rx="1.5"/><path d="M6 10v3M9.5 10v3M14.5 10v3M18 10v3M12 16v1.5M5 16v2.5M8 16v2.5M16 16v2.5M19 16v2.5"/>';
const PROMPT = "ngt@portal:~$";

/** Checks only the browser can make: the map, the page and what it has loaded. */
async function clientChecks() {
  const out = [], add = (name, status, detail) => out.push({ group: "This browser", name, status, detail });
  const map = window.__map, gl = map?.getCanvas().getContext("webgl2") ?? map?.getCanvas().getContext("webgl");
  add("Map engine", map ? "ok" : "fail", map ? `MapLibre ${maplibregl.getVersion?.() ?? ""} · ${gl ? "graphics running" : "no graphics context"} · zoom ${map.getZoom().toFixed(1)}` : "the map did not start");
  const sw = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration().catch(() => null) : null;
  add("Tile cache in the browser", sw?.active ? "ok" : "warn", sw?.active ? "service worker active: basemap tiles are kept between visits" : "not active yet: it starts on the next reload");
  const nav = performance.getEntriesByType("navigation")[0], mem = performance.memory;
  add("Page", "ok", `${performance.getEntriesByType("resource").length} files loaded${nav ? ` · ready in ${(nav.domContentLoadedEventEnd / 1000).toFixed(1)} s` : ""}${mem ? ` · ${Math.round(mem.usedJSHeapSize / 1048576)} MB of browser memory` : ""} · screen ${window.innerWidth}×${window.innerHeight}`);
  const s = getState();
  add("Layers on the map", "ok", s.activeLayers.length ? s.activeLayers.map((id) => LAYERS.find((l) => l.id === id)?.title).join(", ") : "none switched on");
  return out;
}

/* ---- the one terminal session, shared by the window and the chip button ---- */
let session = null; // { id, auto, min, closed, settled, done, settle, restore } while the window is on screen
let nextId = 0;
const watchers = new Set();
const changed = () => { session = session && { ...session }; watchers.forEach((fn) => fn()); };
const useSession = () => useSyncExternalStore((fn) => (watchers.add(fn), () => watchers.delete(fn)), () => session);

export function openTerminal({ auto = false } = {}) {
  if (session) { session.min = false; changed(); return session.closed; }
  let done, settle;
  const closed = new Promise((r) => (done = r)), settled = new Promise((r) => (settle = r)); // settled: closed, or put away after the automatic check
  session = { id: ++nextId, auto, min: false, closed, done, settle };
  changed();
  return auto ? settled : closed;
}
const setMin = (min) => { if (session) { session.min = min; changed(); } };
const endSession = () => { const s = session; session = null; changed(); s?.done(); s?.settle(); };

/* One printed line. Kinds: prompt (a typed command), dim, wait, head (group rule), row (one check), layer, sum, help. */
function Line({ line }) {
  const k = line.kind;
  if (k === "prompt") return <div className="term-line"><span className="term-prompt">{PROMPT}</span> {line.text}</div>;
  if (k === "dim") return <div className="term-line"><span className="term-dim">{line.text}</span></div>;
  if (k === "wait") return <div className="term-line"><span className="term-dim">{line.text}<span className="term-wait" /></span></div>;
  if (k === "head") return <div className="term-line"><span className="term-head">── {line.text} {"─".repeat(Math.max(4, 58 - line.text.length))}</span></div>;
  if (k === "row") return <div className="term-line"><span className={`term-tag ${line.c.status}`}>[{TAG[line.c.status]}]</span> <b>{line.c.name}</b> <span className="term-dim">{line.c.detail}</span></div>;
  if (k === "layer") return <div className="term-line"><span className={`term-tag ${line.on ? "ok" : "off"}`}>[{line.on ? "  ON  " : " off  "}]</span> <b>{line.title}</b> <span className="term-dim">{line.text}</span></div>;
  if (k === "sum") return <div className="term-line"><span className={`term-sum ${line.fail ? "fail" : line.warn ? "warn" : "ok"}`}>{line.ok} passed · {line.warn} warning{line.warn === 1 ? "" : "s"} · {line.fail} failed</span> <span className="term-dim">{line.time}</span></div>;
  return (
    <div className="term-line">
      <span className="term-dim">diag</span>    run the health check again<br /><span className="term-dim">layers</span>  list the portal's layers<br />
      <span className="term-dim">clear</span>   clear the screen<br /><span className="term-dim">exit</span>    close this window (or the red light, or Esc)
    </div>
  );
}

function Window({ auto, min }) {
  const [lines, setLines] = useState([]), [typing, setTyping] = useState(false), [zoomed, setZoomed] = useState(false), [leaving, setLeaving] = useState(false);
  const alive = useRef(true), out = useRef(null), input = useRef(null), seq = useRef(0);
  const print = (line) => { const id = ++seq.current; setLines((all) => [...all, { ...line, id }]); return id; };
  const close = () => { if (!alive.current) return; alive.current = false; setLeaving(true); setTimeout(endSession, 260); };

  async function diagnose() {
    print({ kind: "prompt", text: "diag --all" });
    const pending = print({ kind: "wait", text: "asking the server" });
    const t = performance.now();
    let reason = "the server did not answer. Is it running (npm start)?";
    const report = await fetch("api/diagnostics", { cache: "no-store" }).then((r) => { if (r.ok) return r.json(); if (r.status === 404) reason = "the running server is older than this page and has no system check yet: stop it (Ctrl+C) and run npm start"; else reason = `the server answered with error ${r.status}`; return null; }).catch(() => null);
    const took = Math.round(performance.now() - t);
    setLines((all) => all.filter((l) => l.id !== pending));
    const checks = report ? report.checks : [{ group: "Services", name: "Data API", status: "fail", detail: `${reason} · PostgreSQL, the cache and the layer data could not be checked` }];
    if (report) checks.unshift({ group: "Services", name: "Data API", status: took > 3000 ? "warn" : "ok", detail: `answered in ${took} ms` });
    checks.push(...(await clientChecks()));
    let group = null;
    for (const c of checks) {
      if (!alive.current) return null;
      if (c.group !== group) { group = c.group; print({ kind: "head", text: group }); await sleep(auto ? 90 : 60); }
      print({ kind: "row", c });
      await sleep(auto ? 110 : 45);
    }
    const n = (st) => checks.filter((c) => c.status === st).length;
    print({ kind: "sum", ok: n("ok"), warn: n("warn"), fail: n("fail"), time: new Date().toLocaleTimeString() });
    return { fail: n("fail"), warn: n("warn") };
  }

  const COMMANDS = {
    help: () => print({ kind: "help" }),
    diag: diagnose,
    layers: () => { const on = getState().activeLayers; LAYERS.forEach((l) => print({ kind: "layer", on: on.includes(l.id), title: l.title, text: l.descriptor })); },
    clear: () => setLines([]),
    exit: close,
  };
  const submit = async (e) => {
    e.preventDefault();
    const cmd = input.current.value.trim().toLowerCase(); input.current.value = "";
    if (!cmd) return;
    if (cmd !== "diag") print({ kind: "prompt", text: cmd });
    await (COMMANDS[cmd.split(/\s+/)[0]] ?? (() => print({ kind: "dim", text: `unknown command "${cmd}": type help` })))();
  };

  useEffect(() => { // the check runs once, when the window opens
    (async () => {
      print({ kind: "dim", text: "NGT coastal portal · system check" });
      await sleep(auto ? 350 : 120);
      const result = await diagnose();
      if (!alive.current) return;
      if (auto) {
        // on page load the window gets out of the way by itself; it lingers when something failed so it can be read
        print({ kind: "dim", text: result?.fail ? "Something failed: this window minimises in a few seconds. The chip button, bottom right, brings it back." : "All set. Opening the portal…" });
        await sleep(result?.fail ? 6500 : 1500);
        if (!alive.current) return;
        if (result?.fail) { setTyping(true); setMin(true); session?.settle(); } else close(); // a failed check is kept, minimised, so it can be read again
      } else { setTyping(true); print({ kind: "dim", text: "type help for commands" }); }
    })();
    return () => { alive.current = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (out.current) out.current.scrollTop = out.current.scrollHeight; }, [lines]);
  useEffect(() => { if (typing && !min) input.current?.focus(); }, [typing, min]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !min) close(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [min]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`term ${min ? "min" : ""} ${zoomed ? "zoomed" : ""} ${leaving ? "leaving" : ""}`} onMouseDown={(e) => { if (e.target === e.currentTarget) setMin(true); }}>
      <div className="term-win" role="dialog" aria-label="Portal terminal">
        <div className="term-bar" onDoubleClick={(e) => { if (!e.target.closest("button")) setZoomed(!zoomed); }}>{/* as on a Mac title bar */}
          <span className="term-lights">
            <button className="red" aria-label="Close" title="Close (Esc)" onClick={close} />
            <button className="yellow" aria-label="Minimise" title="Minimise" onClick={() => setMin(true)} />
            <button className="green" aria-label="Full screen" title="Full screen" onClick={() => setZoomed(!zoomed)} />
          </span>
          <b>ngt@coastal-portal — diagnostics</b><span className="term-lights-pad" />
        </div>
        <div className="term-out" aria-live="polite" ref={out}>{lines.map((l) => <Line key={l.id} line={l} />)}</div>
        <form className="term-in" autoComplete="off" hidden={!typing} onSubmit={submit}><span>{PROMPT}</span><input type="text" spellCheck="false" aria-label="Command" ref={input} /></form>
      </div>
    </div>
  );
}

/** The terminal window, when one is open. Mounted once, in App. */
export function Terminal() {
  const s = useSession();
  return s ? createPortal(<Window key={s.id} auto={s.auto} min={s.min} />, document.body) : null;
}

/** The round chip button at the bottom right of the map. */
export function TerminalButton() {
  const s = useSession();
  return (
    <button className={`term-btn ${s?.min ? "has-min" : ""}`} aria-label="Open the portal terminal and run a health check" title="System check" onClick={() => openTerminal()}>
      <Icon width={1.6} paths={CHIP} />
    </button>
  );
}
