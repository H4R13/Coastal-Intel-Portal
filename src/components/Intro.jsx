/**
 * Opening sequence, shown on every page load (owner's reference: a logo ident, 2026-11-20). It starts by itself (the
 * "Enter" button that let the sound play is switched off for now, see Intro below). A P mark (the stem and the bowl are two
 * separate rounded slabs) goes through the ident's looks, all drawn on one canvas:
 *   glass in a beam of light → swallowed by purple smoke → rebuilt from a stream of dots over a dot grid and fine lines →
 *   turns into view in ribbed chrome → a lavender ribbon → cut to flat white on black. The P then slides left and
 *   C, O and P slide out from behind it: PCOP. The overlay fades and the system check follows (App.jsx).
 * Sound: the start of the opening track (introSound.js). Once it is running, any key or click skips it; the speaker
 * button turns the sound off (remembered for next time). Esc (on the Enter screen too) skips everything: the sequence,
 * the system check, Hela's start-up warnings and the showcase that follows them.
 *   <Intro onDone />   onDone({ skipAll }) is called when the sequence is over and the overlay has faded
 *   skipsIntro()       true when it is not shown at all (?nointro, or the visitor prefers reduced motion)
 */
import { useEffect, useRef, useState } from "react";
import { introSound } from "../introSound.js";
import { Icon } from "../lib.jsx";

const TITLE = "PCOP";
const MUTED_KEY = "introMuted";
const SPEAKER = '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/>', ON = '<path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.8 7.8 0 0 1 0 11"/>', OFF = '<path d="m16 9.5 5 5M21 9.5l-5 5"/>';
const OUT_MS = 600; // the overlay's fade, as in styles.css (.intro)

/** When each look starts, in seconds from Enter; END is when the overlay starts to fade. */
const AT = { smoke: 1.9, dots: 3.4, chrome: 5.6, ribbon: 6.8, flat: 7.8, slide: 8.5, name: 9.8, credit: 10.4, shine: 10.9, end: 12.6 };
const NAME = "Pakistan Coastal Observation & Projection", CREDIT = ["Powered by ", "NDMA"], BADGE = "NGT";

// The P mark in a 107 x 140 box: a rounded stem, a gap, and a bowl open towards the stem (like the reference's slabs)
const MW = 107, MH = 140;
const STEM = "M9 0H21Q30 0 30 9V131Q30 140 21 140H9Q0 140 0 131V9Q0 0 9 0Z";
const BOWL = "M44 0H64A43 43 0 0 1 64 86H44Q38 86 38 80V64Q38 58 44 58H64A15 15 0 0 0 64 28H44Q38 28 38 22V6Q38 0 44 0Z";
const LETTERS = ["C", "O", "P"];
const BADGE_SIZE = 0.032, BADGE_MARGIN = 0.05; // NGT box: its letter size and its distance from the screen's top right corner, as shares of the screen's shorter side
const FONT = "Manrope";

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const span = (t, a, b) => clamp01((t - a) / (b - a));
const easeOut = (x) => 1 - (1 - x) ** 3;
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const lerp = (a, b, k) => a + (b - a) * k;
const seeded = (seed) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

/** A soft round puff of one colour, drawn once and stamped many times for the smoke. */
function puffSprite(rgb) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d"), r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, `rgba(${rgb},0.85)`); r.addColorStop(0.45, `rgba(${rgb},0.32)`); r.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  return c;
}

