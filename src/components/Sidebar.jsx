/**
 * The left sidebar: the magnifying dock of layer icons, the "On map" toggles and the assistant button.
 * Dock: each item grows toward the cursor with a triangular falloff, animated by a spring (mass 0.1, stiffness 150,
 * damping 12), as in the framer-motion "Dock". The sizes are set straight on the elements every animation frame, not
 * through React state, so the dock stays smooth. Labels appear as tooltips beside the hovered item.
 * Below 1100px the dock degrades to a plain scrollable row of icon + name chips.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LAYERS } from "../config/layers.js";
import { selectLayer, toggleLayer, focusLayer, useStore } from "../state.js";
import { Markup } from "../lib.jsx";
import { AssistantButton } from "./Assistant.jsx";

const MAX_BASE = 46, MIN_BASE = 28;
const SPRING = { mass: 0.1, stiffness: 150, damping: 12 };
const WIDE = "(min-width: 1101px)";
const isWide = () => window.matchMedia(WIDE).matches;

export function Sidebar() {
  const primary = useStore((s) => s.primaryLayer), active = useStore((s) => s.activeLayers);
  const [collapsed, setCollapsed] = useState(() => window.matchMedia("(max-width: 700px)").matches);
  const [tip, setTip] = useState(null); // { title, desc } of the hovered item
  const root = useRef(null), tipEl = useRef(null), dock = useRef(null);
  const hover = useRef({ target: null, kick: () => {} });

  useEffect(() => {
    const items = [...dock.current.querySelectorAll(".dock-item")], icons = items.map((b) => b.querySelector(".dock-icon"));
    const n = items.length;
    let base = MAX_BASE, magnification = 72, distance = 120;
    /* The resting size shrinks on short windows so all buttons, the map toggles and the assistant fit the sidebar:
       height taken by everything else (padding, toggles at 27 px a row, assistant) over the dock's height in button
       sizes (n buttons, n - 1 gaps of 0.22, 0.8 of room to magnify). */
    const fit = () => {
      base = Math.max(MIN_BASE, Math.min(MAX_BASE, Math.floor((window.innerHeight - 239 - 27 * n) / (1.22 * n + 0.58))));
      magnification = base * 1.56; distance = base * 2.6;
      root.current.style.setProperty("--dock-size", `${base}px`);
      root.current.style.setProperty("--dock-n", n);
    };
    fit();
    let sim = items.map(() => ({ size: base, vel: 0 }));
    let mouseY = Infinity, raf = 0, last = 0;
    const tri = (d) => (Math.abs(d) >= distance ? base : base + (magnification - base) * (1 - Math.abs(d) / distance));
    const placeTip = () => { // fixed-position so the sidebar's overflow can't clip it
      const el = hover.current.target;
      if (!el || !tipEl.current) return;
      const r = el.getBoundingClientRect();
      tipEl.current.style.left = `${r.right + 14}px`;
      tipEl.current.style.top = `${r.top + r.height / 2}px`;
    };
    const reset = () => { items.forEach((el, i) => { el.style.width = el.style.height = ""; icons[i].style.width = ""; }); sim = items.map(() => ({ size: base, vel: 0 })); };
    function frame(now) {
      raf = 0;
      if (!isWide()) { reset(); return; }
      const dt = Math.min((now - last) / 1000 || 0.016, 0.032);
      last = now;
      let moving = false;
      items.forEach((el, i) => {
        const s = sim[i];
        let target = base;
        if (mouseY !== Infinity) { const r = el.getBoundingClientRect(); target = tri(mouseY - (r.top + r.height / 2)); }
        for (let k = 0; k < 4; k++) { // sub-steps keep the underdamped spring stable
          const h = dt / 4, a = (SPRING.stiffness * (target - s.size) - SPRING.damping * s.vel) / SPRING.mass;
          s.vel += a * h; s.size += s.vel * h;
        }
        if (Math.abs(target - s.size) > 0.15 || Math.abs(s.vel) > 0.5) moving = true; else { s.size = target; s.vel = 0; }
        el.style.width = el.style.height = `${s.size}px`;
        icons[i].style.width = `${s.size / 2}px`;
      });
      placeTip();
      if (moving || mouseY !== Infinity) raf = requestAnimationFrame(frame);
    }
    const kick = () => { if (!raf && isWide()) { last = performance.now(); raf = requestAnimationFrame(frame); } };
    hover.current.kick = () => { placeTip(); kick(); };

    const onMove = (e) => { mouseY = e.clientY; kick(); }, onLeave = () => { mouseY = Infinity; kick(); };
    const onWide = () => { reset(); setTip(null); }, onResize = () => { fit(); reset(); };
    const el = dock.current, media = window.matchMedia(WIDE);
    el.addEventListener("mousemove", onMove); el.addEventListener("mouseleave", onLeave);
    media.addEventListener("change", onWide); window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("mousemove", onMove); el.removeEventListener("mouseleave", onLeave);
      media.removeEventListener("change", onWide); window.removeEventListener("resize", onResize);
    };
  }, []);

  useEffect(() => { hover.current.kick(); }, [tip]); // place the tooltip once it is in the page

  const tipProps = (title, desc) => {
    const show = (e) => { if (!isWide()) return; hover.current.target = e.currentTarget; setTip({ title, desc }); };
    const hide = (e) => { if (hover.current.target !== e.currentTarget) return; hover.current.target = null; setTip(null); };
    return { onMouseEnter: show, onMouseLeave: hide, onFocus: show, onBlur: hide };
  };

  return (
    <aside id="sidebar" className="sidebar" aria-label="Environmental layers" ref={root}>
      <div className="side-head">
        <h2 className="side-title"><span className="t-long">Environmental </span>layers</h2>
        <button className="toggle-mobile" id="layerToggle" aria-expanded={!collapsed} aria-controls="layerList" onClick={() => setCollapsed(!collapsed)}>Layers</button>
      </div>
      {/* icons open a layer's panel; the toggles below decide what is drawn on the map */}
      <div className={`dock-wrap ${collapsed ? "collapsed" : ""}`} id="layerList">
        <div className="dock" role="toolbar" aria-label="Environmental layers" ref={dock}>
          {LAYERS.map((l) => (
            <button key={l.id} className={`dock-item ${l.id === primary ? "active" : ""} ${active.includes(l.id) ? "on-map" : ""}`} data-id={l.id} style={{ "--layer": l.color }}
              aria-pressed={l.id === primary} aria-label={l.title} onClick={() => { selectLayer(l.id); focusLayer(l.id); }} {...tipProps(l.title, l.descriptor)}>
              <Markup className="dock-icon" html={l.icon} />
              <span className="dock-name">{l.title}</span>
              <span className="dock-check" aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>
      <div className="layer-toggles" role="group" aria-label="Layers shown on the map">
        <span className="lt-cap">On map</span>
        {LAYERS.map((l) => (
          <label key={l.id} className="lt" data-id={l.id} style={{ "--layer": l.color }} {...tipProps(l.title, "Show this layer on the map")}>
            <Markup className="lt-icon" html={l.icon} />
            <input type="checkbox" aria-label={`Show ${l.title} on the map`} checked={active.includes(l.id)} onChange={(e) => toggleLayer(l.id, e.target.checked)} />
            <span className="switch" />
            <span className="lt-name">{l.title}</span>
          </label>
        ))}
      </div>
      <AssistantButton />
      {createPortal(<div className={`dock-tip ${tip ? "show" : ""}`} role="tooltip" ref={tipEl}>{tip ? <><b>{tip.title}</b><span>{tip.desc}</span></> : null}</div>, document.body)}
    </aside>
  );
}
