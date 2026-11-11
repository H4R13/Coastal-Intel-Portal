// Development: starts PostgreSQL if it is not running (server/pg.mjs; Ctrl+C here leaves it running, npm run db:stop
// ends it), then rebuilds the app whenever a file in src/ changes and restarts the server when server code changes.
import { spawn } from "node:child_process";
import { startDb } from "./server/pg.mjs";
await startDb();
const run = (cmd, args) => spawn(cmd, args, { stdio: "inherit", shell: true });
const jobs = [run("npx", ["vite", "build", "--watch"]), run("node", ["--watch", "server.mjs"])];
process.on("SIGINT", () => { jobs.forEach((j) => j.kill()); process.exit(0); });