/** Plays the sequence on `cv`; calls onEnd at AT.end (the last frame stays on the canvas). Returns a stop function. */
function play(cv, onEnd) {
  const g = cv.getContext("2d");
  const mark = new Path2D(STEM + BOWL), probe = document.createElement("canvas").getContext("2d");
  const inMark = (u, v) => probe.isPointInPath(mark, u, v);
  const sprites = ["124,58,255", "182,76,255", "214,180,255", "92,40,200"].map(puffSprite);
  let W, H, dpr, s, sEnd, cx, cy, dots, field, puffs, lines, word;

  const fit = () => {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = cv.width = Math.round(window.innerWidth * dpr);
    H = cv.height = Math.round(window.innerHeight * dpr);
    // screen pixels per mark unit: through the looks the mark fills about 38 % of the height; for the closing word it
    // shrinks to `sEnd` (owner, 2026-11-20: the closing text was too big), small enough that PCOP + the NGT box beside
    // it take at most 46 % of the width
    s = Math.min((H * 0.38) / MH, (W * 0.2) / MW);
    g.font = `700 100px ${FONT}`;
    const cap = g.measureText("P").actualBoundingBoxAscent || 72, perS = (MH * 100) / cap; // font size per unit of s
    const wordPerS = MW + 16 + LETTERS.reduce((a, ch) => a + g.measureText(ch).width / 100 * perS, 0) + perS * 0.03 * (LETTERS.length - 1);
    sEnd = Math.min(s * 0.62, (W * 0.46) / wordPerS);
    cx = W / 2; cy = H / 2;
    build();
  };
  const toScreen = (u, v, dx = 0) => [cx - (MW * s) / 2 + dx + u * s, cy - (MH * s) / 2 + v * s];

  /** Everything that depends on the screen size: the dots, the grid, the smoke, the lines and the word's layout. */
  function build() {
    const rnd = seeded(20261120);
    // dots that stream in and settle on the mark, sweeping left to right
    dots = [];
    const step = (7 * dpr) / s;
    for (let v = step / 2; v < MH; v += step) for (let u = step / 2; u < MW; u += step) {
      if (!inMark(u, v)) continue;
      const [tx, ty] = toScreen(u, v), a = rnd() * Math.PI * 2, d = (250 + rnd() * 650) * dpr, k = rnd();
      dots.push({ tx, ty, sx: tx + Math.cos(a) * d, sy: ty + Math.sin(a) * d * 0.6, at: AT.dots + 0.1 + (u / MW) * 0.9 + rnd() * 0.45,
        c: k < 0.7 ? "#e4e9f0" : k < 0.8 ? "#7ff0d0" : k < 0.9 ? "#8ab4ff" : "#c39bff" });
    }
    // the dot grid around the mark, brightest close to it
    field = [];
    const fs = 9 * dpr, R = MW * s * 1.25;
    for (let y = cy - MH * s; y < cy + MH * s; y += fs) for (let x = cx - MW * s * 1.6; x < cx + MW * s * 1.6; x += fs) {
      const d = Math.hypot(x - cx, (y - cy) * 0.8), a = 1 - d / R;
      if (a > 0.02) field.push({ x, y, a: a * 0.55, p: rnd() * 6.28 });
    }
    // smoke puffs, born inside the mark and drifting up and out
    puffs = [];
    for (let i = 0; i < 120; i++) {
      let u, v;
      do { u = rnd() * MW; v = rnd() * MH; } while (!inMark(u, v));
      const [ox, oy] = toScreen(u, v), out = Math.atan2(oy - cy, ox - cx), sp = (40 + rnd() * 140) * dpr;
      puffs.push({ ox, oy, vx: Math.cos(out) * sp - 50 * dpr, vy: Math.sin(out) * sp * 0.6 - (40 + rnd() * 90) * dpr,
        born: AT.smoke - 0.25 + rnd() * 1.1, life: 1.5 + rnd() * 1.0, r: (10 + rnd() * 14) * s, grow: 2.5 + rnd() * 3.5,
        spr: sprites[i % sprites.length], w: rnd() * 6.28 });
    }
    // fine lines across the screen, through points near the mark
    lines = Array.from({ length: 38 }, () => ({ x: cx + (rnd() - 0.5) * MW * s, y: cy + (rnd() - 0.5) * MH * s, a: rnd() * Math.PI,
      turn: (rnd() - 0.5) * 0.18, c: rnd() < 0.5 ? "120,240,210" : "220,230,255", o: 0.05 + rnd() * 0.1 }));
    // the word: the mark is the first P, then C, O, P in the portal's font with the mark's height as cap height
    g.font = `700 100px ${FONT}`;
    const cap = g.measureText("P").actualBoundingBoxAscent || 72, se = sEnd, size = (MH * se * 100) / cap;
    g.font = `700 ${size}px ${FONT}`;
    const gapMark = 16 * se, track = size * 0.03, widths = LETTERS.map((ch) => g.measureText(ch).width);
    const total = MW * se + gapMark + widths.reduce((a, b) => a + b, 0) + track * (LETTERS.length - 1);
    // NGT in a white box in the top right corner of the screen (owner, 2026-11-20: of the whole frame, not of the word)
    const badgeSize = Math.max(14 * dpr, Math.min(W, H) * BADGE_SIZE), margin = Math.min(W, H) * BADGE_MARGIN;
    g.font = `700 ${badgeSize}px ${FONT}`;
    const badgeW = g.measureText(BADGE).width + 3 * badgeSize * 0.12 + 2 * badgeSize * 0.42;
    const left = cx - total / 2;
    let x = left + MW * se + gapMark;
    const finals = widths.map((w) => { const at = x; x += w + track; return at; });
    // under the word: the portal's name, then the credit
    const nameSize = Math.min(size * 0.15, (W * 0.9) / 26), creditSize = nameSize * 0.78;
    const lift = (nameSize * 1.9 + creditSize * 1.6) / 2; // the whole group moves up so that it stays centred
    word = { size, left, mid: left + total / 2, widths, finals, right: left + total, nameSize, creditSize, badgeSize, badgeX: W - margin - badgeW, badgeY: margin, lift };
  }

  /** Puts the mark's own units on screen: `sx` squeezes it sideways, as if turned about its upright axis. */
  const place = (dx = 0, sx = 1, dy = 0) => g.setTransform(s * sx, 0, 0, s, cx - (MW * s * sx) / 2 + dx, cy - (MH * s) / 2 + dy);

  /** Text with letter spacing where the browser supports it (canvas letterSpacing), centred on x when `mid`. */
  const spaced = (text, x, y, em, mid) => {
    if ("letterSpacing" in g) g.letterSpacing = `${em}px`;
    const w = g.measureText(text).width;
    g.fillText(text, mid ? x - w / 2 + em / 2 : x, y);
    if ("letterSpacing" in g) g.letterSpacing = "0px";
    return w;
  };

  /** The credit line and the NGT box: they fade up together, then one band of light sweeps across both at once. */
  function credits(t, top, base) {
    const a = easeOut(span(t, AT.credit, AT.credit + 0.6));
    if (a <= 0) return;
    const sh = span(t, AT.shine, AT.shine + 0.9), glow = Math.sin(Math.PI * sh); // the shine, 0 → 1 → 0
    const draw = (paint) => {
      // credit line, centred under the name
      const cs = word.creditSize, y = base + word.nameSize * 1.9 + cs * 1.25;
      g.font = `500 ${cs}px ${FONT}`;
      if ("letterSpacing" in g) g.letterSpacing = `${cs * 0.22}px`;
      const w1 = g.measureText(CREDIT[0].toUpperCase()).width;
      g.font = `800 ${cs}px ${FONT}`;
      const w2 = g.measureText(CREDIT[1]).width;
      let x = word.mid - (w1 + w2) / 2;
      paint(x - cs, y - cs * 1.1, w1 + w2 + cs * 2, cs * 1.6);
      g.font = `500 ${cs}px ${FONT}`; g.fillText(CREDIT[0].toUpperCase(), x, y);
      g.font = `800 ${cs}px ${FONT}`; g.fillText(CREDIT[1], x + w1, y);
      if ("letterSpacing" in g) g.letterSpacing = "0px";
      // NGT box in the screen's top right corner
      const bs = word.badgeSize, pad = bs * 0.42;
      g.font = `700 ${bs}px ${FONT}`;
      const tw = spaced(BADGE, 0, -9999, bs * 0.12), bw = tw + pad * 2, bh = bs * 1.45;
      x = word.badgeX;
      const by = word.badgeY;
      paint(x - bs, by - bs, bw + bs * 2, bh + bs * 2);
      g.lineWidth = Math.max(1.5 * dpr, bs * 0.09);
      g.beginPath(); g.roundRect ? g.roundRect(x, by, bw, bh, bh * 0.22) : g.rect(x, by, bw, bh); g.stroke();
      g.textBaseline = "middle"; spaced(BADGE, x + pad, by + bh / 2 + bs * 0.04, bs * 0.12); g.textBaseline = "alphabetic";
    };
    g.setTransform(1, 0, 0, 1, 0, 0);
    // resting state: soft white
    g.globalAlpha = a * 0.82; g.fillStyle = g.strokeStyle = "#fff";
    g.shadowColor = "rgba(255,255,255,0.9)"; g.shadowBlur = glow * 26 * dpr;
    draw(() => {});
    g.shadowBlur = 0;
    // the band of light: the same text again, lit only inside a bright band; each element (the credit line, the NGT box
    // in the corner) gets its own band crossing it left to right, all at the same moment
    if (glow > 0) {
      g.globalAlpha = a * glow; g.globalCompositeOperation = "lighter";
      g.shadowColor = "rgba(255,255,255,1)"; g.shadowBlur = 18 * dpr;
      draw((x, y, w) => {
        const bx = lerp(x, x + w, sh), half = Math.max(30 * dpr, w * 0.25), band = g.createLinearGradient(bx - half, 0, bx + half, 0);
        band.addColorStop(0, "rgba(255,255,255,0)"); band.addColorStop(0.5, "rgba(255,255,255,1)"); band.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = g.strokeStyle = band;
      });
      g.shadowBlur = 0; g.globalCompositeOperation = "source-over";
    }
    g.globalAlpha = 1;
  }

  function background(t) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
    g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
    const studio = 1 - span(t, AT.smoke - 0.1, AT.smoke + 0.9); // the grey studio light of the first look, giving way to black
    if (studio <= 0) return;
    g.globalAlpha = studio;
    const beam = g.createLinearGradient(0, 0, W * 0.9, H);
    beam.addColorStop(0, "#d6d7da"); beam.addColorStop(0.3, "#9a9ca2"); beam.addColorStop(0.62, "#2b2c31"); beam.addColorStop(1, "#08080a");
    g.fillStyle = beam; g.fillRect(0, 0, W, H);
    const glow = g.createRadialGradient(W * 0.18, H * 0.05, 0, W * 0.18, H * 0.05, W * 0.6);
    glow.addColorStop(0, "rgba(255,255,255,0.55)"); glow.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = glow; g.fillRect(0, 0, W, H);
    g.globalAlpha = 1;
  }

  function glass(t) {
    const a = span(t, 0, 0.7) * (1 - span(t, AT.smoke + 0.25, AT.smoke + 1.2));
    if (a <= 0) return;
    const breathe = 1.05 - 0.05 * easeOut(span(t, 0, AT.smoke));
    g.globalAlpha = a;
    g.setTransform(s * breathe, 0, 0, s * breathe, cx - (MW * s * breathe) / 2, cy - (MH * s * breathe) / 2);
    g.save();
    g.shadowColor = "rgba(0,0,0,0.5)"; g.shadowBlur = 40 * dpr; g.shadowOffsetX = 22 * dpr; g.shadowOffsetY = 26 * dpr;
    const body = g.createLinearGradient(0, 0, MW, MH);
    body.addColorStop(0, "#f6f7f9"); body.addColorStop(0.5, "#c3c8d0"); body.addColorStop(1, "#80868f");
    g.fillStyle = body; g.fill(mark);
    g.restore();
    g.save(); g.clip(mark);
    const k = span(t, 0.2, AT.smoke + 0.6), x0 = lerp(-60, 120, k); // a blue sheen sweeping across the glass
    const sheen = g.createLinearGradient(x0, 0, x0 + 70, 50);
    sheen.addColorStop(0, "rgba(10,40,110,0)"); sheen.addColorStop(0.45, "rgba(18,90,200,0.85)"); sheen.addColorStop(0.6, "rgba(60,200,255,0.9)"); sheen.addColorStop(1, "rgba(10,40,110,0)");
    g.fillStyle = sheen; g.fillRect(-10, -10, MW + 20, MH + 20);
    const smoke = span(t, AT.smoke, AT.smoke + 0.7) * 0.7; // tinted violet as the smoke takes it
    if (smoke > 0) { g.globalAlpha = a * smoke; g.fillStyle = "#7a3cff"; g.fillRect(-10, -10, MW + 20, MH + 20); }
    g.restore();
    g.globalAlpha = a * 0.8; g.lineWidth = (1.2 * dpr) / s; g.strokeStyle = "#fff"; g.stroke(mark);
    g.globalAlpha = 1;
  }

  function smoke(t) {
    if (t < AT.smoke - 0.3 || t > AT.dots + 1.4) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = "lighter";
    for (const p of puffs) {
      const age = t - p.born;
      if (age < 0 || age > p.life) continue;
      const k = age / p.life, r = p.r * (1 + p.grow * easeOut(k));
      const x = p.ox + p.vx * age + Math.sin(age * 1.6 + p.w) * 30 * dpr, y = p.oy + p.vy * age + Math.cos(age * 1.3 + p.w) * 18 * dpr;
      g.globalAlpha = Math.sin(Math.PI * k) * 0.5;
      g.drawImage(p.spr, x - r, y - r, r * 2, r * 2);
    }
    g.globalCompositeOperation = "source-over"; g.globalAlpha = 1;
  }

  function dotsAndGrid(t) {
    const out = 1 - span(t, AT.chrome - 0.2, AT.chrome + 0.35);
    if (t < AT.dots - 0.1 || out <= 0) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    const grid = span(t, AT.dots, AT.dots + 0.6) * out, sz = 1.6 * dpr;
    for (const f of field) { // the grid flickers like a halftone screen
      g.globalAlpha = f.a * grid * (0.55 + 0.45 * Math.sin(t * 9 + f.p));
      g.fillStyle = "#cfd8e6"; g.fillRect(f.x, f.y, sz, sz);
    }
    const ln = span(t, AT.dots + 0.7, AT.dots + 1.3) * out;
    if (ln > 0) {
      g.lineWidth = dpr * 0.8;
      const L = Math.hypot(W, H);
      for (const l of lines) {
        const a = l.a + l.turn * (t - AT.dots), dx = Math.cos(a) * L, dy = Math.sin(a) * L;
        g.globalAlpha = l.o * ln; g.strokeStyle = `rgb(${l.c})`;
        g.beginPath(); g.moveTo(l.x - dx, l.y - dy); g.lineTo(l.x + dx, l.y + dy); g.stroke();
      }
    }
    const shell = span(t, AT.dots + 1.3, AT.chrome) * out; // the glass body forms behind the dots
    if (shell > 0) {
      place();
      const body = g.createLinearGradient(0, 0, MW, MH);
      body.addColorStop(0, "#9fb0c6"); body.addColorStop(0.5, "#2a3446"); body.addColorStop(1, "#7d8aa3");
      g.globalAlpha = shell * 0.9; g.fillStyle = body; g.fill(mark);
      g.setTransform(1, 0, 0, 1, 0, 0);
    }
    const dz = 2.2 * dpr;
    for (const d of dots) {
      const k = easeOut(span(t, d.at, d.at + 0.9));
      if (k <= 0) continue;
      g.globalAlpha = Math.min(1, k * 1.6) * out;
      g.fillStyle = d.c; g.fillRect(lerp(d.sx, d.tx, k) - dz / 2, lerp(d.sy, d.ty, k) - dz / 2, dz, dz);
    }
    g.globalAlpha = 1;
  }

  function chrome(t) {
    const a = span(t, AT.chrome - 0.2, AT.chrome + 0.25) * (1 - span(t, AT.ribbon - 0.2, AT.ribbon + 0.25));
    if (a <= 0) return;
    const turn = (1 - easeOut(span(t, AT.chrome - 0.2, AT.chrome + 1.0))) * 1.35;
    place(0, Math.max(0.06, Math.cos(turn)));
    g.globalAlpha = a;
    const shift = turn * 40, ribs = g.createLinearGradient(-shift, 0, MW - shift, 0);
    for (let i = 0; i <= 26; i++) ribs.addColorStop(i / 26, i % 2 ? "#3a4460" : i % 4 ? "#f2f5ff" : "#c8d6ff");
    const smooth = g.createLinearGradient(0, 0, MW, MH);
    smooth.addColorStop(0, "#f4f6ff"); smooth.addColorStop(0.45, "#7f8db5"); smooth.addColorStop(0.7, "#e6ecff"); smooth.addColorStop(1, "#3b4566");
    g.fillStyle = smooth; g.fill(mark);
    g.save(); g.clip(mark);
    g.globalAlpha = a * Math.min(1, turn / 0.6); g.fillStyle = ribs; g.fillRect(-10, -10, MW + 20, MH + 20); // ribs while it is side-on
    const iris = g.createLinearGradient(0, 0, 0, MH);
    iris.addColorStop(0, "#6f8cff"); iris.addColorStop(0.4, "#c28bff"); iris.addColorStop(0.7, "#ffb48a"); iris.addColorStop(1, "#5fe0ff");
    g.globalCompositeOperation = "overlay"; g.globalAlpha = a * 0.55; g.fillStyle = iris; g.fillRect(-10, -10, MW + 20, MH + 20);
    g.restore();
    g.globalAlpha = 1;
  }

  function ribbon(t) {
    const a = span(t, AT.ribbon - 0.2, AT.ribbon + 0.25) * (1 - span(t, AT.flat - 0.1, AT.flat + 0.04));
    if (a <= 0) return;
    place();
    g.globalAlpha = a;
    const body = g.createLinearGradient(0, 0, MW, MH);
    body.addColorStop(0, "#1a1840"); body.addColorStop(0.42, "#5d5ab8"); body.addColorStop(0.6, "#d4d2fb"); body.addColorStop(0.78, "#6f6cc8"); body.addColorStop(1, "#201d4d");
    g.fillStyle = body; g.fill(mark);
    g.save(); g.clip(mark); // the bright edges of a twisting ribbon, drifting
    const k = span(t, AT.ribbon - 0.2, AT.flat);
    g.lineWidth = (1.3 * dpr) / s; g.strokeStyle = "rgba(255,255,255,0.65)";
    for (let i = 0; i < 4; i++) {
      const y = 8 + i * 36 + k * 10;
      g.beginPath(); g.moveTo(-10, y + 20); g.bezierCurveTo(30, y - 30 + k * 20, 70, y + 40 - k * 20, MW + 10, y - 10); g.stroke();
    }
    g.restore();
    g.globalAlpha = 1;
  }

  function finale(t) {
    const a = span(t, AT.flat - 0.1, AT.flat + 0.04);
    if (a <= 0) return;
    // the P slides left and shrinks from its size in the looks (s) to the closing word's size (sEnd)
    const k = easeInOut(span(t, AT.slide, AT.slide + 1.1)), sc = lerp(s, sEnd, k);
    const dy = -word.lift * easeInOut(span(t, AT.name - 0.3, AT.name + 0.5)), base = cy + (MH * sEnd) / 2 + dy;
    const markX = lerp(cx - (MW * s) / 2, word.left, k), markY = lerp(cy - (MH * s) / 2, cy - (MH * sEnd) / 2, k) + dy;
    // C, O and P come out from behind the P: drawn only to the right of its moving right-hand edge
    const edge = markX + MW * sc;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.save();
    g.beginPath(); g.rect(edge + 2 * sEnd, 0, W, H); g.clip();
    g.font = `700 ${word.size}px ${FONT}`; g.fillStyle = "#fff"; g.textBaseline = "alphabetic";
    // as one group, so the letters never run into each other: hidden right behind the edge at first, then into place
    const e = easeOut(span(t, AT.slide + 0.12, AT.slide + 1.25)), groupW = word.right - word.finals[0];
    const x0 = lerp(edge - groupW, word.finals[0], e);
    if (e > 0) LETTERS.forEach((ch, i) => { g.globalAlpha = a; g.fillText(ch, x0 + word.finals[i] - word.finals[0], base); });
    g.restore();
    g.setTransform(sc, 0, 0, sc, markX, markY);
    g.globalAlpha = a; g.fillStyle = "#fff"; g.fill(mark);
    // the portal's name under the word, rising into place
    const n = easeOut(span(t, AT.name, AT.name + 0.7));
    if (n > 0) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = n; g.fillStyle = "#fff"; g.font = `500 ${word.nameSize}px ${FONT}`;
      spaced(NAME, word.mid, base + word.nameSize * 1.9 + (1 - n) * word.nameSize * 0.6, word.nameSize * 0.08, true);
    }
    credits(t, cy - (MH * sEnd) / 2 + dy, base);
    g.globalAlpha = 1;
  }

  fit();
  window.addEventListener("resize", fit);
  const t0 = performance.now();
  let raf = 0;
  const frame = (now) => {
    const t = (now - t0) / 1000;
    background(t); glass(t); smoke(t); dotsAndGrid(t); chrome(t); ribbon(t); finale(t);
    if (t >= AT.end) { onEnd(); return; }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", fit); };
}

