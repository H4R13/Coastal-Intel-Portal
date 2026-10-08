// Runs one of the data scripts (server/load-*.mjs, warm-*.mjs) from the data folder: node run.mjs server/load-amib.mjs [options]
import path from "node:path"; import { pathToFileURL } from "node:url";
import { APP_DIR } from "./root.mjs";
const script = process.argv[2];
process.argv.splice(1, 2, path.join(APP_DIR, script)); // the script sees its own options
await import(pathToFileURL(path.join(APP_DIR, script)).href);
