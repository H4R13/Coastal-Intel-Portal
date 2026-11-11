/**
 * The opening sequence's sound: the start of the opening track (public/media/intro.mp3), always from 0:00.
 *   introSound({ muted })  → { setMuted(on), stop(fadeSeconds) }
 * The sequence is shorter than the track, so stop() fades it out as the portal appears.
 * Browsers only allow sound after a click or key press, which is why the sequence waits behind an "Enter" button.
 */
const TRACK = "media/intro.mp3", LEVEL = 0.85;

export function introSound({ muted = false } = {}) {
  const audio = new Audio(TRACK);
  audio.preload = "auto";
  audio.currentTime = 0;
  audio.volume = muted ? 0 : LEVEL;
  audio.play().catch(() => {}); // blocked or missing: the sequence runs silently
  let fading = 0;

  /** Move the volume to `to` over `seconds` (the element has no ramps of its own). */
  const ramp = (to, seconds, then) => {
    clearInterval(fading);
    const from = audio.volume, started = performance.now(), ms = Math.max(1, seconds * 1000);
    fading = setInterval(() => {
      const k = Math.min(1, (performance.now() - started) / ms);
      audio.volume = from + (to - from) * k;
      if (k === 1) { clearInterval(fading); then?.(); }
    }, 30);
  };

  return {
    setMuted(on) { ramp(on ? 0 : LEVEL, 0.15); },
    stop(fade = 0.4) { ramp(0, fade, () => { audio.pause(); audio.removeAttribute("src"); audio.load(); }); },
  };
}