export const skipsIntro = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches || new URLSearchParams(location.search).has("nointro");

export function Intro({ onDone }) {
  // The Enter screen is switched off for now (owner, 2026-11-20): the sequence starts by itself on load. Browsers allow
  // sound only after a click or key press, so it usually plays silent. To bring Enter back: start `gate` at true,
  // remove the effect that calls start() below, and uncomment the .intro-gate line in the markup.
  const [gate, setGate] = useState(false), [out, setOut] = useState(false), [armed, setArmed] = useState(false);
  const [muted, setMuted] = useState(() => { try { return localStorage.getItem(MUTED_KEY) === "1"; } catch { return false; } });
  const enter = useRef(null), canvas = useRef(null), sound = useRef(null), stop = useRef(null), timers = useRef([]), over = useRef(false);

  useEffect(() => {
    enter.current?.focus();
    document.fonts?.load(`700 100px ${FONT}`).catch(() => {}); // the closing letters are drawn in the portal's font
    return () => { timers.current.forEach(clearTimeout); stop.current?.(); sound.current?.stop(0.25); };
  }, []);

  const finish = (fade = 1.4, all = false) => { // the sound rings out as the portal appears
    if (over.current) return;
    over.current = true;
    timers.current.forEach(clearTimeout);
    stop.current?.(); // the last frame stays while the overlay fades
    sound.current?.stop(fade); sound.current = null;
    setOut(true);
    setTimeout(() => onDone({ skipAll: all }), OUT_MS);
  };
  useEffect(() => { // Esc, on the Enter screen or during the sequence, skips everything that follows too
    const esc = (e) => { if (e.key === "Escape") { e.preventDefault(); finish(0.25, true); } };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const start = (e) => {
    e?.stopPropagation();
    setGate(false);
    sound.current = introSound({ muted });
    stop.current = play(canvas.current, () => finish());
    // from here on any key or click skips; not armed at once, so the entering click or key cannot skip it
    timers.current.push(setTimeout(() => setArmed(true), 500));
  };
  useEffect(() => { start(); }, []); // no Enter screen for now: start at once (see above) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!armed) return undefined;
    const skip = (e) => { if (e.key !== "Escape") finish(0.25); };
    window.addEventListener("keydown", skip);
    return () => window.removeEventListener("keydown", skip);
  }, [armed]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleMute = (e) => {
    e.stopPropagation();
    const next = !muted;
    try { localStorage.setItem(MUTED_KEY, next ? "1" : "0"); } catch { /* not remembered */ }
    setMuted(next);
    sound.current?.setMuted(next);
  };

  return (
    <div className={`intro ${gate ? "gate" : ""} ${out ? "out" : ""}`} onClick={armed ? () => finish(0.25) : undefined}>
      <canvas className="intro-canvas" ref={canvas} role="img" aria-label={TITLE} />
      {/* Enter screen, switched off for now (see the note at the top of Intro):
      <div className="intro-gate"><button className="intro-enter" ref={enter} onClick={start}><i /><i /><span>Enter</span></button><small>{TITLE}</small></div> */}
      <button className="intro-mute" aria-pressed={muted} title="Sound on or off" onClick={toggleMute}><Icon paths={SPEAKER + (muted ? OFF : ON)} /><span>{muted ? "Sound off" : "Sound on"}</span></button>
      <button className="intro-skip">Skip</button>
    </div>
  );
}
