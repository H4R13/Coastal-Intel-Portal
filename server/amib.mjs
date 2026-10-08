/**
 * Map images for the saltwater intrusion / salinity package (AMIB).
 *   GET /api/amib/image/<layer id>/<step>   PNG of the layer's pre-coloured raster for that time step (0 for single maps)
 * Drawing one image takes about half a second of processor time (server/amib-render.mjs), so:
 *   - images are drawn in a pool of worker threads, several at once, and the main thread stays free for other requests
 *     (before, four year steps queued behind each other and took 4 s, and cached answers waited behind them);
 *   - every image drawn is kept on disk in .amibcache/ and served from there afterwards (about 1 ms). They are not put
 *     in Redis: the hazard maps alone are about 230 MB, which would crowd the 512 MB cache and push out the mangrove
 *     pictures; on disk they also survive restarts;
 *   - the same image asked for twice at once is drawn once;
 *   - a drawing still waiting for a free thread is dropped when nobody is waiting for it any more (the page moved on
 *     to another map), so the map just chosen is not drawn behind the one just left.
 * load-amib.mjs empties .amibcache/; warm-amib.mjs fills it ahead.
 */
import fs from "node:fs"; import path from "node:path"; import os from "node:os"; import crypto from "node:crypto";
import { Worker } from "node:worker_threads";
import "sharp"; // load the native module on the main thread before any worker does
import { query } from "./db.mjs";

const DIR = path.resolve(process.env.AMIB_DIR ?? "Other Data/AMIB");
export const DISK_CACHE = path.resolve(".amibcache");
const files = new Map(); // layer id → image file per step

async function fileOf(id, step) {
  if (!files.has(id)) files.set(id, (await query("select body from amib_doc where key = $1", [`files/${id}`])).rows[0]?.body ?? null);
  const rel = files.get(id)?.[step];
  if (!rel) return null;
  const abs = path.resolve(DIR, rel);
  return abs.startsWith(DIR) && fs.existsSync(abs) ? abs : null;
}

/* ---------- worker pool ---------- */
const SIZE = Math.max(1, Math.min(4, (os.availableParallelism?.() ?? os.cpus().length) - 2)); // leave room for the browser and PostgreSQL
const workers = [], queue = [], jobs = new Map();
let seq = 0;

function spawn() {
  const w = new Worker(new URL("./amib-worker.mjs", import.meta.url));
  w.busy = false;
  w.on("message", ({ job, png, error }) => {
    const j = jobs.get(job);
    jobs.delete(job);
    w.busy = false;
    if (error) j?.reject(new Error(error)); else j?.resolve(Buffer.from(png));
    next();
  });
  w.on("error", (e) => { // a crashed worker fails its job and is replaced
    for (const [id, j] of jobs) if (j.worker === w) { jobs.delete(id); j.reject(e); }
    workers.splice(workers.indexOf(w), 1);
    next();
  });
  w.unref(); // an idle pool never keeps a script alive; a job in progress refs its worker (below)
  workers.push(w);
  return w;
}

function next() {
  while (queue.length) {
    const w = workers.find((x) => !x.busy) ?? (workers.length < SIZE ? spawn() : null);
    if (!w) return;
    const j = queue.shift();
    w.busy = true; j.worker = w;
    w.ref();
    jobs.set(j.id, j);
    w.postMessage({ job: j.id, file: j.file, opts: j.opts });
  }
  for (const w of workers) if (!w.busy) w.unref();
}

const render = (file, opts, key) => new Promise((resolve, reject) => { queue.push({ id: ++seq, key, file, opts, resolve, reject }); next(); });
/** Take a drawing that has not started out of the queue. */
function drop(key) {
  const i = queue.findIndex((j) => j.key === key);
  if (i >= 0) queue.splice(i, 1)[0].reject(Object.assign(new Error("No longer wanted"), { dropped: true }));
}

/** Stop the worker threads (for scripts that want to exit at once). */
export const closeAmibPool = () => Promise.all(workers.splice(0).map((w) => w.terminate()));

/* ---------- disk cache ---------- */
const diskPath = (key) => { const h = crypto.createHash("sha1").update(key).digest("hex"); return path.join(DISK_CACHE, h.slice(0, 2), `${h}.png`); };
function readDisk(key) {
  try { return fs.readFileSync(diskPath(key)); } catch { return null; }
}
function writeDisk(key, png) {
  try {
    const file = diskPath(key), tmp = `${file}.${process.pid}.tmp`;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, png); fs.renameSync(tmp, file); // never leave a half-written image behind
  } catch { /* read-only disk (e.g. a hosted function): the image is still returned */ }
}

export const hexToRgb = (h) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
const keyOf = (id, step, opts) => JSON.stringify([id, +step, !!opts.clearBackground, opts.hideColors ?? []]);
/** Whether this image is already on disk. */
export const amibImageReady = (id, step, opts = {}) => fs.existsSync(diskPath(keyOf(id, step, opts)));

const inflight = new Map(), waiting = new Map(); // key → the drawing in progress; key → how many callers still want it

/**
 * { body: PNG bytes, cache: "hit" | "miss" } for one layer step, or null when the layer, step or file does not exist.
 * `signal` aborts when the caller stops waiting; the promise rejects with { dropped: true } if the drawing was then dropped.
 */
export function amibImage(id, step, opts = {}, signal) {
  const key = keyOf(id, step, opts);
  if (!inflight.has(key)) {
    inflight.set(key, (async () => {
      const disk = readDisk(key);
      if (disk) return { body: disk, cache: "hit" };
      const file = await fileOf(id, step);
      if (!file) return null;
      const png = await render(file, opts, key);
      writeDisk(key, png);
      return { body: png, cache: "miss" };
    })().finally(() => inflight.delete(key)));
  }
  const image = inflight.get(key);
  let left = false;
  const leave = () => {
    if (left) return -1;
    left = true;
    const n = waiting.get(key) - 1;
    if (n) waiting.set(key, n); else waiting.delete(key);
    return n;
  };
  waiting.set(key, (waiting.get(key) ?? 0) + 1);
  signal?.addEventListener("abort", () => { if (leave() === 0) drop(key); }, { once: true });
  image.then(leave, leave);
  return image;
}
