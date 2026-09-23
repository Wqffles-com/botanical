import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const port = Number(process.env.PORT || 8080);
const root = path.resolve(process.env.WEB_ROOT || "/app/public");
const upstream = new URL(process.env.API_UPSTREAM || "http://server:8787");

const MIME = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
};

function shouldProxy(pathname) {
  return pathname === "/health" || pathname === "/ready" || pathname.startsWith("/api/");
}

async function serveStatic(urlPath, res) {
  const rel = urlPath === "/" ? "index.html" : decodeURIComponent(urlPath).replace(/^\/+/, "");
  let filePath = path.resolve(root, rel);
  const inside = filePath === root || filePath.startsWith(`${root}${path.sep}`);
  if (!inside) {
    res.writeHead(403, { "content-type": "text/plain" });
    res.end("forbidden");
    return;
  }
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = path.join(filePath, "index.html");
  } catch {
    filePath = path.extname(rel) ? "" : path.join(root, "index.html");
  }
  if (!filePath) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
    return;
  }
  try {
    const body = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "content-type": MIME[ext] ?? "application/octet-stream",
      "cache-control": "no-cache",
      "content-length": body.length,
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  if (shouldProxy(url.pathname)) {
    const headers = { ...req.headers, host: upstream.host };
    const proxied = http.request(
      {
        protocol: upstream.protocol,
        hostname: upstream.hostname,
        port: upstream.port,
        method: req.method,
        path: `${url.pathname}${url.search}`,
        headers,
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
        upstreamRes.pipe(res);
      },
    );
    proxied.on("error", () => {
      if (res.headersSent) return;
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "upstream unavailable" }));
    });
    req.pipe(proxied);
    return;
  }
  void serveStatic(url.pathname, res).catch(() => {
    if (!res.headersSent) res.writeHead(500);
    res.end("error");
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(JSON.stringify({ msg: "web listening", port, upstream: upstream.origin }));
});
