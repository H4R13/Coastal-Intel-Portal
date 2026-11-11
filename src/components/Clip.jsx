/**
 * A short animation in a layer's panel (layer.video: { src, title }). It starts playing on its own and loops; hovering
 * it (or tabbing to it) shows two small buttons: pause / play, and loop on / off. Without the loop it stops at the end,
 * and play then starts it over. Muted, because browsers only start a video by themselves when it has no sound.
 */
import { useRef, useState } from "react";
import { Icon } from "../lib.jsx";

const PLAY = '<path d="M8 5.5v13l11-6.5Z"/>', PAUSE = '<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/>';
const LOOP = '<path d="M17 2.5 20.5 6 17 9.5"/><path d="M3.5 11V9.5A3.5 3.5 0 0 1 7 6h13.5"/><path d="M7 21.5 3.5 18 7 14.5"/><path d="M20.5 13v1.5A3.5 3.5 0 0 1 17 18H3.5"/>';

export function Clip({ video }) {
  const el = useRef(null);
  const [playing, setPlaying] = useState(true), [loop, setLoop] = useState(true);
  const toggle = () => {
    const v = el.current;
    if (v.paused) { if (v.ended) v.currentTime = 0; v.play().catch(() => {}); } else v.pause();
  };
  return (
    <section className="block clip">
      <h3 className="sec-title">{video.title}</h3>
      <div className="clip-frame">
        <video ref={el} src={video.src} autoPlay muted loop={loop} playsInline preload="auto" aria-label={video.title}
          onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onClick={toggle} />
        <div className="clip-ctl" role="group" aria-label="Video controls">
          <button className="clip-btn" aria-label={playing ? "Pause" : "Play"} title={playing ? "Pause" : "Play"} onClick={toggle}><Icon filled paths={playing ? PAUSE : PLAY} /></button>
          <button className="clip-btn" aria-pressed={loop} aria-label="Loop" title={loop ? "Stop looping" : "Loop"} onClick={() => setLoop(!loop)}><Icon width={2} paths={LOOP} /></button>
        </div>
      </div>
    </section>
  );
}
