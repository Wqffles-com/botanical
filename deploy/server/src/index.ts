import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { evaluateConfig, providerFlags, searchFlags, type AppConfig, type LogLevel } from "./config.js";
import { safeEqual, sessionCookie, signSession, verifySession } from "./session.js";

const LOG_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const MIME: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

function redact(message: string): string {
  return message.replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://[redacted]");
}

function log(config: AppConfig, level: LogLevel, msg: string, extra?: Record<string, unknown>): void {
  if (LOG_RANK[level] < LOG_RANK[config.logLevel]) return;
  const line: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg,
    service: "botanical",
    deploymentMode: config.mode,
  };
  if (extra) Object.assign(line, extra);
  console.log(JSON.stringify(line));
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers?: Record<string, string>): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-length": Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
}

function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = req.headers["x-forwarded-for"];
    const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    if (raw) {
      const first = raw.split(",")[0]?.trim();
      if (first) return first;
    }
  }
  return req.socket.remoteAddress ?? "unknown";
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > 4096) throw new HttpError(413, "body too large");
    chunks.push(buf);
  }
  if (size === 0) return {};
  const type = req.headers["content-type"];
  const mime = Array.isArray(type) ? type[0] : type;
  if (!mime?.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "content-type must be application/json");
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new HttpError(400, "invalid json");
  }
}

function cookies(req: IncomingMessage): Map<string, string> {
  const out = new Map<string, string>();
  const header = req.headers.cookie;
  if (!header) return out;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) continue;
    try {
      out.set(key, decodeURIComponent(value));
    } catch {
      out.set(key, value);
    }
  }
  return out;
}

const attempts = new Map<string, { count: number; resetAt: number }>();
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const ATTEMPT_MAX = 20;

function tooManyAttempts(ip: string): boolean {
  const now = Date.now();
  const current = attempts.get(ip);
  if (!current || current.resetAt < now) return false;
  return current.count >= ATTEMPT_MAX;
}

function recordFailure(ip: string): void {
  const now = Date.now();
  if (attempts.size > 2000) {
    for (const [key, value] of attempts) {
      if (value.resetAt < now) attempts.delete(key);
    }
  }
  const current = attempts.get(ip);
  if (!current || current.resetAt < now) {
    attempts.set(ip, { count: 1, resetAt: now + ATTEMPT_WINDOW_MS });
    return;
  }
  current.count += 1;
}

async function serveStatic(config: AppConfig, urlPath: string, res: ServerResponse): Promise<void> {
  const root = path.resolve(config.webRoot);
  const rel = urlPath === "/" ? "index.html" : decodeURIComponent(urlPath).replace(/^\/+/, "");
  const target = path.resolve(root, rel);
  const inside = target === root || target.startsWith(`${root}${path.sep}`);
  if (!inside) {
    sendJson(res, 403, { ok: false, error: "forbidden" });
    return;
  }
  let filePath = target;
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = path.join(filePath, "index.html");
  } catch {
    if (path.extname(rel)) {
      sendJson(res, 404, { ok: false, error: "not found" });
      return;
    }
    filePath = path.join(root, "index.html");
  }
  try {
    const body = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "content-type": MIME[ext] ?? "application/octet-stream",
      "cache-control": "no-cache",
      "x-content-type-options": "nosniff",
      "content-length": body.length,
    });
    res.end(body);
  } catch {
    sendJson(res, 404, { ok: false, error: "not found" });
  }
}

