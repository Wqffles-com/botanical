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

async function signIn(app: App, email: string, password = PASSWORD): Promise<string> {
  const response = await call(app, "POST", "/api/auth/login", { email, password });
  expect(response.status).toBe(200);
  return (await readJson<{ token: string }>(response)).token;
}

async function addMember(app: App, email = "member@example.com") {
  const response = await call(app, "POST", "/api/auth/signup", { email, password: PASSWORD, displayName: "Member" });
  expect(response.status).toBe(200);
  return (await readJson<{ token: string; user: { id: string } }>(response)).user.id;
}

describe("password and sessions", () => {
  test("changing the password needs the current one and signs out other sessions", async () => {
    const { app } = setup();
    const { token } = await login(app);
    const other = await signIn(app, "admin@example.com");

    const wrong = await call(app, "POST", "/api/auth/password", { currentPassword: "nope nope", newPassword: "brand new pass" }, token);
    expect(wrong.status).toBe(403);
    const short = await call(app, "POST", "/api/auth/password", { currentPassword: PASSWORD, newPassword: "short" }, token);
    expect(short.status).toBe(400);

    const changed = await call(app, "POST", "/api/auth/password", { currentPassword: PASSWORD, newPassword: "brand new pass" }, token);
    expect(changed.status).toBe(200);
    expect(await readJson<{ signedOut: number }>(changed)).toMatchObject({ signedOut: 1 });

    expect((await call(app, "GET", "/api/auth/me", undefined, token)).status).toBe(200);
    expect((await call(app, "GET", "/api/auth/me", undefined, other)).status).toBe(401);
    expect((await call(app, "POST", "/api/auth/login", { email: "admin@example.com", password: PASSWORD })).status).toBe(401);
    await signIn(app, "admin@example.com", "brand new pass");
  });

  test("lists active sessions and signs out the others", async () => {
    const { app } = setup();
    const { token } = await login(app);
    const second = await signIn(app, "admin@example.com");

    const listed = await readJson<{ sessions: { id: string; current: boolean }[] }>(
      await call(app, "GET", "/api/auth/sessions", undefined, token),
    );
    expect(listed.sessions).toHaveLength(2);
    expect(listed.sessions.filter((row) => row.current)).toHaveLength(1);

    const revoked = await readJson<{ revoked: number }>(await call(app, "DELETE", "/api/auth/sessions", undefined, token));
    expect(revoked.revoked).toBe(1);
    expect((await call(app, "GET", "/api/auth/me", undefined, second)).status).toBe(401);
    expect((await call(app, "GET", "/api/auth/me", undefined, token)).status).toBe(200);
  });

  test("a session cannot be revoked by another user", async () => {
    const { app } = setup();
    const { token } = await login(app);
    await addMember(app);
    const memberToken = await signIn(app, "member@example.com");
    const own = await readJson<{ sessions: { id: string }[] }>(await call(app, "GET", "/api/auth/sessions", undefined, token));
    const target = own.sessions[0]?.id ?? "";
    expect((await call(app, "DELETE", `/api/auth/sessions/${target}`, undefined, memberToken)).status).toBe(404);
  });

  test("an admin reset link sets a new password once and ends every session", async () => {
    const { app } = setup();
    const { token } = await login(app);
    const memberId = await addMember(app);
    const memberToken = await signIn(app, "member@example.com");

    const denied = await call(app, "POST", `/api/admin/users/${memberId}/reset-link`, {}, memberToken);
    expect(denied.status).toBe(403);
    const missing = await call(app, "POST", "/api/admin/users/not-a-user/reset-link", {}, token);
    expect(missing.status).toBe(404);

    const created = await call(app, "POST", `/api/admin/users/${memberId}/reset-link`, {}, token);
    expect(created.status).toBe(201);
    const url = new URL((await readJson<{ url: string }>(created)).url);
    const resetToken = url.searchParams.get("reset") ?? "";
    expect(resetToken).not.toBe("");

    const bad = await call(app, "POST", "/api/auth/reset", { token: "wrong", password: "another pass" });
    expect(bad.status).toBe(403);
    const short = await call(app, "POST", "/api/auth/reset", { token: resetToken, password: "short" });
    expect(short.status).toBe(400);

    const reset = await call(app, "POST", "/api/auth/reset", { token: resetToken, password: "another pass" });
    expect(reset.status).toBe(200);
    expect((await call(app, "GET", "/api/auth/me", undefined, memberToken)).status).toBe(401);
    const fresh = await readJson<{ token: string }>(reset);
    expect((await call(app, "GET", "/api/auth/me", undefined, fresh.token)).status).toBe(200);
    await signIn(app, "member@example.com", "another pass");

    const reused = await call(app, "POST", "/api/auth/reset", { token: resetToken, password: "third pass 123" });
    expect(reused.status).toBe(403);
  });

  test("an expired reset link is refused", async () => {
    const { app, store } = setup();
    await login(app);
    const memberId = await addMember(app);
    const { hashToken } = await import("../src/auth/session.ts");
    await store.accounts.createPasswordReset({
      userId: memberId,
      createdBy: memberId,
      tokenHash: hashToken("expired-token"),
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    expect((await call(app, "POST", "/api/auth/reset", { token: "expired-token", password: "another pass" })).status).toBe(403);
  });
});
