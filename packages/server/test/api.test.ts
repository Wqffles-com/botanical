import { describe, expect, test } from "bun:test";
import { LoginRateLimiter } from "../src/auth/rate-limit.ts";
import { PASSWORD, bearer, createAgent, login, readJson, setup } from "./helpers.ts";

async function postJson(
  app: ReturnType<typeof setup>["app"],
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
  clientKey?: string,
): Promise<Response> {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
    clientKey ? { clientKey } : undefined,
  );
}

describe("health and deployment mode", () => {
  test("health is public and reports self-host memory", async () => {
    const { app } = setup();
    const response = await app.fetch(new Request("http://localhost/api/health/"));
    expect(response.status).toBe(200);
    const body = await readJson<{
      ok: boolean;
      deploymentMode: string;
      brand: { name: string };
      persistence: string;
    }>(response);
    expect(body.ok).toBe(true);
    expect(body.deploymentMode).toBe("SELF_HOST");
    expect(body.brand.name).toBe("Botanical");
    expect(body.persistence).toBe("memory");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("saas mode still logs in and creates an agent", async () => {
    const { app } = setup({ BOTANICAL_DEPLOYMENT_MODE: "SAAS" });
    const health = await readJson<{ deploymentMode: string; brand: { name: string } }>(
      await app.fetch(new Request("http://localhost/api/health")),
    );
    expect(health.deploymentMode).toBe("SAAS");
    expect(health.brand.name).toBe("Botanical Cloud");
    const { token } = await login(app);
    const agent = await createAgent(app, token, { name: "Cloud gardener" });
    expect(agent.name).toBe("Cloud gardener");
  });

  test("root points at health", async () => {
    const { app } = setup();
    const body = await readJson<{ health: string }>(await app.fetch(new Request("http://localhost/")));
    expect(body.health).toBe("/api/health");
  });

  test("unknown routes are 404 and wrong methods are 405", async () => {
    const { app } = setup();
    const missing = await app.fetch(new Request("http://localhost/api/nope"));
    expect(missing.status).toBe(404);
    const wrong = await app.fetch(new Request("http://localhost/api/health", { method: "POST" }));
    expect(wrong.status).toBe(405);
  });

  test("cors preflight allows the configured origin", async () => {
    const { app } = setup({ BOTANICAL_CORS_ORIGIN: "http://localhost:5173" });
    const response = await app.fetch(
      new Request("http://localhost/api/health", {
        method: "OPTIONS",
        headers: { origin: "http://evil.example", "access-control-request-method": "GET" },
      }),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
  });
});

describe("auth", () => {
  test("rejects a wrong password without setting a cookie", async () => {
    const { app } = setup();
    const response = await postJson(app, "/api/auth/login", { password: "nope" });
    expect(response.status).toBe(401);
    const body = await readJson<{ error: { code: string } }>(response);
    expect(body.error.code).toBe("unauthorized");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  test("login accepts a passcode and returns a bearer token plus cookie", async () => {
    const { app } = setup();
    const response = await postJson(app, "/api/auth/login", { passcode: PASSWORD });
    expect(response.status).toBe(200);
    const body = await readJson<{ token: string; tokenType: string; operator: { id: string } }>(response);
    expect(body.tokenType).toBe("Bearer");
    expect(body.operator.id).toBe("operator");
    expect(body.token.length).toBeGreaterThan(20);
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`botanical_session=${body.token}`);
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie).not.toContain(PASSWORD);

    const me = await app.fetch(
      new Request("http://localhost/api/auth/me", {
        headers: { cookie: `botanical_session=${body.token}` },
      }),
    );
    expect(me.status).toBe(200);
    const meBody = await readJson<{ session: { id: string }; brand: { name: string } }>(me);
    expect(meBody.session.id).toBeTruthy();
    expect(meBody.brand.name).toBe("Botanical");
    expect(JSON.stringify(meBody)).not.toContain("tokenHash");
  });

  test("bearer auth works and a bad bearer does not fall through to the cookie", async () => {
    const { app } = setup();
    const { token } = await login(app);
    const ok = await app.fetch(new Request("http://localhost/api/auth/me", { headers: bearer(token) }));
    expect(ok.status).toBe(200);

    const blocked = await app.fetch(
      new Request("http://localhost/api/auth/me", {
        headers: { authorization: "Bearer not-the-token", cookie: `botanical_session=${token}` },
      }),
    );
    expect(blocked.status).toBe(401);
  });

  test("logout ends one session and leaves another intact", async () => {
    const { app } = setup();
    const first = await login(app);
    const second = await login(app);
    const logout = await app.fetch(
      new Request("http://localhost/api/auth/logout", { method: "POST", headers: bearer(first.token) }),
    );
    expect(logout.status).toBe(204);
    expect(logout.headers.get("set-cookie") ?? "").toContain("Max-Age=0");

    const firstMe = await app.fetch(
      new Request("http://localhost/api/auth/me", { headers: bearer(first.token) }),
    );
    expect(firstMe.status).toBe(401);
    const secondMe = await app.fetch(
      new Request("http://localhost/api/auth/me", { headers: bearer(second.token) }),
    );
    expect(secondMe.status).toBe(200);
  });

  test("logout without credentials is 401 and an expired session is 401", async () => {
    const { app } = setup();
    const anonymous = await app.fetch(new Request("http://localhost/api/auth/logout", { method: "POST" }));
    expect(anonymous.status).toBe(401);

    let now = new Date("2026-01-01T00:00:00.000Z");
    const clocked = setup({}, { now: () => now });
    const { token } = await login(clocked.app);
    now = new Date("2026-02-01T00:00:00.000Z");
    const me = await clocked.app.fetch(
      new Request("http://localhost/api/auth/me", { headers: bearer(token) }),
    );
    expect(me.status).toBe(401);
  });

  test("mismatched password and passcode is 400", async () => {
    const { app } = setup();
    const response = await postJson(app, "/api/auth/login", { password: PASSWORD, passcode: "other" });
    expect(response.status).toBe(400);
  });

  test("secure cookies are marked Secure", async () => {
    const { app } = setup({ BOTANICAL_COOKIE_SECURE: "true" });
    const response = await postJson(app, "/api/auth/login", { password: PASSWORD });
    expect(response.headers.get("set-cookie") ?? "").toContain("Secure");
  });

  test("hash login ignores the plaintext password", async () => {
    const hash = await Bun.password.hash("hash-secret");
    const { app } = setup({ BOTANICAL_PASSWORD: "plain-secret", BOTANICAL_PASSWORD_HASH: hash });
    const wrong = await postJson(app, "/api/auth/login", { password: "plain-secret" });
    expect(wrong.status).toBe(401);
    const right = await postJson(app, "/api/auth/login", { password: "hash-secret" });
    expect(right.status).toBe(200);
  });

  test("login rate limit is per client and does not leak the cause", async () => {
    const { app } = setup({}, { rateLimiter: new LoginRateLimiter(2, 60_000) });
    expect((await postJson(app, "/api/auth/login", { password: "nope" }, {}, "a")).status).toBe(401);
    expect((await postJson(app, "/api/auth/login", { password: "nope" }, {}, "a")).status).toBe(401);
    const locked = await postJson(app, "/api/auth/login", { password: PASSWORD }, {}, "a");
    expect(locked.status).toBe(429);
    const other = await postJson(app, "/api/auth/login", { password: PASSWORD }, {}, "b");
    expect(other.status).toBe(200);
  });

  test("oversized and non-json bodies are rejected", async () => {
    const { app } = setup({ BOTANICAL_MAX_BODY_BYTES: "1024" });
    const oversized = await postJson(app, "/api/auth/login", { password: "x".repeat(2000) });
    expect(oversized.status).toBe(413);
    const text = await app.fetch(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "password",
      }),
    );
    expect(text.status).toBe(415);
    const broken = await app.fetch(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
    );
    expect(broken.status).toBe(400);
  });
});

describe("agents, chats, messages, profiles", () => {
  test("agent CRUD and auth gate", async () => {
    const { app } = setup();
    const hidden = await app.fetch(new Request("http://localhost/api/agents"));
    expect(hidden.status).toBe(401);

    const { token } = await login(app);
    const created = await createAgent(app, token, { toolIds: ["web.search", "file.read"] });
    const listed = await readJson<{ agents: { id: string }[] }>(
      await app.fetch(new Request("http://localhost/api/agents", { headers: bearer(token) })),
    );
    expect(listed.agents.map((agent) => agent.id)).toContain(created.id);

    const patched = await app.fetch(
      new Request(`http://localhost/api/agents/${created.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", ...bearer(token) },
        body: JSON.stringify({ description: "Updated", toolIds: [] }),
      }),
    );
    expect(patched.status).toBe(200);
    const patchedBody = await readJson<{ agent: { description: string; toolIds: string[] } }>(patched);
    expect(patchedBody.agent.description).toBe("Updated");
    expect(patchedBody.agent.toolIds).toEqual([]);

    const removed = await app.fetch(
      new Request(`http://localhost/api/agents/${created.id}`, {
        method: "DELETE",
        headers: bearer(token),
      }),
    );
    expect(removed.status).toBe(204);
    const missing = await app.fetch(
      new Request(`http://localhost/api/agents/${created.id}`, { headers: bearer(token) }),
    );
    expect(missing.status).toBe(404);
  });

  test("rejects invalid agents", async () => {
    const { app } = setup();
    const { token } = await login(app);
    const response = await postJson(
      app,
      "/api/agents",
      { name: "X", systemPrompt: "Y", toolIds: ["bad id"] },
      bearer(token),
    );
    expect(response.status).toBe(400);
  });

  test("chats require an agent and an explicit profile", async () => {
    const { app } = setup();
    const { token } = await login(app);
    const agent = await createAgent(app, token);

    const missingProfile = await postJson(app, "/api/chats", { agentId: agent.id }, bearer(token));
    expect(missingProfile.status).toBe(422);
    expect((await readJson<{ error: { code: string } }>(missingProfile)).error.code).toBe("profile_required");

    const unknownProfile = await postJson(
      app,
      "/api/chats",
      { agentId: agent.id, profileId: "missing" },
      bearer(token),
    );
    expect(unknownProfile.status).toBe(422);

    const unknownAgent = await postJson(
      app,
      "/api/chats",
      { agentId: "missing", profileId: "grok" },
      bearer(token),
    );
    expect(unknownAgent.status).toBe(404);

    const created = await postJson(
      app,
      "/api/chats",
      { agentId: agent.id, profileId: "grok", title: "Plot notes" },
      bearer(token),
    );
    expect(created.status).toBe(201);
    const chat = (await readJson<{ chat: { id: string; agentId: string; profileId: string; title: string } }>(created))
      .chat;
    expect(chat.agentId).toBe(agent.id);
    expect(chat.profileId).toBe("grok");
    expect(chat.title).toBe("Plot notes");

    const empty = setup({ BOTANICAL_PROFILES: "" });
    const emptyToken = (await login(empty.app)).token;
    const emptyAgent = await createAgent(empty.app, emptyToken);
    const noProfiles = await postJson(
      empty.app,
      "/api/chats",
      { agentId: emptyAgent.id, profileId: "grok" },
      bearer(emptyToken),
    );
    expect(noProfiles.status).toBe(422);
    expect((await readJson<{ error: { code: string } }>(noProfiles)).error.code).toBe("no_profiles_configured");
  });

  test("chats can be renamed and re-profiled over PATCH", async () => {
    const { app } = setup();
    const { token } = await login(app);
    const agent = await createAgent(app, token);
    const created = await postJson(
      app,
      "/api/chats",
      { agentId: agent.id, profileId: "grok", title: "Plot notes" },
      bearer(token),
    );
    const chatId = (await readJson<{ chat: { id: string } }>(created)).chat.id;

    const renamed = await app.fetch(
      new Request(`http://localhost/api/chats/${chatId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", ...bearer(token) },
        body: JSON.stringify({ title: "Soil log" }),
      }),
    );
    expect(renamed.status).toBe(200);
    expect((await readJson<{ chat: { title: string; profileId: string } }>(renamed)).chat).toMatchObject({
      title: "Soil log",
      profileId: "grok",
    });

    const switched = await app.fetch(
      new Request(`http://localhost/api/chats/${chatId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", ...bearer(token) },
        body: JSON.stringify({ profileId: "fast" }),
      }),
    );
    expect(switched.status).toBe(200);
    expect((await readJson<{ chat: { profileId: string; title: string } }>(switched)).chat).toMatchObject({
      profileId: "fast",
      title: "Soil log",
    });

    const missingProfile = await app.fetch(
      new Request(`http://localhost/api/chats/${chatId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", ...bearer(token) },
        body: JSON.stringify({ profileId: "" }),
      }),
    );
    expect(missingProfile.status).toBe(422);
    expect((await readJson<{ error: { code: string } }>(missingProfile)).error.code).toBe("profile_required");
  });

  test("messages persist, stream, switch profile, and title the chat", async () => {
    const { app } = setup();
    const { token } = await login(app);
    const agent = await createAgent(app, token);
    const other = await createAgent(app, token, { name: "Other" });
    const created = await postJson(app, "/api/chats", { agentId: agent.id, profileId: "grok" }, bearer(token));
    const chatId = (await readJson<{ chat: { id: string } }>(created)).chat.id;
    const otherChat = await postJson(
      app,
      "/api/chats",
      { agentId: other.id, profileId: "fast", title: "Kept" },
      bearer(token),
    );
    const otherId = (await readJson<{ chat: { id: string } }>(otherChat)).chat.id;

    const listed = await readJson<{ chats: { id: string }[] }>(
      await app.fetch(new Request(`http://localhost/api/chats?agentId=${agent.id}`, { headers: bearer(token) })),
    );
    expect(listed.chats.map((chat) => chat.id)).toEqual([chatId]);

    const posted = await postJson(
      app,
      `/api/chats/${chatId}/messages`,
      { content: "Hello from the garden", stream: false },
      bearer(token),
    );
    expect(posted.status).toBe(201);
    const saved = await readJson<{
      userMessage: { role: string; content: string };
      assistantMessage: { role: string; content: string };
      profileId: string;
    }>(posted);
    expect(saved.userMessage.role).toBe("user");
    expect(saved.assistantMessage.content).toContain("Profile grok");
    expect(saved.profileId).toBe("grok");

    const titled = await readJson<{ chat: { title: string; agentId: string } }>(
      await app.fetch(new Request(`http://localhost/api/chats/${chatId}`, { headers: bearer(token) })),
    );
    expect(titled.chat.title).toBe("Hello from the garden");
    expect(titled.chat.agentId).toBe(agent.id);

    const streamed = await app.fetch(
      new Request(`http://localhost/api/chats/${otherId}/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "text/event-stream",
          ...bearer(token),
        },
        body: JSON.stringify({ content: "Switch to grok please", profileId: "grok" }),
      }),
    );
    expect(streamed.status).toBe(200);
    expect(streamed.headers.get("content-type")).toContain("text/event-stream");
    const events = await streamed.text();
    expect(events).toContain("event: message.created");
    expect(events).toContain("event: text-delta");
    expect(events).toContain("event: message.completed");
    expect(events).toContain("event: done");
    expect(events).toContain("Profile grok");

    const messages = await readJson<{ messages: { role: string }[] }>(
      await app.fetch(new Request(`http://localhost/api/chats/${otherId}/messages`, { headers: bearer(token) })),
    );
    expect(messages.messages.map((message) => message.role)).toEqual(["user", "assistant"]);

    const switched = await readJson<{ chat: { profileId: string; title: string } }>(
      await app.fetch(new Request(`http://localhost/api/chats/${otherId}`, { headers: bearer(token) })),
    );
    expect(switched.chat.profileId).toBe("grok");
    expect(switched.chat.title).toBe("Kept");

    const missing = await postJson(
      app,
      "/api/chats/missing/messages",
      { content: "hi", stream: false },
      bearer(token),
    );
    expect(missing.status).toBe(404);
  });

  test("profiles list has no default and no secrets", async () => {
    const { app } = setup();
    const { token } = await login(app);
    const response = await app.fetch(new Request("http://localhost/api/profiles", { headers: bearer(token) }));
    expect(response.status).toBe(200);
    const body = await readJson<{
      profiles: { id: string; provider: string; model: string }[];
      defaultProfileId: null;
    }>(response);
    expect(body.defaultProfileId).toBeNull();
    expect(body.profiles.map((profile) => profile.id)).toEqual(["grok", "fast"]);
    expect(JSON.stringify(body)).not.toContain("apiKey");
    expect(JSON.stringify(body)).not.toContain("sk-");
  });

  test("an agent that owns a chat cannot be deleted until the chat is", async () => {
    const { app } = setup();
    const { token } = await login(app);
    const agent = await createAgent(app, token);
    const created = await postJson(
      app,
      "/api/chats",
      { agentId: agent.id, profileId: "fast" },
      bearer(token),
    );
    const chatId = (await readJson<{ chat: { id: string } }>(created)).chat.id;
    const blocked = await app.fetch(
      new Request(`http://localhost/api/agents/${agent.id}`, { method: "DELETE", headers: bearer(token) }),
    );
    expect(blocked.status).toBe(409);

    const removed = await app.fetch(
      new Request(`http://localhost/api/chats/${chatId}`, { method: "DELETE", headers: bearer(token) }),
    );
    expect(removed.status).toBe(204);
    const messages = await app.fetch(
      new Request(`http://localhost/api/chats/${chatId}/messages`, { headers: bearer(token) }),
    );
    expect(messages.status).toBe(404);

    const deleted = await app.fetch(
      new Request(`http://localhost/api/agents/${agent.id}`, { method: "DELETE", headers: bearer(token) }),
    );
    expect(deleted.status).toBe(204);
  });

  test("unexpected store errors do not leak the message", async () => {
    const { app, store } = setup();
    const { token } = await login(app);
    store.agents.list = async () => {
      throw new Error("boom postgres://botanical:secret@db/botanical");
    };
    const original = console.error;
    const logged: unknown[] = [];
    console.error = (...args: unknown[]) => {
      logged.push(args);
    };
    try {
      const response = await app.fetch(new Request("http://localhost/api/agents", { headers: bearer(token) }));
      expect(response.status).toBe(500);
      const text = await response.text();
      expect(text).toContain("internal_error");
      expect(text).not.toContain("secret");
      expect(text).not.toContain("postgres");
      expect(logged.length).toBe(1);
    } finally {
      console.error = original;
    }
  });
});
