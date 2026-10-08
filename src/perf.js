/**
 * Zoom benchmark. Open the portal with  ?perf  (e.g. http://localhost:5173/?perf)  and press "Run".
 * It scripts zooms over the study area and reports, per step, how smooth the animation was (frame times)
 * and how long the map took to finish loading tiles after it stopped ("settle").
 * It runs twice: the first pass is "cold" (tiles may still need downloading), the second is "warm" (cached).
 */
const STEPS = [
  { name: "zoom 6 → 9", to: { zoom: 9 }, ms: 1500 },
  { name: "zoom 9 → 11.5", to: { zoom: 11.5 }, ms: 1500 },
  { name: "zoom 11.5 → 7", to: { zoom: 7 }, ms: 1500 },
  { name: "tilt 55° at zoom 9", to: { zoom: 9, pitch: 55 }, ms: 1500 },
  { name: "tilt back, zoom 6", to: { zoom: 6, pitch: 0 }, ms: 1500 },
];
const START = { center: [66.6, 24.9], zoom: 6, pitch: 0, bearing: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 } };

const idle = (map, timeout = 30000) => new Promise((res) => {
  const t0 = performance.now();
  if (map.loaded() && !map.isMoving()) return res(0);
  const done = () => { clearTimeout(to); res(performance.now() - t0); };
  const to = setTimeout(() => { map.off("idle", done); res(timeout); }, timeout);
  map.once("idle", done);
});

function runStep(map, step) {
  return new Promise((resolve) => {
    const frames = [];
    let last = performance.now(), running = true;
    const tick = (now) => { if (!running) return; frames.push(now - last); last = now; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    map.once("moveend", async () => {
      running = false;
      const settle = await idle(map);
      const f = frames.slice(2).sort((a, b) => a - b); // drop first frames (animation start)
      const avg = f.reduce((a, b) => a + b, 0) / (f.length || 1);
      resolve({
        step: step.name,
        frames: f.length,
        avgMs: +avg.toFixed(1),
        p95Ms: +(f[Math.floor(f.length * 0.95)] ?? 0).toFixed(1),
        slow: f.filter((x) => x > 33).length,
        settleMs: Math.round(settle),
      });
    });
    map.easeTo({ ...step.to, duration: step.ms, easing: (t) => t });
  });
}

async function benchmark(map, out) {
  const results = [];
  for (const pass of ["cold", "warm"]) {
    out(`${pass} pass: resetting view…`);
    map.jumpTo(START);
    await idle(map);
    for (const s of STEPS) {
      out(`${pass}: ${s.name}`);
      results.push({ pass, ...(await runStep(map, s)) });
    }
  }
  return results;
}

export function initPerf(map) {
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:99999;background:#0c1e26ee;color:#e5e8e5;font:12px/1.5 system-ui;padding:12px 14px;border:1px solid #ffffff33;border-radius:10px;max-width:760px;max-height:80vh;overflow:auto";
  box.innerHTML = `<b>Zoom benchmark</b> <button id="pfRun" style="margin-left:8px">Run</button> <button id="pfCopy" style="margin-left:4px" hidden>Copy results</button><div id="pfOut" style="margin-top:8px;white-space:pre"></div>`;
  document.body.appendChild(box);
  const out = (t) => (box.querySelector("#pfOut").textContent = t);
  let last = null;

  box.querySelector("#pfRun").addEventListener("click", async (e) => {
    e.target.disabled = true;
    const results = await benchmark(map, out);
    const env = {
      dpr: devicePixelRatio, pixelRatio: map.getPixelRatio?.(), basemap: document.querySelector(".bm.active")?.dataset.id,
      terrainOn: !!map.getTerrain(), swControlled: !!navigator.serviceWorker?.controller, viewport: `${innerWidth}x${innerHeight}`,
      ua: navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0],
    };
    last = { env, results };
    const pad = (s, n) => String(s).padEnd(n);
    out([pad("pass", 5), pad("step", 22), pad("avg ms", 8), pad("p95 ms", 8), pad("slow>33ms", 10), "settle ms"].join(" ") + "\n" +
      results.map((r) => [pad(r.pass, 5), pad(r.step, 22), pad(r.avgMs, 8), pad(r.p95Ms, 8), pad(r.slow, 10), r.settleMs].join(" ")).join("\n") + "\n\n" + JSON.stringify(env));
    console.log("PERF", JSON.stringify(last));
    window.__perfResult = last;
    e.target.disabled = false;
    box.querySelector("#pfCopy").hidden = false;
  });
  box.querySelector("#pfCopy").addEventListener("click", () => navigator.clipboard?.writeText(JSON.stringify(last, null, 1)));
}
