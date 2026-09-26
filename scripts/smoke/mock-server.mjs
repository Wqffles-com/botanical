/**
 * In-process v0 HTTP fixture.
 *
 * Binds to 127.0.0.1 only. Chat completions are answered by the mock provider
 * in this file. This server never opens an outbound connection.
 */
import http from "node:http";
import crypto from "node:crypto";

const DEFAULT_PASSCODE = "botanical-smoke";
const TOKEN_TTL_MS = 60 * 60 * 1000;

/**
 * @param {{ port?: number, passcode?: string, deploymentMode?: string }} [options]
 * @returns {Promise<{ url: string, port: number, close: () => Promise<void> }>}
 */
export function startMockServer(options = {}) {
  const passcode =
    options.passcode ??
    process.env.BOTANICAL_PASSCODE ??
    process.env.BOTANICAL_PASSWORD ??
    DEFAULT_PASSCODE;
  const deploymentMode = normalizeDeploymentMode(
    options.deploymentMode ?? process.env.DEPLOYMENT_MODE,
  );
  const state = {
    tokens: new Map(),
    agents: new Map(),
    chats: new Map(),
    messages: new Map(),
  };
  const ctx = { passcode, deploymentMode, state };

  const server = http.createServer((req, res) => {
    handle(req, res, ctx).catch((err) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const status = err.status || 500;
      send(res, status, {
        error: err.code || (status === 500 ? "internal" : "invalid_request"),
        message: err.message || "Request failed.",
      });
    });
  });

  return new Promise((resolve, reject) => {
    const onListenError = (error) => reject(error);
    server.once("error", onListenError);
    server.listen(options.port ?? 0, "127.0.0.1", () => {
      server.removeListener("error", onListenError);
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        port,
        close() {
          return new Promise((res, rej) => {
            if (typeof server.closeAllConnections === "function") {
              server.closeAllConnections();
            }
            server.close((err) => (err ? rej(err) : res()));
          });
        },
      });
    });
  });
}

export function normalizeDeploymentMode(value) {
  if (value === "saas" || value === "self_host") return value;
  return "self_host";
}

export function mockCompletion(userText) {
  return {
    role: "assistant",
    content: `mock: ${userText}`,
    provider: "mock",
    model: "mock-echo",
    usage: { inputTokens: 1, outputTokens: 1 },
  };
}

function healthBody(ctx) {
  return {
    ok: true,
    service: "botanical",
    version: "v0-smoke",
    deploymentMode: ctx.deploymentMode,
    mockProvider: true,
    defaultProfile: null,
  };
}

async function handle(req, res, ctx) {
  const pathname = normalizePath(req.url || "/");
  const method = req.method || "GET";

  if (method === "GET" && pathname === "/health") {
    send(res, 200, healthBody(ctx));
    return;
  }

  const body = await readJsonObject(req, method);

  if (method === "POST" && pathname === "/auth/login") {
    login(res, body, ctx);
    return;
  }

  const token = readSession(req, ctx.state);
  if (!token) {
    send(res, 401, {
      error: "unauthorized",
      message: "Sign in with the server passcode.",
    });
    return;
  }

  const found = matchRoute(method, pathname);
  if (!found) {
    send(res, 404, {
      error: "not_found",
      message: `No ${method} ${pathname} route.`,
    });
    return;
  }
  found.handler(res, { ...ctx, body, params: found.params, token });
}

function login(res, body, ctx) {
  const supplied = typeof body.passcode === "string" ? body.passcode : body.password;
  if (typeof supplied !== "string" || supplied.length === 0) {
    send(res, 400, {
      error: "invalid_request",
      message: "Provide passcode (or password) as a non-empty string.",
    });
    return;
  }
  if (supplied !== ctx.passcode) {
    send(res, 401, {
      error: "unauthorized",
      message: "Passcode does not match.",
    });
    return;
  }
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  ctx.state.tokens.set(token, { expiresAt });
  res.setHeader(
    "set-cookie",
    `botanical_session=${token}; HttpOnly; Path=/; SameSite=Lax`,
  );
  send(res, 200, { token, tokenType: "Bearer", expiresIn: TOKEN_TTL_MS / 1000 });
}

