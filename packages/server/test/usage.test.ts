import { describe, expect, test } from "bun:test";

import { estimateCostUsd, parsePriceOverrides, priceFor } from "../src/usage/prices.ts";
import { PASSWORD, bearer, createAgent, login, readJson, setup, ECHO_PROFILE } from "./helpers.ts";

type App = ReturnType<typeof setup>["app"];

function send(app: App, path: string, token: string, method = "GET", body?: unknown): Promise<Response> {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers: { "content-type": "application/json", ...bearer(token) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}

async function chatOnce(app: App, token: string, agentId: string, content: string): Promise<void> {
  const created = await send(app, "/api/chats", token, "POST", { agentId, profileId: ECHO_PROFILE.id });
  const chatId = (await readJson<{ chat: { id: string } }>(created)).chat.id;
  const posted = await send(app, `/api/chats/${chatId}/messages`, token, "POST", {
    content,
    profileId: ECHO_PROFILE.id,
    stream: false,
  });
  expect(posted.status).toBe(201);
}

function echoApp() {
  return setup({ BOTANICAL_PROFILES: JSON.stringify([ECHO_PROFILE]) });
}

interface Row {
  key: string;
  label: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  unpricedCalls: number;
}
interface UsageBody {
  scope: string;
  report: { totals: Row; byAgent: Row[]; byModel: Row[]; bySource: Row[]; byDay: Row[]; byUser: Row[] };
}

describe("price table", () => {
  test("longest prefix wins and overrides beat defaults", () => {
    expect(priceFor("claude-haiku-4-5-20251001")).toEqual({ inputPerMTok: 1, outputPerMTok: 5 });
    expect(priceFor("claude-sonnet-5-5")?.inputPerMTok).toBe(3);
    expect(priceFor("echo")).toBeNull();
    const overrides = parsePriceOverrides({ "Claude-Sonnet": { inputPerMTok: 9, outputPerMTok: 10 } });
    expect(priceFor("claude-sonnet-5-5", overrides)).toEqual({ inputPerMTok: 9, outputPerMTok: 10 });
  });

  test("cost is tokens times the per-million rate, null without a price", () => {
    expect(estimateCostUsd(2_000_000, 1_000_000, { inputPerMTok: 1, outputPerMTok: 5 })).toBe(7);
    expect(estimateCostUsd(10, 10, null)).toBeNull();
  });

  test("malformed override entries are dropped", () => {
    expect(parsePriceOverrides({ ok: { inputPerMTok: 1, outputPerMTok: 2 }, bad: { inputPerMTok: -1, outputPerMTok: 2 } })).toEqual({
      ok: { inputPerMTok: 1, outputPerMTok: 2 },
    });
  });
});

describe("usage API", () => {
  test("records each chat turn and groups it by agent, model, source, and day", async () => {
    const { app } = echoApp();
    const { token } = await login(app);
    const agent = await createAgent(app, token, { name: "Gardener" });
    await chatOnce(app, token, agent.id, "hello");

    const body = await readJson<UsageBody>(await send(app, "/api/usage", token));
    expect(body.scope).toBe("own");
    expect(body.report.totals.calls).toBe(1);
    expect(body.report.totals.inputTokens).toBe(3);
    expect(body.report.totals.outputTokens).toBe(2);
    expect(body.report.totals.costUsd).toBeNull();
    expect(body.report.totals.unpricedCalls).toBe(1);
    expect(body.report.byAgent.map((row) => row.label)).toEqual(["Gardener"]);
    expect(body.report.bySource.map((row) => row.key)).toEqual(["chat"]);
    expect(body.report.byModel[0]?.label).toContain("echo");
    expect(body.report.byDay).toHaveLength(1);
  });

  test("an admin override prices the model and applies to past calls", async () => {
    const { app } = echoApp();
    const { token } = await login(app);
    const agent = await createAgent(app, token);
    await chatOnce(app, token, agent.id, "hello");

    const saved = await send(app, "/api/admin/usage/prices", token, "PUT", {
      overrides: { echo: { inputPerMTok: 100_000, outputPerMTok: 100_000 } },
    });
    expect(saved.status).toBe(200);
    const body = await readJson<UsageBody>(await send(app, "/api/usage", token));
    expect(body.report.totals.costUsd).toBe(0.5);
    expect(body.report.totals.unpricedCalls).toBe(0);

    const bad = await send(app, "/api/admin/usage/prices", token, "PUT", { overrides: { echo: { inputPerMTok: "x" } } });
    expect(bad.status).toBe(400);
  });

  test("a member sees only their own usage and cannot read all or set prices", async () => {
    const { app } = echoApp();
    const admin = await login(app);
    const agent = await createAgent(app, admin.token);
    await chatOnce(app, admin.token, agent.id, "admin chat");

    const signup = await app.fetch(
      new Request("http://localhost/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "member@example.com", password: PASSWORD, displayName: "Member" }),
      }),
    );
    const member = (await readJson<{ token: string }>(signup)).token;
    const own = await readJson<UsageBody>(await send(app, "/api/usage", member));
    expect(own.report.totals.calls).toBe(0);
    expect((await send(app, "/api/usage?scope=all", member)).status).toBe(403);
    expect(
      (await send(app, "/api/admin/usage/prices", member, "PUT", { overrides: {} })).status,
    ).toBe(403);

    const all = await readJson<UsageBody>(await send(app, "/api/usage?scope=all", admin.token));
    expect(all.report.totals.calls).toBe(1);
    expect(all.report.byUser.map((row) => row.label)).toEqual(["Admin"]);
  });

  test("rejects a bad days value", async () => {
    const { app } = echoApp();
    const { token } = await login(app);
    expect((await send(app, "/api/usage?days=0", token)).status).toBe(400);
    expect((await send(app, "/api/usage?days=abc", token)).status).toBe(400);
  });
});
