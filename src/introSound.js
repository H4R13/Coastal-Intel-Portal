/**
 * The opening sequence's sound, made in the browser (Web Audio): no audio file is loaded.
 *   introSound({ markMs, rushMs, muted })  → { setMuted(on), stop(fadeSeconds) }, or null where there is no Web Audio
 * It follows the picture: a low hum that opens up under "NGT" with one note per letter, a deep hit as the NDMA logo
 * lands, a rising sparkle while the portal's name is spelled out, then a whoosh and a final boom as the name rushes
 * past. markMs is when the name starts, rushMs when it starts to rush (both from the start of the sequence).
 * Browsers only allow sound after a click or key press, which is why the sequence waits behind an "Enter" button.
 */
export function introSound({ markMs, rushMs, muted = false }) {
  const AC = window.AudioContext ?? window.webkitAudioContext;
  if (!AC) return null;
  const ctx = new AC(), t0 = ctx.currentTime + 0.06, LEVEL = 0.85;

  const master = ctx.createGain(); master.gain.value = muted ? 0 : LEVEL;
  const limiter = ctx.createDynamicsCompressor(); limiter.threshold.value = -14; limiter.ratio.value = 6;
  master.connect(limiter); limiter.connect(ctx.destination);
  // a hall: noise that dies away, used as the room's echo
  const hall = ctx.createConvolver(), tail = ctx.createBuffer(2, ctx.sampleRate * 2.8, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const d = tail.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2.6; }
  hall.buffer = tail;
  const wet = ctx.createGain(); wet.gain.value = 0.32; hall.connect(wet); wet.connect(master);
  const bus = ctx.createGain(); bus.connect(master); bus.connect(hall);
  const hiss = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  { const d = hiss.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }

  /** Loudness over time: [[seconds from the start, level], ...], straight lines between the points. */
  const shape = (param, points) => { param.setValueAtTime(points[0][1], t0 + points[0][0]); points.slice(1).forEach(([t, v]) => param.linearRampToValueAtTime(v, t0 + t)); };
  function tone(type, freq, at, length, points, { to, cutoff } = {}) {
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, t0 + at);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + at + length * 0.9);
    gain.gain.value = 0; shape(gain.gain, points.map(([t, v]) => [at + t, v]));
    let out = osc;
    if (cutoff) { const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.setValueAtTime(cutoff[0], t0 + at); f.frequency.exponentialRampToValueAtTime(cutoff[1], t0 + at + length); osc.connect(f); out = f; }
    out.connect(gain); gain.connect(bus);
    osc.start(t0 + at); osc.stop(t0 + at + length + 0.1);
  }
  function rush(at, length, band, points) { // filtered noise sweeping across the given frequency band
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), gain = ctx.createGain();
    src.buffer = hiss; src.loop = true; f.type = "bandpass"; f.Q.value = 0.9;
    f.frequency.setValueAtTime(band[0], t0 + at); f.frequency.exponentialRampToValueAtTime(band[1], t0 + at + length);
    gain.gain.value = 0; shape(gain.gain, points.map(([t, v]) => [at + t, v]));
    src.connect(f); f.connect(gain); gain.connect(bus);
    src.start(t0 + at); src.stop(t0 + at + length + 0.1);
  }
  const boom = (at, level) => { tone("sine", 110, at, 1.9, [[0, 0], [0.02, level], [1.8, 0]], { to: 34 }); rush(at, 0.6, [300, 90], [[0, 0], [0.01, level * 0.5], [0.55, 0]]); };

  const mark = markMs / 1000, go = rushMs / 1000;
  /* under "NGT": a hum that opens up, one note per letter, a hit as the logo lands, a soft chord */
  [55, 55.4].forEach((f) => tone("sawtooth", f, 0, mark + 0.6, [[0, 0], [1.1, 0.13], [mark - 0.3, 0.13], [mark + 0.5, 0]], { cutoff: [110, 1500] }));
  [[0.05, 220], [0.19, 329.63], [0.33, 440]].forEach(([at, f]) => { tone("sine", f, at, 2, [[0, 0], [0.015, 0.2], [1.9, 0]]); tone("triangle", f * 2, at, 1.2, [[0, 0], [0.01, 0.05], [1.1, 0]]); });
  boom(1.3, 0.75);
  [440, 554.37, 659.25].forEach((f) => tone("triangle", f, 1.3, mark - 0.6, [[0, 0], [1.2, 0.045], [mark - 1.6, 0.045], [mark - 0.7, 0]]));
  /* the name is spelled out: a sparkle climbing with the letters, over a slow rise */
  [440, 523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.5, 1568, 1760, 2093].forEach((f, i) => tone("sine", f, mark + 0.08 + i * 0.085, 0.5, [[0, 0], [0.01, 0.055], [0.45, 0]]));
  tone("sawtooth", 82.4, mark, go - mark + 0.2, [[0, 0], [go - mark, 0.07], [go - mark + 0.15, 0]], { to: 164.8, cutoff: [200, 900] });
  /* the name rushes past: a whoosh, a rising whine, and a last deep hit */
  rush(go, 1.5, [260, 7000], [[0, 0], [0.95, 0.7], [1.45, 0]]);
  tone("sawtooth", 90, go, 1.25, [[0, 0], [1.0, 0.1], [1.2, 0]], { to: 1400, cutoff: [400, 6000] });
  boom(go + 1.0, 0.85);

  return {
    setMuted(on) { master.gain.cancelScheduledValues(ctx.currentTime); master.gain.linearRampToValueAtTime(on ? 0 : LEVEL, ctx.currentTime + 0.15); },
    stop(fade = 0.4) {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
      master.gain.linearRampToValueAtTime(0, ctx.currentTime + fade);
      setTimeout(() => ctx.close().catch(() => {}), fade * 1000 + 150);
    },
  };
}
