// PostgreSQL on this machine, without the Windows service: node server/pg.mjs start | stop | status
// (npm run db:start, db:stop, db:status; npm run dev starts it first). It runs under your own user through pg_ctl, so
// no administrator rights are needed, and it is started apart from the terminal: closing `npm run dev` (Ctrl+C) leaves
// it running, `npm run db:stop` ends it. Start skips when the database already answers (the service, or an earlier start).
// Where it lives: PG_BIN and PG_DATA in .env, else X:\PostgressSQL\bin and \data (the installation on the laptop).
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const env = {};
try {
  for (const line of fs.readFileSync(path.join(here, "..", ".env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* no .env: the defaults below */ }
const get = (k, d) => process.env[k] || env[k] || d;
const BIN = get("PG_BIN", "X:\\PostgressSQL\\bin"), DATA = get("PG_DATA", "X:\\PostgressSQL\\data");
const HOST = get("PGHOST", "localhost"), PORT = get("PGPORT", "5432");
const exe = (name) => path.join(BIN, process.platform === "win32" ? `${name}.exe` : name);
// pg_ctl's own output, in the project's .pg/ (git-ignored), not in the data folder: after an unclean stop the server
// syncs every file of the data folder and waits 30 s on one it cannot open (this file, held open by itself); and the
// PostgreSQL install folder is read-only for a normal user
const LOG = get("PG_LOG", path.join(here, "..", ".pg", "pg_ctl.log"));

/** pg_isready: 0 accepting connections, 1 starting up (recovering after an unclean stop), 2 no answer. */
const ready = () => spawnSync(exe("pg_isready"), ["-h", HOST, "-p", PORT, "-t", "2"], { encoding: "utf8" }).status;
const answers = () => [0, 1].includes(ready());
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function startDb() {
  if (!fs.existsSync(exe("pg_ctl"))) { console.warn(`PostgreSQL: no pg_ctl in ${BIN} (set PG_BIN in .env); not started.`); return false; }
  let child = null;
  if (answers()) console.log(`PostgreSQL: already running on ${HOST}:${PORT}.`);
  else {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    const args = ["start", "-D", DATA, "-l", LOG, "-w", "-t", "300"];
    // On Windows in a console of its own, hidden: a process merely detached from this one still got the terminal's
    // Ctrl+C (measured 2026-10-26: the server ended with 0xC000013A), one in its own console cannot.
    child = process.platform === "win32"
      ? spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
        `Start-Process -WindowStyle Hidden -FilePath '${exe("pg_ctl")}' -ArgumentList ${args.map((a) => `'"${a}"'`).join(",")}`], { stdio: "ignore", windowsHide: true })
      : spawn(exe("pg_ctl"), args, { detached: true, stdio: "ignore" });
    child.unref();
    console.log("PostgreSQL: starting ...");
  }
  for (let i = 0; i < 300; i++) { // after an unclean stop (Task Manager, a crash) it recovers first: a minute or so
    const r = ready();
    if (r === 0) { if (child) console.log(`PostgreSQL: started on ${HOST}:${PORT} (npm run db:stop ends it).`); return true; }
    if (r === 1 && i % 15 === 0) console.log("PostgreSQL: recovering after an unclean stop, waiting ...");
    await wait(1000);
  }
  console.warn(`PostgreSQL: did not start. See ${LOG} and the newest file in ${path.join(DATA, "log")}.`);
  return false;
}

export function stopDb() {
  if (!answers()) { console.log("PostgreSQL: not running."); return true; }
  const r = spawnSync(exe("pg_ctl"), ["stop", "-D", DATA, "-m", "fast", "-w"], { encoding: "utf8" });
  if (r.status === 0) { console.log("PostgreSQL: stopped."); return true; }
  const svc = process.platform === "win32" && /RUNNING/.test(spawnSync("sc", ["query", "postgresql-x64-18"], { encoding: "utf8" }).stdout || "");
  console.warn(svc
    ? "PostgreSQL: it was started by the Windows service, which only an administrator can stop: Stop-Service postgresql-x64-18 (PowerShell as Administrator)."
    : `PostgreSQL: could not stop it.\n${(r.stderr || r.stdout || "").trim()}`);
  return false;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2] || "status";
  if (cmd === "start") process.exitCode = (await startDb()) ? 0 : 1;
  else if (cmd === "stop") process.exitCode = stopDb() ? 0 : 1;
  else console.log(answers() ? `PostgreSQL: running on ${HOST}:${PORT}.` : "PostgreSQL: not running.");
}
