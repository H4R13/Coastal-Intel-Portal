/**
 * Worker thread of server/amib.mjs: draws package map images off the main thread, so a slow first drawing never holds
 * up the rest of the API. Message in: { job, file, opts }; message out: { job, png } or { job, error }.
 */
import { parentPort } from "node:worker_threads";
import sharp from "sharp";
import { renderAmibFile } from "./amib-render.mjs";

sharp.concurrency(1); // the pool already runs one drawing per thread; more threads each only get in each other's way

parentPort.on("message", async ({ job, file, opts }) => {
  try {
    const png = await renderAmibFile(file, opts);
    const ab = png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength); // own copy, handed over without copying again
    parentPort.postMessage({ job, png: ab }, [ab]);
  } catch (e) {
    parentPort.postMessage({ job, error: e.message });
  }
});
