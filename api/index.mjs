/**
 * The data API as a Vercel function. vercel.json sends every /api/... request here; the routes themselves are in
 * server/api.mjs, the same code serve.mjs mounts when the portal runs on a PC.
 * Settings come from the Vercel project's environment variables (DATABASE_URL, REDIS_URL).
 */
import { handleApi } from "../server/api.mjs";

export default function handler(req, res) {
  // the rewrite passes the original path as ?__path=...; restore it so the routes see /api/<path>
  const path = new URL(req.url, "http://localhost").searchParams.get("__path");
  if (path != null) req.url = `/api/${path}`;
  return handleApi(req, res);
}
