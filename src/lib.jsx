/** Small pieces shared by the components. */
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * The result of an async loader, redrawn when it arrives: undefined while the first load is running, then the value
 * (null when the data is not available). While a later load runs, the previous value stays on screen.
 */
export function useAsync(load, deps) {
  const [value, setValue] = useState(undefined);
  useEffect(() => {
    let live = true;
    Promise.resolve().then(load).then((v) => live && setValue(v ?? null), () => live && setValue(null));
    return () => { live = false; };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return value;
}

/** An icon given as the inside of a 24×24 SVG (the layer icons in src/config/layers.js are whole SVG strings: use Markup). */
export const Icon = ({ paths, filled = false, width = 1.7 }) => (
  <svg viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke={filled ? undefined : "currentColor"} strokeWidth={filled ? undefined : width}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: paths }} />
);

/** Trusted markup from the portal's own configuration (layer icons, layer descriptions with <b> or <sub>). */
export const Markup = ({ as: Tag = "span", html, ...rest }) => <Tag {...rest} dangerouslySetInnerHTML={{ __html: html }} />;

/* ---- pop-out: show a chart or table full screen, closed with the X, Esc or a click outside ---- */
const PopContext = createContext(null);
/** Opens the full-screen view of the PopBox this is inside; null inside the full-screen copy itself. */
export const usePop = () => useContext(PopContext);

export function PopButton() {
  const open = usePop();
  if (!open) return null;
  return (
    <button className="pop-btn" aria-label="Open full view" title="Open full view" onClick={open}>
      <Icon width={1.8} paths='<path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7"/>' />
    </button>
  );
}

/**
 * A box (chart figure or table tile) that can be opened full screen. The full-screen view draws the same children
 * again, so whatever is chosen in the box (region, measure, chart or table) is the same in both.
 */
export function PopBox({ as: Tag = "figure", children, ...rest }) {
  const [open, setOpen] = useState(false), [color, setColor] = useState("");
  const box = useRef(null), dialog = useRef(null);
  useEffect(() => { if (open) dialog.current?.showModal(); }, [open]);
  const show = () => { setColor(getComputedStyle(box.current).getPropertyValue("--layer")); setOpen(true); };
  return (
    <PopContext.Provider value={show}>
      <Tag ref={box} {...rest}>{children}</Tag>
      {open && createPortal(
        <dialog className="chart-pop" ref={dialog} onClose={() => setOpen(false)} onClick={(e) => e.target === dialog.current && dialog.current.close()}>
          <button className="pop-close" aria-label="Close full view" title="Close" onClick={() => dialog.current.close()}>✕</button>
          <div className="pop-body"><div style={{ "--layer": color }}>
            <PopContext.Provider value={null}><Tag {...rest}>{children}</Tag></PopContext.Provider>
          </div></div>
        </dialog>, document.body)}
    </PopContext.Provider>
  );
}