const routes = [
  { method: "POST", path: "/auth/logout", handler: logout },
  { method: "GET", path: "/auth/me", handler: me },
  { method: "GET", path: "/profiles", handler: profiles },
  { method: "GET", path: "/agents", handler: listAgents },
  { method: "POST", path: "/agents", handler: createAgent },
  { method: "GET", path: "/agents/:id", handler: getAgent },
  { method: "GET", path: "/chats", handler: listChats },
  { method: "POST", path: "/chats", handler: createChat },
  { method: "GET", path: "/chats/:id", handler: getChat },
  { method: "GET", path: "/chats/:id/messages", handler: listMessages },
  { method: "POST", path: "/chats/:id/messages", handler: postMessage },
];

function logout(res, ctx) {
  ctx.state.tokens.delete(ctx.token);
  send(res, 200, { ok: true });
}

function me(res) {
  send(res, 200, { authenticated: true });
}

function profiles(res) {
  send(res, 200, {
    profiles: [
      {
        id: "mock",
        provider: "mock",
        model: "mock-echo",
        mock: true,
      },
    ],
    defaultProfile: null,
  });
}

function listAgents(res, ctx) {
  send(res, 200, { agents: [...ctx.state.agents.values()] });
}

function createAgent(res, ctx) {
  const name = requiredString(ctx.body.name, "name", 200);
  const description = optionalString(ctx.body.description, "description", 2000);
  const systemPrompt = optionalString(ctx.body.systemPrompt, "systemPrompt", 20000);
  const tools = optionalTools(ctx.body.tools);
  const agent = {
    id: crypto.randomUUID(),
    name,
    description,
    systemPrompt,
    tools,
    createdAt: new Date().toISOString(),
  };
  ctx.state.agents.set(agent.id, agent);
  send(res, 201, agent);
}

function getAgent(res, ctx) {
  const agent = ctx.state.agents.get(ctx.params.id);
  if (!agent) {
    send(res, 404, { error: "agent_not_found", message: "Agent not found." });
    return;
  }
  send(res, 200, agent);
}

function listChats(res, ctx) {
  send(res, 200, { chats: [...ctx.state.chats.values()] });
}

function createChat(res, ctx) {
  const agentId = requiredString(ctx.body.agentId, "agentId", 80);
  if (!Object.hasOwn(ctx.body, "profileId") || ctx.body.profileId == null || ctx.body.profileId === "") {
    send(res, 400, {
      error: "profile_required",
      message: "Choose a model profile. Botanical has no default model.",
    });
    return;
  }
  const profileId = requiredString(ctx.body.profileId, "profileId", 200);
  const agent = ctx.state.agents.get(agentId);
  if (!agent) {
    send(res, 404, { error: "agent_not_found", message: "Agent not found." });
    return;
  }
  const title = optionalString(ctx.body.title, "title", 200);
  const chat = {
    id: crypto.randomUUID(),
    agentId: agent.id,
    profileId,
    title,
    createdAt: new Date().toISOString(),
  };
  ctx.state.chats.set(chat.id, chat);
  ctx.state.messages.set(chat.id, []);
  send(res, 201, chat);
}

function getChat(res, ctx) {
  const chat = ctx.state.chats.get(ctx.params.id);
  if (!chat) {
    send(res, 404, { error: "chat_not_found", message: "Chat not found." });
    return;
  }
  send(res, 200, chat);
}

function listMessages(res, ctx) {
  const messages = ctx.state.messages.get(ctx.params.id);
  if (!messages) {
    send(res, 404, { error: "chat_not_found", message: "Chat not found." });
    return;
  }
  send(res, 200, { messages });
}

