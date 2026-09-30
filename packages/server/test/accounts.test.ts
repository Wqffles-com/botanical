import { describe, expect, test } from "bun:test";
import { bearer, createAgent, login, PASSWORD, readJson, setup } from "./helpers.ts";

async function post(
  app: ReturnType<typeof setup>["app"],
  path: string,
  body: unknown,
  token?: string,
): Promise<Response> {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? bearer(token) : {}) },
      body: JSON.stringify(body),
    }),
  );
}

describe("accounts", () => {
  test("the first signup is admin and a second user cannot see their agents", async () => {
    const { app } = setup();
    const first = await login(app);
    const me = await readJson<{ user: { role: string; email: string } }>(
      await app.fetch(new Request("http://localhost/api/auth/me", { headers: bearer(first.token) })),
    );
    expect(me.user.role).toBe("admin");
    const agent = await createAgent(app, first.token, { name: "Private" });

    const second = await post(app, "/api/auth/signup", {
      email: "member@example.com",
      password: PASSWORD,
      displayName: "Member",
    });
    expect(second.status).toBe(200);
    const member = await readJson<{ token: string; user: { role: string } }>(second);
    expect(member.user.role).toBe("member");

    const hidden = await app.fetch(new Request(`http://localhost/api/agents/${agent.id}`, { headers: bearer(member.token) }));
    expect(hidden.status).toBe(404);
    const list = await readJson<{ agents: { name: string }[] }>(
      await app.fetch(new Request("http://localhost/api/agents", { headers: bearer(member.token) })),
    );
    expect(list.agents.some((row) => row.name === "Private")).toBe(false);
  });

  test("closed signup blocks a new account and an invite lets one through", async () => {
    const { app } = setup();
    const { token } = await login(app);
    const closed = await app.fetch(
      new Request("http://localhost/api/admin/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json", ...bearer(token) },
        body: JSON.stringify({ signupMode: "closed" }),
      }),
    );
    expect(closed.status).toBe(200);
    const closedConfig = await readJson<{ signupMode: string; canSignup: boolean }>(
      await app.fetch(new Request("http://localhost/api/auth/config")),
    );
    expect(closedConfig.signupMode).toBe("closed");
    expect(closedConfig.canSignup).toBe(false);
    const blocked = await post(app, "/api/auth/signup", {
      email: "late@example.com",
      password: PASSWORD,
      displayName: "Late",
    });
    expect(blocked.status).toBe(403);

    const inviteMode = await app.fetch(
      new Request("http://localhost/api/admin/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json", ...bearer(token) },
        body: JSON.stringify({ signupMode: "invite" }),
      }),
    );
    expect(inviteMode.status).toBe(200);
    const inviteConfig = await readJson<{ signupMode: string; canSignup: boolean }>(
      await app.fetch(new Request("http://localhost/api/auth/config")),
    );
    expect(inviteConfig.signupMode).toBe("invite");
    expect(inviteConfig.canSignup).toBe(false);
    const created = await readJson<{ url: string; invite: { token: string } }>(
      await post(app, "/api/admin/invites", { days: 7 }, token),
    );
    const invited = await post(app, "/api/auth/signup", {
      email: "invited@example.com",
      password: PASSWORD,
      displayName: "Invited",
      inviteToken: created.invite.token,
    });
    expect(invited.status).toBe(200);
  });

  test("global keys are write-only and a member override wins", async () => {
    const { app } = setup();
    const { token } = await login(app);
    const saved = await app.fetch(
      new Request("http://localhost/api/admin/secrets/deepseek", {
        method: "PUT",
        headers: { "content-type": "application/json", ...bearer(token) },
        body: JSON.stringify({ value: "sk-global-deepseek" }),
      }),
    );
    expect(saved.status).toBe(200);
    const body = await readJson<{ secret: { last4: string } }>(saved);
    expect(body.secret.last4).toBe("seek");
    expect(JSON.stringify(body)).not.toContain("sk-global");

    const member = await readJson<{ token: string }>(
      await post(app, "/api/auth/signup", {
        email: "keys@example.com",
        password: PASSWORD,
        displayName: "Keys",
      }),
    );
    const own = await app.fetch(
      new Request("http://localhost/api/settings/secrets/deepseek", {
        method: "PUT",
        headers: { "content-type": "application/json", ...bearer(member.token) },
        body: JSON.stringify({ value: "sk-user-override" }),
      }),
    );
    expect(own.status).toBe(200);
    const listed = await readJson<{ secrets: { name: string; last4: string }[] }>(
      await app.fetch(new Request("http://localhost/api/settings/secrets", { headers: bearer(member.token) })),
    );
    expect(listed.secrets.find((row) => row.name === "deepseek")?.last4).toBe("ride");
    expect(JSON.stringify(listed)).not.toContain("sk-user");
  });

  test("admins add and remove models, and a retired model is refused", async () => {
    const { app } = setup();
    const { token } = await login(app);
    const listed = await readJson<{ knownModels: Record<string, string[]> }>(
      await app.fetch(new Request("http://localhost/api/admin/profiles", { headers: bearer(token) })),
    );
    expect(listed.knownModels.deepseek).toContain("deepseek-flash");
    expect(listed.knownModels.deepseek).not.toContain("deepseek-chat");

    const retired = await post(app, "/api/admin/profiles", { id: "ds", name: "DS", provider: "deepseek", model: "deepseek-chat" }, token);
    expect(retired.status).toBe(400);

    const custom = await post(
      app,
      "/api/admin/profiles",
      { id: "anthropic--custom", name: "Anthropic (custom)", provider: "anthropic", model: "claude-custom-1" },
      token,
    );
    expect(custom.status).toBe(201);
    const saved = await readJson<{ profile: { model: string; maxTokens?: number } }>(custom);
    expect(saved.profile).toMatchObject({ model: "claude-custom-1", maxTokens: 4096 });

    const profiles = await readJson<{ profiles: { id: string }[] }>(
      await app.fetch(new Request("http://localhost/api/profiles", { headers: bearer(token) })),
    );
    expect(profiles.profiles.some((profile) => profile.id === "anthropic--custom")).toBe(true);

    const removed = await app.fetch(
      new Request("http://localhost/api/admin/profiles/anthropic--custom", { method: "DELETE", headers: bearer(token) }),
    );
    expect(removed.status).toBe(204);
  });
});
