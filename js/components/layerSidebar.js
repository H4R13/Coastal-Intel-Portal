import { LAYERS } from "../config/layers.js";
import { getState, subscribe, selectLayer, toggleLayer } from "../state.js";

/**
 * Magnifying dock (vertical). Vanilla port of the framer-motion "Dock":
 * each item grows toward the cursor with a triangular falloff, animated by the same spring
 * (mass 0.1, stiffness 150, damping 12). Labels appear as tooltips beside the hovered item.
 * Below 1100px the dock degrades to a plain scrollable row of icon + name chips.
 */
const BASE = 46;
const MAGNIFICATION = 72;
const DISTANCE = 120;
const SPRING = { mass: 0.1, stiffness: 150, damping: 12 };
const isWide = () => window.matchMedia("(min-width: 1101px)").matches;

export function LayerSidebar(root) {
  root.innerHTML = `
    <div class="side-head">
      <h2 class="side-title"><span class="t-long">Environmental </span>layers</h2>
      <button class="toggle-mobile" id="layerToggle" aria-expanded="true" aria-controls="layerList">Layers</button>
    </div>
    <div class="dock-wrap" id="layerList">
      <div class="dock" role="toolbar" aria-label="Environmental layers">
        ${LAYERS.map((l) => `
          <button class="dock-item" data-id="${l.id}" data-tip-title="${l.title}" data-tip-desc="${l.descriptor}" style="--layer:${l.color}" aria-pressed="false" aria-label="${l.title}">
            <span class="dock-icon">${l.icon}</span>
            <span class="dock-name">${l.title}</span>
            <span class="dock-check" aria-hidden="true"></span>
          </button>`).join("")}
      </div>
    </div>
    <div class="layer-toggles" role="group" aria-label="Layers shown on the map">
      <span class="lt-cap">On map</span>
      ${LAYERS.map((l) => `
        <label class="lt" data-id="${l.id}" data-tip-title="${l.title}" data-tip-desc="Show this layer on the map" style="--layer:${l.color}">
          <span class="lt-icon">${l.icon}</span>
          <input type="checkbox" aria-label="Show ${l.title} on the map" />
          <span class="switch"></span>
          <span class="lt-name">${l.title}</span>
        </label>`).join("")}
    </div>`;

  /* icons open a layer's panel; the toggles below decide what is drawn on the map */
  const items = [...root.querySelectorAll(".dock-item")];
  const icons = items.map((b) => b.querySelector(".dock-icon"));
  items.forEach((b) => b.addEventListener("click", () => { selectLayer(b.dataset.id); window.dispatchEvent(new CustomEvent("layerfocus", { detail: b.dataset.id })); }));
  const toggles = [...root.querySelectorAll(".lt")];
  toggles.forEach((t) => t.querySelector("input").addEventListener("change", (e) => toggleLayer(t.dataset.id, e.target.checked)));

  const toggle = root.querySelector("#layerToggle"), list = root.querySelector("#layerList");
  if (window.matchMedia("(max-width: 700px)").matches) {
    list.classList.add("collapsed");
    toggle.setAttribute("aria-expanded", "false");
  }
  toggle.addEventListener("click", () => {
    const open = list.classList.toggle("collapsed") === false;
    toggle.setAttribute("aria-expanded", String(open));
  });

  /* ---- tooltip (fixed-position so the sidebar's overflow can't clip it) ---- */
  const tip = document.createElement("div");
  tip.className = "dock-tip";
  tip.setAttribute("role", "tooltip");
  document.body.appendChild(tip);
  let tipTarget = null;

  function placeTip() {
    if (!tipTarget) return;
    const r = tipTarget.getBoundingClientRect();
    tip.style.left = `${r.right + 14}px`;
    tip.style.top = `${r.top + r.height / 2}px`;
  }
  function showTip(el) {
    if (!isWide()) return;
    tipTarget = el;
    tip.innerHTML = `<b>${el.dataset.tipTitle}</b><span>${el.dataset.tipDesc}</span>`;
    placeTip();
    tip.classList.add("show");
    kick();
  }
  function hideTip(el) {
    if (tipTarget !== el) return;
    tipTarget = null;
    tip.classList.remove("show");
  }
  [...items, ...toggles].forEach((el) => {
    el.addEventListener("mouseenter", () => showTip(el));
    el.addEventListener("mouseleave", () => hideTip(el));
    el.addEventListener("focusin", () => showTip(el));
    el.addEventListener("focusout", () => hideTip(el));
  });

  /* ---- magnification: spring per item, driven by cursor Y ---- */
  const dock = root.querySelector(".dock");
  const sim = items.map(() => ({ size: BASE, vel: 0 }));
  let mouseY = Infinity, raf = 0, last = 0;

  const tri = (d) => (Math.abs(d) >= DISTANCE ? BASE : BASE + (MAGNIFICATION - BASE) * (1 - Math.abs(d) / DISTANCE));

  function frame(now) {
    raf = 0;
    if (!isWide()) { reset(); return; }
    const dt = Math.min((now - last) / 1000 || 0.016, 0.032);
    last = now;
    let moving = false;
    items.forEach((el, i) => {
      const s = sim[i];
      let target = BASE;
      if (mouseY !== Infinity) {
        const r = el.getBoundingClientRect();
        target = tri(mouseY - (r.top + r.height / 2));
      }
      for (let k = 0; k < 4; k++) { // sub-steps keep the underdamped spring stable
        const h = dt / 4;
        const a = (SPRING.stiffness * (target - s.size) - SPRING.damping * s.vel) / SPRING.mass;
        s.vel += a * h;
        s.size += s.vel * h;
      }
      if (Math.abs(target - s.size) > 0.15 || Math.abs(s.vel) > 0.5) moving = true; else { s.size = target; s.vel = 0; }
      el.style.width = el.style.height = `${s.size}px`;
      icons[i].style.width = `${s.size / 2}px`;
    });
    placeTip();
    if (moving || mouseY !== Infinity) raf = requestAnimationFrame(frame);
  }
  function kick() {
    if (!raf && isWide()) { last = performance.now(); raf = requestAnimationFrame(frame); }
  }
  function reset() {
    items.forEach((el, i) => { el.style.width = el.style.height = ""; icons[i].style.width = ""; sim[i] = { size: BASE, vel: 0 }; });
  }

  dock.addEventListener("mousemove", (e) => { mouseY = e.clientY; kick(); });
  dock.addEventListener("mouseleave", () => { mouseY = Infinity; kick(); });
  window.matchMedia("(min-width: 1101px)").addEventListener("change", () => { reset(); tip.classList.remove("show"); });

  /* ---- selected state ---- */
  function render(s) {
    items.forEach((b) => {
      const open = b.dataset.id === s.primaryLayer;
      b.classList.toggle("active", open);
      b.classList.toggle("on-map", s.activeLayers.includes(b.dataset.id)); // small dot on the icon
      b.setAttribute("aria-pressed", String(open));
    });
    toggles.forEach((t) => (t.querySelector("input").checked = s.activeLayers.includes(t.dataset.id)));
  }
  subscribe(render);
  render(getState());
}
