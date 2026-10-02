import { describe, expect, test } from "bun:test";
import { bearer, login, PASSWORD, readJson, setup } from "./helpers.ts";

type App = ReturnType<typeof setup>["app"];

function call(app: App, method: string, path: string, body?: unknown, token?: string): Promise<Response> {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers: { "content-type": "application/json", ...(token ? bearer(token) : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}

async function addMember(app: App, email: string) {
  const response = await call(app, "POST", "/api/auth/signup", { email, password: PASSWORD, displayName: "Member" });
  expect(response.status).toBe(200);
  const body = await readJson<{ token: string; user: { id: string } }>(response);
  return { id: body.user.id, token: body.token };
}

describe("admin user management", () => {
  test("lists users with last active and disabled state, admin only", async () => {
    const { app } = setup();
    const { token } = await login(app);
    const member = await addMember(app, "member@example.com");

    expect((await call(app, "GET", "/api/admin/users", undefined, member.token)).status).toBe(403);
    const listed = await readJson<{ users: { email: string; role: string; lastActiveAt: string | null; disabledAt: string | null }[] }>(
      await call(app, "GET", "/api/admin/users", undefined, token),
    );
    expect(listed.users.map((user) => user.email).sort()).toEqual(["admin@example.com", "member@example.com"]);
    for (const user of listed.users) {
      expect(user.lastActiveAt).not.toBeNull();
      expect(user.disabledAt).toBeNull();
    }
  });

  test("disabling ends sessions and blocks login until re-enabled", async () => {
    const { app } = setup();
    const { token } = await login(app);
    const member = await addMember(app, "member@example.com");

    const disabled = await call(app, "PATCH", `/api/admin/users/${member.id}`, { disabled: true }, token);
    expect(disabled.status).toBe(200);
    expect((await call(app, "GET", "/api/auth/me", undefined, member.token)).status).toBe(401);
    const blocked = await call(app, "POST", "/api/auth/login", { email: "member@example.com", password: PASSWORD });
    expect(blocked.status).toBe(403);
    expect((await readJson<{ error: { code: string } }>(blocked)).error.code).toBe("account_disabled");

    await call(app, "PATCH", `/api/admin/users/${member.id}`, { disabled: false }, token);
    expect((await call(app, "POST", "/api/auth/login", { email: "member@example.com", password: PASSWORD })).status).toBe(200);
  });

  test("promotes and demotes, never leaving zero active admins", async () => {
    const { app } = setup();
    const { token } = await login(app);
    const member = await addMember(app, "member@example.com");
    const admin = (await readJson<{ users: { id: string; role: string }[] }>(await call(app, "GET", "/api/admin/users", undefined, token))).users.find(
      (user) => user.role === "admin",
    );

    const onlyAdmin = await call(app, "PATCH", `/api/admin/users/${admin?.id}`, { role: "member" }, token);
    expect(onlyAdmin.status).toBe(409);
    expect((await readJson<{ error: { code: string } }>(onlyAdmin)).error.code).toBe("last_admin");

    expect((await call(app, "PATCH", `/api/admin/users/${member.id}`, { role: "admin" }, token)).status).toBe(200);
    expect((await call(app, "GET", "/api/admin/users", undefined, member.token)).status).toBe(200);
    expect((await call(app, "PATCH", `/api/admin/users/${admin?.id}`, { role: "member" }, member.token)).status).toBe(200);

    const lastOne = await call(app, "PATCH", `/api/admin/users/${member.id}`, { disabled: true }, member.token);
    expect(lastOne.status).toBe(400);
    expect((await call(app, "PATCH", `/api/admin/users/${member.id}`, { role: "member" }, member.token)).status).toBe(409);
    expect((await call(app, "PATCH", `/api/admin/users/${member.id}`, { role: "owner" }, member.token)).status).toBe(400);
  });

  test("a disabled admin does not count as an active admin", async () => {
    const { app } = setup();
    const { token } = await login(app);
    const member = await addMember(app, "member@example.com");
    await call(app, "PATCH", `/api/admin/users/${member.id}`, { role: "admin", disabled: true }, token);
    const admin = (await readJson<{ users: { id: string; role: string }[] }>(await call(app, "GET", "/api/admin/users", undefined, token))).users.find(
      (user) => user.id !== member.id,
    );
    expect((await call(app, "DELETE", `/api/admin/users/${admin?.id}`, undefined, token)).status).toBe(400);
    expect((await call(app, "PATCH", `/api/admin/users/${admin?.id}`, { role: "member" }, token)).status).toBe(409);
  });

  test("deleting removes the account and its agents and chats", async () => {
    const { app, store } = setup();
    const { token } = await login(app);
    const member = await addMember(app, "member@example.com");
    const created = await call(app, "POST", "/api/agents", { name: "Theirs", systemPrompt: "Hi" }, member.token);
    expect(created.status).toBe(201);
    const mine = store.forUser(member.id);
    expect(await mine.agents.list()).toHaveLength(1);

    expect((await call(app, "DELETE", `/api/admin/users/${member.id}`, undefined, member.token)).status).toBe(403);
    expect((await call(app, "DELETE", `/api/admin/users/${member.id}`, undefined, token)).status).toBe(204);
    expect(await mine.agents.list()).toHaveLength(0);
    expect((await call(app, "GET", "/api/auth/me", undefined, member.token)).status).toBe(401);
    expect((await call(app, "POST", "/api/auth/login", { email: "member@example.com", password: PASSWORD })).status).toBe(401);
    expect((await call(app, "DELETE", `/api/admin/users/${member.id}`, undefined, token)).status).toBe(404);
    const listed = await readJson<{ users: unknown[] }>(await call(app, "GET", "/api/admin/users", undefined, token));
    expect(listed.users).toHaveLength(1);
  });
});
