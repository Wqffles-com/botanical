/** Golden-path checks against a Botanical v0 HTTP API. */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function request({
  baseUrl,
  prefix = "",
  path,
  method = "GET",
  token,
  body,
  timeoutMs = 10000,
}) {
  const url = joinUrl(baseUrl, prefix, path);
  const response = await fetch(url, {
    method,
    headers: {
      accept: "application/json, text/event-stream",
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { url, status: response.status, json, text, headers: response.headers };
}

/**
 * @param {{
 *   baseUrl: string,
 *   prefix?: string,
 *   passcode: string,
 *   strict: boolean,
 *   sendMessage: boolean,
 *   timeoutMs?: number,
 * }} options
 */
export async function runScenario(options) {
  const timeoutMs = options.timeoutMs ?? 10000;
  const prefix = options.prefix ?? "";
  const steps = [];
  let token = "";
  let profileId = "";
  let agent = null;
  let chat = null;

  const call = (method, path, extra = {}) =>
    request({
      baseUrl: options.baseUrl,
      prefix,
      path,
      method,
      token: extra.token === undefined ? token : extra.token,
      body: extra.body,
      timeoutMs,
    });

  const step = async (name, fn) => {
    try {
      const result = normalize(await fn());
      steps.push({ name, status: result.status, detail: result.detail });
    } catch (error) {
      steps.push({
        name,
        status: "fail",
        detail: error instanceof Error ? error.message : String(error),
      });
      const failure = new Error(steps[steps.length - 1].detail);
      failure.steps = steps;
      throw failure;
    }
  };

  try {
    await step("health", async () => {
      const res = await call("GET", "/health", { token: "" });
      assertStatus(res, [200]);
      if (!healthOk(res.json, options.strict)) {
        throw new Error(`unexpected health body: ${truncate(res.text)}`);
      }
      if (options.strict && !jsonContentType(res)) {
        throw new Error("health response is missing application/json");
      }
      return options.strict ? "mock provider ready" : "server is up";
    });

    await step("auth rejects missing session", async () => {
      const res = await call("GET", "/auth/me", { token: "" });
      assertStatus(res, [401, 403]);
      return `HTTP ${res.status}`;
    });

    await step("auth rejects bad passcode", async () => {
      const res = await call("POST", "/auth/login", {
        token: "",
        body: { passcode: `${options.passcode}-wrong` },
      });
      assertStatus(res, [401, 403]);
      if (res.json?.token) throw new Error("bad passcode returned a token");
      return `HTTP ${res.status}`;
    });

    await step("auth login", async () => {
      const res = await call("POST", "/auth/login", {
        token: "",
        body: { passcode: options.passcode },
      });
      if (res.status === 400 || res.status === 422) {
        const retry = await call("POST", "/auth/login", {
          token: "",
          body: { password: options.passcode },
        });
        assertStatus(retry, options.strict ? [200] : [200, 201]);
        token = extractToken(retry, options.strict);
        if (!token) throw new Error(`login returned no bearer token: ${truncate(retry.text)}`);
        return "session from password field";
      }
      assertStatus(res, options.strict ? [200] : [200, 201]);
      token = extractToken(res, options.strict);
      if (!token) throw new Error(`login returned no bearer token: ${truncate(res.text)}`);
      return "bearer token issued";
    });

    await step("auth me", async () => {
      const res = await call("GET", "/auth/me");
      assertStatus(res, [200]);
      const authenticated = res.json?.authenticated === true || res.json?.ok === true;
      if (!authenticated) throw new Error(`unexpected me body: ${truncate(res.text)}`);
      return "session accepted";
    });

    await step("profiles have no default model", async () => {
      const res = await call("GET", "/profiles");
      assertStatus(res, [200]);
      if (res.json?.defaultProfile) {
        throw new Error("server advertised a defaultProfile; v0 requires an explicit pick");
      }
      const list = unwrapList(res.json, "profiles", options.strict);
      if (!list || list.length === 0) {
        throw new Error(`profiles payload missing a list: ${truncate(res.text)}`);
      }
      const selected = list.find((item) => item && item.id === "mock") || list[0];
      if (!selected?.id) throw new Error("profile entry has no id");
      profileId = String(selected.id);
      if (options.strict) {
        if (profileId !== "mock" || selected.provider !== "mock") {
          throw new Error("strict mode expected the mock profile");
        }
        if (res.json.defaultProfile !== null) {
          throw new Error("strict mode expected defaultProfile: null");
        }
      }
      return `using profile ${profileId}`;
    });

    await step("create agent", async () => {
      const res = await call("POST", "/agents", {
        body: {
          name: "Smoke Agent",
          description: "Created by the v0 smoke harness",
          systemPrompt: "You are a smoke-test agent. Reply briefly.",
          tools: [],
        },
      });
      assertStatus(res, options.strict ? [201] : [200, 201]);
      agent = unwrapEntity(res.json, "agent", options.strict);
      if (!agent?.id) throw new Error(`agent response has no id: ${truncate(res.text)}`);
      if (options.strict && !UUID_RE.test(agent.id)) {
        throw new Error(`agent id is not a uuid: ${agent.id}`);
      }
      if (agent.name && agent.name !== "Smoke Agent") {
        throw new Error(`agent name mismatch: ${agent.name}`);
      }
      return `id ${agent.id}`;
    });

    await step("chat requires a profile", async () => {
      const res = await call("POST", "/chats", {
        body: { agentId: agent.id, title: "Missing profile" },
      });
      assertStatus(res, [400, 422]);
      if (res.json?.id) throw new Error("chat was created without a profile");
      if (options.strict && res.json?.error !== "profile_required") {
        throw new Error(`expected error profile_required: ${truncate(res.text)}`);
      }
      return `HTTP ${res.status}`;
    });

    await step("create chat", async () => {
      const res = await call("POST", "/chats", {
        body: {
          agentId: agent.id,
          profileId,
          title: "Smoke chat",
        },
      });
      assertStatus(res, options.strict ? [201] : [200, 201]);
      chat = unwrapEntity(res.json, "chat", options.strict);
      if (!chat?.id) throw new Error(`chat response has no id: ${truncate(res.text)}`);
      const owner = chat.agentId || chat.agent_id;
      if (owner && owner !== agent.id) {
        throw new Error(`chat agentId ${owner} does not match ${agent.id}`);
      }
      const picked = chat.profileId || chat.profile_id;
      if (picked && picked !== profileId) {
        throw new Error(`chat profileId ${picked} does not match ${profileId}`);
      }
      return `id ${chat.id}`;
    });

    await step("read agent and chat", async () => {
      const agents = await call("GET", "/agents");
      assertStatus(agents, [200]);
      const agentList = unwrapList(agents.json, "agents", options.strict);
      if (!agentList?.some((item) => item?.id === agent.id)) {
        throw new Error("created agent is missing from GET /agents");
      }
      const oneAgent = await call("GET", `/agents/${encodeURIComponent(agent.id)}`);
      assertStatus(oneAgent, [200]);
      const fetchedAgent = unwrapEntity(oneAgent.json, "agent", options.strict);
      if (fetchedAgent?.id !== agent.id) throw new Error("GET /agents/:id returned a different agent");

      const chats = await call("GET", "/chats");
      assertStatus(chats, [200]);
      const chatList = unwrapList(chats.json, "chats", options.strict);
      if (!chatList?.some((item) => item?.id === chat.id)) {
        throw new Error("created chat is missing from GET /chats");
      }
      const oneChat = await call("GET", `/chats/${encodeURIComponent(chat.id)}`);
      assertStatus(oneChat, [200]);
      const fetchedChat = unwrapEntity(oneChat.json, "chat", options.strict);
      if (fetchedChat?.id !== chat.id) throw new Error("GET /chats/:id returned a different chat");
      return "lists and records match";
    });

    await step("mock provider message", async () => {
      if (!options.sendMessage) {
        return {
          skip: true,
          detail:
            "skipped so a live provider is not called; set BOTANICAL_MOCK_PROVIDER=1 on the server or BOTANICAL_SMOKE_SEND_MESSAGE=1",
        };
      }
      const res = await call("POST", `/chats/${encodeURIComponent(chat.id)}/messages`, {
        body: { content: "ping" },
      });
      if (!options.strict && isProviderGap(res)) {
        return {
          skip: true,
          detail: `provider unavailable (${res.status}); start the server with BOTANICAL_MOCK_PROVIDER=1`,
        };
      }
      assertStatus(res, options.strict ? [200] : [200, 201]);
      const contentType = res.headers.get("content-type") || "";
      let assistant = "";
      if (contentType.includes("text/event-stream") || looksLikeSse(res.text)) {
        assistant = assistantTextFromSse(res.text);
      } else {
        assistant = assistantTextFromJson(res.json);
      }
      if (!assistant) throw new Error(`no assistant text: ${truncate(res.text)}`);
      if (options.strict && assistant !== "mock: ping") {
        throw new Error(`expected mock echo, got ${JSON.stringify(assistant)}`);
      }
      const listed = await call("GET", `/chats/${encodeURIComponent(chat.id)}/messages`);
      if (listed.status === 200) {
        const messages = unwrapList(listed.json, "messages", options.strict) || [];
        const roles = messages.map((item) => item?.role);
        if (options.strict && (!roles.includes("user") || !roles.includes("assistant"))) {
          throw new Error("message list is missing the user or assistant turn");
        }
      } else if (options.strict) {
        assertStatus(listed, [200]);
      }
      return options.strict ? "mock echo stored" : "assistant turn stored";
    });

    await step("auth logout", async () => {
      const res = await call("POST", "/auth/logout", { body: {} });
      assertStatus(res, options.strict ? [200] : [200, 204]);
      const me = await call("GET", "/auth/me");
      assertStatus(me, [401, 403]);
      return "session cleared";
    });

    return { ok: true, steps };
  } catch (error) {
    if (error && Array.isArray(error.steps)) return { ok: false, steps: error.steps };
    throw error;
  }
}

export function parseSse(raw) {
  const events = [];
  let dataLines = [];
  const flush = () => {
    if (dataLines.length === 0) return;
    const data = dataLines.join("\n");
    dataLines = [];
    if (data === "[DONE]") {
      events.push({ type: "done" });
      return;
    }
    try {
      events.push(JSON.parse(data));
    } catch {
      events.push({ type: "text", text: data });
    }
  };
  for (const line of String(raw).split(/\r?\n/)) {
    if (line === "") {
      flush();
      continue;
    }
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  flush();
  return events;
}

export function assistantTextFromSse(raw) {
  let text = "";
  for (const event of parseSse(raw)) {
    text += textFromContent(event.text ?? event.content ?? event.delta ?? "");
  }
  return text;
}

export function assistantTextFromJson(json) {
  const candidates = [];
  if (json?.message) candidates.push(json.message);
  if (json?.assistant) candidates.push(json.assistant);
  if (Array.isArray(json?.messages)) candidates.push(...json.messages);
  if (json?.role || json?.content) candidates.push(json);
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    if (candidate.role && candidate.role !== "assistant") continue;
    const text = textFromContent(candidate.content);
    if (text) return text;
  }
  return "";
}

export function joinUrl(baseUrl, prefix, path) {
  const base = String(baseUrl).replace(/\/+$/, "");
  const cleanPrefix = prefix ? `/${String(prefix).replace(/^\/+|\/+$/g, "")}` : "";
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${cleanPrefix}${cleanPath}`;
}

function healthOk(json, strict) {
  if (!json || typeof json !== "object") return false;
  if (strict) {
    return json.ok === true && json.service === "botanical" && json.mockProvider === true;
  }
  return json.ok === true || json.status === "ok" || json.status === "healthy";
}

function extractToken(res, strict) {
  if (typeof res.json?.token === "string" && res.json.token) return res.json.token;
  if (strict) return "";
  const alias = res.json?.accessToken || res.json?.access_token;
  if (typeof alias === "string" && alias) return alias;
  const setCookie = res.headers.get("set-cookie") || "";
  const match = /botanical_session=([^;]+)/.exec(setCookie);
  return match ? decodeURIComponent(match[1]) : "";
}

function unwrapList(json, key, strict) {
  if (strict) return Array.isArray(json?.[key]) ? json[key] : null;
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.[key])) return json[key];
  if (Array.isArray(json?.data)) return json.data;
  if (Array.isArray(json?.data?.[key])) return json.data[key];
  return null;
}

function unwrapEntity(json, key, strict) {
  if (strict) return json?.id ? json : null;
  if (json?.id) return json;
  if (json?.[key]?.id) return json[key];
  if (json?.data?.id) return json.data;
  if (json?.data?.[key]?.id) return json.data[key];
  return null;
}

function textFromContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part === "string" ? part : part?.text || "")).join("");
  }
  return "";
}

function looksLikeSse(text) {
  return typeof text === "string" && /(^|\n)data:/.test(text);
}

function isProviderGap(res) {
  const blob = `${res.json?.error || ""} ${res.json?.message || ""} ${res.text || ""}`.toLowerCase();
  if (res.status === 501 || res.status === 503) return true;
  if (res.status >= 500 || res.status === 409 || res.status === 424) {
    return /provider|api[_ ]?key|unconfigured|not configured|mock/.test(blob);
  }
  return false;
}

function jsonContentType(res) {
  return (res.headers.get("content-type") || "").includes("application/json");
}

function assertStatus(res, expected) {
  if (!expected.includes(res.status)) {
    throw new Error(`${res.url} → HTTP ${res.status} ${truncate(res.text)}`);
  }
}

function normalize(result) {
  if (result == null) return { status: "pass", detail: "" };
  if (typeof result === "string") return { status: "pass", detail: result };
  if (result.skip) return { status: "skip", detail: result.detail || "" };
  return { status: "pass", detail: result.detail || "" };
}

function truncate(text) {
  const value = text || "";
  return value.length > 400 ? `${value.slice(0, 400)}…` : value;
}