async function main(): Promise<void> {
  const evaluated = evaluateConfig(process.env);
  for (const warning of evaluated.warnings) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), level: "warn", msg: warning, service: "botanical" }));
  }
  if (!evaluated.config) {
    for (const error of evaluated.errors) {
      console.error(JSON.stringify({ ts: new Date().toISOString(), level: "error", msg: error, service: "botanical" }));
    }
    process.exit(1);
  }
  const config = evaluated.config;

  const sql = postgres(config.databaseUrl, {
    max: config.poolMax,
    connect_timeout: 3,
    idle_timeout: 20,
    ...(config.databaseSsl ? { ssl: config.databaseSsl } : {}),
  });

  let dbUp = false;
  const refreshDb = async (): Promise<boolean> => {
    try {
      const rows = await sql`select 1 as ok`;
      dbUp = Number(rows[0]?.ok) === 1;
    } catch (error) {
      dbUp = false;
      log(config, "warn", "database check failed", {
        error: redact(error instanceof Error ? error.message : "unknown"),
      });
    }
    return dbUp;
  };

  for (let attempt = 1; attempt <= 30; attempt += 1) {
    if (await refreshDb()) break;
    log(config, "info", "waiting for postgres", { attempt, of: 30 });
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!dbUp) {
    log(config, "error", "postgres not reachable");
    await sql.end({ timeout: 2 });
    process.exit(1);
  }

  const meta = () => ({
    service: "botanical",
    role: "deploy-bootstrap",
    version: config.version,
    deploymentMode: config.mode,
    multiTenant: false,
    billing: "deferred",
    auth: "passcode",
    database: dbUp ? "ok" : "down",
    providers: providerFlags(process.env),
    webSearch: searchFlags(process.env),
    serveWeb: config.serveWeb,
    workspace: config.workspace,
  });

  const server = createServer((req, res) => {
    void handle(req, res).catch((error: unknown) => {
      if (res.headersSent) {
        res.end();
        return;
      }
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof HttpError ? error.message : "internal error";
      if (!(error instanceof HttpError)) {
        log(config, "error", "request failed", {
          error: redact(error instanceof Error ? error.message : "unknown"),
        });
      }
      sendJson(res, status, { ok: false, error: message });
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const host = req.headers.host ?? "localhost";
    const url = new URL(req.url ?? "/", `http://${host}`);
    const method = req.method ?? "GET";
    log(config, "debug", "request", { method, path: url.pathname });

    if (method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, { ok: true, ready: dbUp, ...meta() });
      return;
    }
    if (method === "GET" && url.pathname === "/ready") {
      const ready = await refreshDb();
      sendJson(res, ready ? 200 : 503, { ok: ready, ready, deploymentMode: config.mode });
      return;
    }
    if (method === "GET" && url.pathname === "/api/meta") {
      sendJson(res, 200, { ok: true, ...meta() });
      return;
    }
    if (url.pathname === "/api/session" && method === "POST") {
      const ip = clientIp(req, config.trustProxy);
      if (tooManyAttempts(ip)) throw new HttpError(429, "too many attempts");
      const body = await readJson(req);
      const passcode = body && typeof body === "object" && "passcode" in body ? (body as { passcode?: unknown }).passcode : undefined;
      if (typeof passcode !== "string" || !safeEqual(passcode, config.passcode)) {
        recordFailure(ip);
        log(config, "info", "passcode rejected", { ip });
        throw new HttpError(401, "unauthorized");
      }
      const token = signSession(config.sessionSecret, config.sessionTtlSeconds, config.mode);
      log(config, "info", "session started", { ip });
      sendJson(
        res,
        200,
        { ok: true, deploymentMode: config.mode },
        { "set-cookie": sessionCookie(token, config.sessionTtlSeconds, config.cookieSecure) },
      );
      return;
    }
    if (url.pathname === "/api/session" && method === "DELETE") {
      sendJson(res, 200, { ok: true }, { "set-cookie": sessionCookie("", 0, config.cookieSecure, true) });
      return;
    }
    if (method === "GET" && url.pathname === "/api/me") {
      const token = cookies(req).get("botanical_session");
      const session = token ? verifySession(config.sessionSecret, token) : null;
      if (!session) throw new HttpError(401, "unauthorized");
      sendJson(res, 200, {
        ok: true,
        authenticated: true,
        deploymentMode: config.mode,
        multiTenant: false,
      });
      return;
    }
    if (method === "GET" && url.pathname === "/" && !config.serveWeb) {
      sendJson(res, 200, {
        ok: true,
        service: "botanical",
        role: "deploy-bootstrap",
        web: "separate-container",
        health: "/health",
        ready: "/ready",
      });
      return;
    }
    if (method === "GET" && config.serveWeb && !url.pathname.startsWith("/api/")) {
      await serveStatic(config, url.pathname, res);
      return;
    }
    throw new HttpError(404, "not found");
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => resolve());
  });
  log(config, "info", "listening", {
    host: config.host,
    port: config.port,
    serveWeb: config.serveWeb,
    sessionDerived: config.sessionDerived,
    role: "deploy-bootstrap",
  });

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    log(config, "info", "shutting down", { signal });
    server.close();
    await sql.end({ timeout: 5 });
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

void main();
