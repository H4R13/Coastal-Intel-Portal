import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg" };
const root = process.cwd();
http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/$/, "/index.html");
  const p = path.join(root, rel);
  // serve the web app and its data only; keep the data-prep tooling and local config private
  if (!p.startsWith(root) || /^\/(tools|\.claude|node_modules)\b/.test(rel) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end("Not found"); }
  const headers = { "Content-Type": types[path.extname(p)] ?? "application/octet-stream" };
  if (rel.startsWith("/data/") && rel.endsWith(".png")) headers["Cache-Control"] = "public, max-age=86400"; // terrain tiles are static
  res.writeHead(200, headers);
  fs.createReadStream(p).pipe(res);
}).listen(5173, () => console.log("http://localhost:5173"));
