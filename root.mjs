/**
 * Where the portal's data lives. The database settings (.env), the team's raw data (Other Data/), the terrain and
 * sea-level tiles (data/) and the caches (.tilecache/, .amibcache/) are large and are shared with the original portal,
 * so they are not copied here. They are looked for:
 *   1. in the folder named by PORTAL_DATA_ROOT, if set;
 *   2. in this folder, if it has a .env or a data/ folder of its own (after it has replaced the original);
 *   3. in the folder above (this project sitting inside the original portal).
 * The process then works from that folder, so the server code reads the same relative paths as before.
 */
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";

export const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
try { process.loadEnvFile(path.join(APP_DIR, ".env")); } catch { /* none here */ } // lets this .env set PORTAL_DATA_ROOT
const own = fs.existsSync(path.join(APP_DIR, ".env")) || fs.existsSync(path.join(APP_DIR, "data"));
export const DATA_ROOT = path.resolve(process.env.PORTAL_DATA_ROOT ?? (own ? APP_DIR : path.join(APP_DIR, "..")));
process.chdir(DATA_ROOT);
try { process.loadEnvFile(path.join(DATA_ROOT, ".env")); } catch { /* no .env: database settings may come from the environment */ }
