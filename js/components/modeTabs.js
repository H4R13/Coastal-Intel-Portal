import { MODES } from "../config/layers.js";
import { getState, subscribe, setMode } from "../state.js";

/** Historical / Normal / Forecast segmented control with a sliding highlight; each tab is a year range. */
export function ModeTabs(root) {
  root.setAttribute("role", "tablist");
  root.setAttribute("aria-label", "Analysis mode");
  root.innerHTML = `${MODES.map((m) => `<button role="tab" class="mode" data-mode="${m.id}" title="${m.from}–${m.to}">${m.label}</button>`).join("")}<span class="mode-ink" aria-hidden="true"></span>`;

  const tabs = [...root.querySelectorAll(".mode")], ink = root.querySelector(".mode-ink");
  tabs.forEach((t) => t.addEventListener("click", () => setMode(t.dataset.mode)));

  function render(s) {
    tabs.forEach((t) => {
      const on = t.dataset.mode === s.mode;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", String(on));
      if (on) { ink.style.width = t.offsetWidth + "px"; ink.style.transform = `translateX(${t.offsetLeft}px)`; }
    });
  }
  subscribe(render);
  render(getState());
  requestAnimationFrame(() => render(getState()));
  document.fonts?.ready.then(() => render(getState()));
  window.addEventListener("resize", () => render(getState()));
  // the panel can slide in after first paint, so re-measure when the control resizes
  new ResizeObserver(() => render(getState())).observe(root);
}
