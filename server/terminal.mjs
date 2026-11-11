/**
 * What the portal terminal (src/components/Terminal.jsx) keeps on the server:
 *   - the commands typed into it, in memory only: they come back with the up and down keys for as long as this server
 *     runs, across page reloads and browsers, and are gone when it stops;
 *   - the layers ("factors") taken out of the layer dock with `hide <layer>`, kept in data/terminal.json so they stay
 *     hidden after a restart, until `show <layer>`.
 *   GET  /api/terminal            { history, hidden }
 *   POST /api/terminal/history    { command }     adds one typed command
 *   POST /api/terminal/hidden     { hidden: [...] }  the layer ids to leave out of the dock
 * Needs neither the database nor the cache, so it works while they are down.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAX = 200; // commands kept
const FILE = fileURLToPath(new URL("../data/terminal.json", import.meta.url));
const history = [];
let hidden = null; // read from FILE on first use

async function load() {
  if (hidden) return hidden;
  try { const saved = JSON.parse(await fs.readFile(FILE, "utf8")); hidden = Array.isArray(saved.hidden) ? saved.hidden.filter((id) => typeof id === "string") : []; }
  catch { hidden = []; } // no file yet: nothing hidden
  return hidden;
}

export async function terminalState() {
  return { history, hidden: await load() };
}

export function addCommand(command) {
  if (typeof command !== "string" || !(command = command.trim().slice(0, 500))) return false;
  if (history.at(-1) !== command) history.push(command); // a command run twice in a row is kept once, as in bash
  if (history.length > MAX) history.splice(0, history.length - MAX);
  return true;
}

export async function setHidden(ids) {
  if (!Array.isArray(ids)) return false;
  hidden = [...new Set(ids.filter((id) => typeof id === "string" && /^[a-z0-9_-]{1,40}$/i.test(id)))];
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify({ hidden }, null, 2));
  return true;
}
