/** Slide-in / slide-out handles for the left (layers) and right (analysis) panels. */
const KEY = "pakcoast.panels";
const chevron = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg>';

export function PanelToggles(shell, mapArea) {
  let open = { left: true, right: true };
  try { open = { ...open, ...JSON.parse(localStorage.getItem(KEY)) }; } catch {}

  const handles = {};
  const labels = { left: "layers panel", right: "analysis panel" };

  function apply() {
    shell.classList.toggle("left-closed", !open.left);
    shell.classList.toggle("right-closed", !open.right);
    for (const side of ["left", "right"]) {
      const b = handles[side];
      b.setAttribute("aria-expanded", String(open[side]));
      b.setAttribute("aria-label", `${open[side] ? "Hide" : "Show"} ${labels[side]}`);
      b.dataset.tip = `${open[side] ? "Hide" : "Show"} ${labels[side]}`;
    }
    try { localStorage.setItem(KEY, JSON.stringify(open)); } catch {}
    window.dispatchEvent(new Event("panelschange"));
  }

  for (const side of ["left", "right"]) {
    const b = document.createElement("button");
    b.className = `panel-handle ${side}`;
    b.innerHTML = chevron;
    b.addEventListener("click", () => { open[side] = !open[side]; apply(); });
    mapArea.appendChild(b);
    handles[side] = b;
  }
  apply();
}
