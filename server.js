const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const ROOT = path.join(__dirname, "public");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

http.createServer((req, res) => {
  let pathname = "/";
  try { pathname = decodeURIComponent(new URL(req.url, `http://${req.headers.host || "localhost"}`).pathname); } catch {}
  if (pathname === "/") pathname = "/index.html";
  const target = path.normalize(path.join(ROOT, pathname));
  if (!target.startsWith(ROOT)) {
    res.writeHead(403); return res.end("Forbidden");
  }
  fs.readFile(target, (err, data) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("الصفحة غير موجودة"); }
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(target)] || "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    });
    res.end(data);
  });
}).listen(PORT, "0.0.0.0", () => console.log(`Taallam ma Alhaitham running on ${PORT}`));