function postMessage(res, ctx) {
  const messages = ctx.state.messages.get(ctx.params.id);
  if (!messages) {
    send(res, 404, { error: "chat_not_found", message: "Chat not found." });
    return;
  }
  const content = requiredString(ctx.body.content, "content", 10000);
  const userMessage = {
    id: crypto.randomUUID(),
    chatId: ctx.params.id,
    role: "user",
    content,
    createdAt: new Date().toISOString(),
  };
  const completion = mockCompletion(content);
  const message = {
    id: crypto.randomUUID(),
    chatId: ctx.params.id,
    role: completion.role,
    content: completion.content,
    provider: completion.provider,
    model: completion.model,
    usage: completion.usage,
    createdAt: new Date().toISOString(),
  };
  messages.push(userMessage, message);
  send(res, 200, { userMessage, message });
}

function matchRoute(method, pathname) {
  for (const route of routes) {
    if (route.method !== method) continue;
    const names = [];
    const pattern = route.path.replace(/:([A-Za-z]+)/g, (_match, name) => {
      names.push(name);
      return "([^/]+)";
    });
    const matched = new RegExp(`^${pattern}$`).exec(pathname);
    if (!matched) continue;
    const params = {};
    names.forEach((name, index) => {
      params[name] = decodeURIComponent(matched[index + 1]);
    });
    return { handler: route.handler, params };
  }
  return null;
}

function readSession(req, state) {
  const header = req.headers.authorization || "";
  const bearer = /^Bearer\s+(\S+)\s*$/i.exec(header);
  let token = bearer ? bearer[1] : "";
  if (!token) {
    const cookie = req.headers.cookie || "";
    const session = /(?:^|;\s*)botanical_session=([^;]+)/.exec(cookie);
    token = session ? decodeURIComponent(session[1]) : "";
  }
  if (!token) return null;
  const stored = state.tokens.get(token);
  if (!stored || stored.expiresAt < Date.now()) {
    state.tokens.delete(token);
    return null;
  }
  return token;
}

async function readJsonObject(req, method) {
  if (method === "GET" || method === "HEAD") return {};
  const raw = await readBody(req);
  if (!raw) return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const error = new Error("Request body must be JSON.");
    error.status = 400;
    error.code = "invalid_json";
    throw error;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    const error = new Error("Request body must be a JSON object.");
    error.status = 400;
    error.code = "invalid_json";
    throw error;
  }
  return parsed;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1_000_000) {
        const error = new Error("Request body exceeds 1 MB.");
        error.status = 413;
        error.code = "invalid_request";
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function requiredString(value, field, max) {
  if (typeof value !== "string" || value.trim() === "") {
    const error = new Error(`Field ${field} must be a non-empty string.`);
    error.status = 400;
    error.code = "invalid_request";
    throw error;
  }
  if (value.length > max) {
    const error = new Error(`Field ${field} exceeds ${max} characters.`);
    error.status = 400;
    error.code = "invalid_request";
    throw error;
  }
  return value;
}

function optionalString(value, field, max) {
  if (value == null) return "";
  if (typeof value !== "string") {
    const error = new Error(`Field ${field} must be a string.`);
    error.status = 400;
    error.code = "invalid_request";
    throw error;
  }
  if (value.length > max) {
    const error = new Error(`Field ${field} exceeds ${max} characters.`);
    error.status = 400;
    error.code = "invalid_request";
    throw error;
  }
  return value;
}

function optionalTools(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 100 || value.some((item) => typeof item !== "string")) {
    const error = new Error("Field tools must be an array of strings (100 max).");
    error.status = 400;
    error.code = "invalid_request";
    throw error;
  }
  return value;
}

function normalizePath(url) {
  const pathname = new URL(url, "http://127.0.0.1").pathname.replace(/\/+$/, "");
  return pathname || "/";
}

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
    connection: "close",
  });
  res.end(payload);
}
