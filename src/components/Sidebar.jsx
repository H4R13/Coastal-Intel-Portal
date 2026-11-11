/**
 * The left sidebar: the magnifying dock of layer icons (a click opens a layer and toggles it on the map). Hela's button is
 * beside the legend (src/components/MapView.jsx). With the Ocean or Fisheries layer open (.om-mode on the shell) the dock
 * lies horizontally above the year slider and magnifies along x; its tooltips then sit above the icons.
 * Dock: each item grows toward the cursor with a triangular falloff, animated by a spring (mass 0.1, stiffness 150,
 * damping 12), as in the framer-motion "Dock". The sizes are set straight on the elements every animation frame, not
 * through React state, so the dock stays smooth. Labels appear as tooltips beside the hovered item.
 * Below 1100px the dock degrades to a plain scrollable row of icon + name chips.
 * Layers hidden with the terminal's `hide <layer>` (state.hiddenLayers) are left out.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LAYERS } from "../config/layers.js";
import { pickLayer, focusLayer, useStore } from "../state.js";
import { Markup } from "../lib.jsx";

const MAX_BASE = 46, MIN_BASE = 28;
const SPRING = { mass: 0.1, stiffness: 150, damping: 12 };
const WIDE = "(min-width: 1101px)";
const isWide = () => window.matchMedia(WIDE).matches;

export function Sidebar() {
  const primary = useStore((s) => s.primaryLayer), active = useStore((s) => s.activeLayers), hidden = useStore((s) => s.hiddenLayers);
  const shown = LAYERS.filter((l) => !hidden.includes(l.id));
  const [collapsed, setCollapsed] = useState(() => window.matchMedia("(max-width: 700px)").matches);
  const [tip, setTip] = useState(null); // { title, desc } of the hovered item
  const root = useRef(null), tipEl = useRef(null), dock = useRef(null);
  const hover = useRef({ target: null, kick: () => {} });

  useEffect(() => {
    const items = [...dock.current.querySelectorAll(".dock-item")], icons = items.map((b) => b.querySelector(".dock-icon"));
    const n = items.length;
    let base = MAX_BASE, magnification = 72, distance = 120;
    /* The resting size shrinks on short windows so all buttons and the assistant fit the sidebar: height taken by
       everything else (padding, assistant) over the dock's height in button sizes (n buttons, n - 1 gaps of 0.22,
       0.8 of room to magnify). */
    const fit = () => {
      base = Math.max(MIN_BASE, Math.min(MAX_BASE, Math.floor((window.innerHeight - 194) / (1.22 * n + 0.58))));
      magnification = base * 1.56; distance = base * 2.6;
      root.current.style.setProperty("--dock-size", `${base}px`);
      root.current.style.setProperty("--dock-n", n);
    };
    fit();
    let sim = items.map(() => ({ size: base, vel: 0 }));
    let mouseX = Infinity, mouseY = Infinity, raf = 0, last = 0;
    const flat = () => !!root.current?.closest(".om-mode"); // horizontal, above the ocean year slider
    const tri = (d) => (Math.abs(d) >= distance ? base : base + (magnification - base) * (1 - Math.abs(d) / distance));
    const placeTip = () => { // fixed-position so the sidebar's overflow can't clip it
      const el = hover.current.target;
      if (!el || !tipEl.current) return;
      const r = el.getBoundingClientRect();
      tipEl.current.classList.toggle("above", flat());
      tipEl.current.style.left = flat() ? `${r.left + r.width / 2}px` : `${r.right + 14}px`;
      tipEl.current.style.top = flat() ? `${r.top - 12}px` : `${r.top + r.height / 2}px`;
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
        if (mouseY !== Infinity) { const r = el.getBoundingClientRect(); target = tri(flat() ? mouseX - (r.left + r.width / 2) : mouseY - (r.top + r.height / 2)); }
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

    const onMove = (e) => { mouseX = e.clientX; mouseY = e.clientY; kick(); }, onLeave = () => { mouseX = mouseY = Infinity; kick(); };
    const onWide = () => { reset(); setTip(null); }, onResize = () => { fit(); reset(); };
    const el = dock.current, media = window.matchMedia(WIDE);
    el.addEventListener("mousemove", onMove); el.addEventListener("mouseleave", onLeave);
    media.addEventListener("change", onWide); window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("mousemove", onMove); el.removeEventListener("mouseleave", onLeave);
      media.removeEventListener("change", onWide); window.removeEventListener("resize", onResize);
    };
  }, [hidden]); // a layer hidden or shown again: measure the new set of buttons

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
      {/* a tile opens its layer and puts it on the map; the open one, clicked again, comes off (pickLayer in state.js) */}
      <div className={`dock-wrap ${collapsed ? "collapsed" : ""}`} id="layerList">
        <div className="dock" role="toolbar" aria-label="Environmental layers" ref={dock}>
          {shown.map((l) => (
            <button key={l.id} className={`dock-item ${l.id === primary ? "active" : ""} ${active.includes(l.id) ? "on-map" : ""}`} data-id={l.id} style={{ "--layer": l.color }}
              aria-pressed={active.includes(l.id)} aria-label={`${l.title}${active.includes(l.id) ? ", on the map" : ""}`} onClick={() => { if (pickLayer(l.id)) focusLayer(l.id); }} {...tipProps(l.title, l.descriptor)}>
              <Markup className="dock-icon" html={l.icon} />
              <span className="dock-name">{l.title}</span>
              <span className="dock-check" aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>
      <span className="side-spacer" aria-hidden="true" />
      {createPortal(<div className={`dock-tip ${tip ? "show" : ""}`} role="tooltip" ref={tipEl}>{tip ? <><b>{tip.title}</b><span>{tip.desc}</span></> : null}</div>, document.body)}
    </aside>
  );
}
