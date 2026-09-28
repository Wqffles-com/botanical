import { describe, expect, test } from "bun:test";

import { INTERRUPTED_STOPPED } from "@botanical/db";
import { MEMORY_OPERATOR_ID } from "../src/db/always-on.ts";
import { createMemoryStore } from "../src/db/memory.ts";
import { createScheduler } from "../src/routines/scheduler.ts";
import { createTurnCoordinator } from "../src/runtime/turns.ts";
import { bearer, createAgent, login, readJson, setup } from "./helpers.ts";

const PROFILES = [
  { id: "mock", name: "Mock", provider: "mock", model: "echo" },
  { id: "grok", name: "Grok", provider: "xai", model: "grok-4" },
];

function appWith(overrides: Record<string, string> = {}) {
  return setup({
    BOTANICAL_PROFILES: JSON.stringify(PROFILES),
    ...overrides,
  });
}

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

describe("routine scheduler", () => {
  test("two schedulers claim a due routine once", async () => {
    const store = createMemoryStore();
    const agent = await store.agents.create({
      name: "Ada",
      description: "Test",
      systemPrompt: "Help",
      toolIds: [],
    });
    const due = new Date("2026-06-15T07:00:00.000Z");
    const now = new Date("2026-06-15T12:30:00.000Z");
    const routine = await store.routines.create({
      agentId: agent.id,
      name: "Hourly",
      prompt: "Check the beds",
      cron: "0 * * * *",
      timezone: "UTC",
      profileId: "mock",
      enabled: true,
      nextRunAt: due.toISOString(),
    });
    const turns = createTurnCoordinator({ concurrency: 2 });
    const started: string[] = [];
    const make = () =>
      createScheduler({
        store,
        turns,
        now: () => now,
        executeRun: async (id) => {
          started.push(id);
        },
      });
    await Promise.all([make().tick(), make().tick()]);
    const runs = await store.routineRuns.list(routine.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.trigger).toBe("schedule");
    expect(runs[0]?.scheduledFor).toBe(due.toISOString());
    expect(runs[0]?.status).toBe("queued");
    const updated = await store.routines.get(routine.id);
    expect(updated?.nextRunAt).toBe("2026-06-15T13:00:00.000Z");
    await Promise.all([make().tick(), make().tick()]);
    expect(await store.routineRuns.list(routine.id)).toHaveLength(1);
    expect(started).toHaveLength(1);
    expect(routine.userId).toBe(MEMORY_OPERATOR_ID);
  });

  test("a disabled scheduler setting claims nothing", async () => {
    const store = createMemoryStore();
    const agent = await store.agents.create({
      name: "Ada",
      description: "Test",
      systemPrompt: "Help",
      toolIds: [],
    });
    const routine = await store.routines.create({
      agentId: agent.id,
      name: "Hourly",
      prompt: "Quiet",
      cron: "0 * * * *",
      timezone: "UTC",
      profileId: "mock",
      enabled: true,
      nextRunAt: "2026-06-15T07:00:00.000Z",
    });
    await store.alwaysOnSettings.update({ schedulerEnabled: false });
    const scheduler = createScheduler({
      store,
      turns: createTurnCoordinator({ concurrency: 1 }),
      now: () => new Date("2026-06-15T12:30:00.000Z"),
      executeRun: async () => undefined,
    });
    await scheduler.tick();
    expect(await store.routineRuns.list(routine.id)).toHaveLength(0);
    expect((await store.routines.get(routine.id))?.nextRunAt).toBe("2026-06-15T07:00:00.000Z");
  });

  test("catch-up fires one missed slot and paused routines stay quiet", async () => {
    const store = createMemoryStore();
    const agent = await store.agents.create({
      name: "Ada",
      description: "Test",
      systemPrompt: "Help",
      toolIds: [],
    });
    const now = new Date("2026-06-15T12:30:00.000Z");
    const missed = await store.routines.create({
      agentId: agent.id,
      name: "Missed",
      prompt: "Catch up",
      cron: "0 * * * *",
      timezone: "UTC",
      profileId: "mock",
      enabled: true,
      nextRunAt: "2026-06-15T07:00:00.000Z",
    });
    const paused = await store.routines.create({
      agentId: agent.id,
      name: "Paused",
      prompt: "No",
      cron: "0 * * * *",
      timezone: "UTC",
      profileId: "mock",
      enabled: false,
      nextRunAt: "2026-06-15T07:00:00.000Z",
    });
    const turns = createTurnCoordinator({ concurrency: 2 });
    const scheduler = createScheduler({
      store,
      turns,
      now: () => now,
      executeRun: async () => undefined,
    });
    await scheduler.tick();
    const missedRuns = await store.routineRuns.list(missed.id);
    expect(missedRuns).toHaveLength(1);
    expect(missedRuns[0]?.scheduledFor).toBe("2026-06-15T07:00:00.000Z");
    expect((await store.routines.get(missed.id))?.nextRunAt).toBe("2026-06-15T13:00:00.000Z");
    expect(await store.routineRuns.list(paused.id)).toHaveLength(0);
    await scheduler.tick();
    expect(await store.routineRuns.list(missed.id)).toHaveLength(1);
  });

  test("a live lease survives another instance and an expired one is reaped", async () => {
    let now = new Date("2026-06-15T12:00:00.000Z");
    const store = createMemoryStore({ now: () => now });
    const agent = await store.agents.create({
      name: "Ada",
      description: "Test",
      systemPrompt: "Help",
      toolIds: [],
    });
    const routine = await store.routines.create({
      agentId: agent.id,
      name: "Hourly",
      prompt: "Hi",
      cron: "0 * * * *",
      timezone: "UTC",
      profileId: "mock",
      enabled: true,
      nextRunAt: "2026-06-15T18:00:00.000Z",
    });
    const fresh = await store.routineRuns.create({
      routineId: routine.id,
      trigger: "manual",
      scheduledFor: "2026-06-15T12:00:00.000Z",
      status: "queued",
    });
    const scheduler = createScheduler({
      store,
      turns: createTurnCoordinator({ concurrency: 1 }),
      now: () => now,
      executeRun: async () => undefined,
    });
    await scheduler.recover();
    expect((await store.routineRuns.get(fresh.id))?.status).toBe("queued");

    now = new Date("2026-06-15T12:03:00.000Z");
    await scheduler.tick();
    expect((await store.routineRuns.get(fresh.id))?.status).toBe("failed");
    expect((await store.routineRuns.get(fresh.id))?.error).toBe(INTERRUPTED_STOPPED);

    const live = await store.routineRuns.create({
      routineId: routine.id,
      trigger: "manual",
      scheduledFor: "2026-06-15T12:03:00.000Z",
      status: "running",
    });
    await store.routineRuns.update(live.id, {
      leaseOwner: "other-instance",
      leaseExpiresAt: new Date(now.getTime() + 60_000).toISOString(),
    });
    const listener = await store.listeners.create({
      agentId: agent.id,
      name: "Hook",
      kind: "webhook",
      profileId: "mock",
      promptTemplate: "ping",
      secret: "s".repeat(32),
      enabled: true,
    });
    const delivery = await store.listenerDeliveries.create({
      listenerId: listener.id,
      status: "accepted",
      httpStatus: 202,
      payloadBytes: 2,
      payloadPreview: "{}",
    });
    await store.listenerDeliveries.update(delivery.id, {
      leaseOwner: "other-instance",
      leaseExpiresAt: new Date(now.getTime() + 60_000).toISOString(),
    });
    await scheduler.recover();
    expect((await store.routineRuns.get(live.id))?.status).toBe("running");
    expect((await store.listenerDeliveries.get(delivery.id))?.status).toBe("accepted");

    await store.routineRuns.update(live.id, {
      leaseExpiresAt: new Date(now.getTime() - 1000).toISOString(),
    });
    await store.listenerDeliveries.update(delivery.id, {
      leaseExpiresAt: new Date(now.getTime() - 1000).toISOString(),
    });
    await scheduler.tick();
    expect((await store.routineRuns.get(live.id))?.error).toBe(INTERRUPTED_STOPPED);
    expect((await store.listenerDeliveries.get(delivery.id))?.status).toBe("failed");
    const notes = await store.notifications.list();
    expect(notes.some((note) => note.routineRunId === live.id && note.kind === "run_failed")).toBe(true);
    expect(notes.some((note) => note.listenerDeliveryId === delivery.id && note.body === INTERRUPTED_STOPPED)).toBe(
      true,
    );
  });
});

describe("routine API", () => {
  test("scheduler boot is an app option", () => {
    expect(setup().app.scheduleOnBoot).toBe(true);
    expect(setup({}, { scheduler: false }).app.scheduleOnBoot).toBe(false);
  });

  test("requires a session", async () => {
    const { app } = appWith();
    const response = await app.fetch(new Request("http://localhost/api/routines"));
    expect(response.status).toBe(401);
    const preview = await post(app, "/api/routines/preview", { cron: "0 9 * * *", timezone: "UTC" });
    expect(preview.status).toBe(401);
  });

  test("previews the next five runs and rejects a fast cron", async () => {
    const { app } = appWith();
    const { token } = await login(app);
    const ok = await readJson<{ valid: boolean; next: string[] }>(
      await post(app, "/api/routines/preview", { cron: "0 9 * * *", timezone: "UTC" }, token),
    );
    expect(ok.valid).toBe(true);
    expect(ok.next).toHaveLength(5);
    const bad = await readJson<{ valid: boolean; error?: string }>(
      await post(app, "/api/routines/preview", { cron: "* * * * * *", timezone: "UTC" }, token),
    );
    expect(bad.valid).toBe(false);
    expect(bad.error).toMatch(/minute/i);
  });

  test("records a mock run from queued to succeeded and links the chat", async () => {
    const { app } = appWith();
    const { token } = await login(app);
    const agent = await createAgent(app, token, { name: "Ada", toolIds: ["notify_user"] });
    const created = await readJson<{ routine: { id: string; userId: string } }>(
      await post(
        app,
        "/api/routines",
        {
          agentId: agent.id,
          name: "Morning",
          prompt: "Look at the ferns",
          cron: "0 9 * * *",
          timezone: "UTC",
          profileId: "mock",
        },
        token,
      ),
    );
    expect(created.routine.userId).toMatch(/^[0-9a-f-]{36}$/);
    const started = await readJson<{ run: { id: string; status: string } }>(
      await post(app, `/api/routines/${created.routine.id}/run`, {}, token),
    );
    expect(started.run.status === "queued" || started.run.status === "running").toBe(true);
    await app.turns.whenIdle();
    const runs = await readJson<{ runs: { status: string; chatId: string | null; error: string | null }[] }>(
      await app.fetch(new Request(`http://localhost/api/routines/${created.routine.id}/runs`, { headers: bearer(token) })),
    );
    expect(runs.runs[0]).toMatchObject({ status: "succeeded", error: null });
    const chatId = runs.runs[0]?.chatId;
    expect(chatId).toBeTruthy();
    const messages = await readJson<{ messages: { role: string; content: string }[] }>(
      await app.fetch(new Request(`http://localhost/api/chats/${chatId}/messages`, { headers: bearer(token) })),
    );
    expect(messages.messages.some((message) => message.role === "user" && message.content.includes("ferns"))).toBe(true);
    expect(messages.messages.some((message) => message.role === "assistant" && message.content.includes("mock:"))).toBe(true);
    const notes = await readJson<{ notifications: { id: string; kind: string; chatId: string | null }[]; unreadCount: number }>(
      await app.fetch(new Request("http://localhost/api/notifications", { headers: bearer(token) })),
    );
    expect(notes.unreadCount).toBeGreaterThan(0);
    expect(notes.notifications.some((item) => item.kind === "run_succeeded" && item.chatId === chatId)).toBe(true);
    const one = notes.notifications[0];
    expect(one).toBeTruthy();
    const marked = await app.fetch(
      new Request(`http://localhost/api/notifications/${one?.id}/read`, {
        method: "POST",
        headers: bearer(token),
      }),
    );
    expect(marked.status).toBe(200);
    const cleared = await readJson<{ updated: number; unreadCount?: number }>(
      await app.fetch(
        new Request("http://localhost/api/notifications/read-all", { method: "POST", headers: bearer(token) }),
      ),
    );
    expect(cleared.updated).toBeGreaterThanOrEqual(0);
    const after = await readJson<{ unreadCount: number }>(
      await app.fetch(new Request("http://localhost/api/notifications", { headers: bearer(token) })),
    );
    expect(after.unreadCount).toBe(0);
    const notesAgain = await readJson<{ notifications: { userId: string }[] }>(
      await app.fetch(new Request("http://localhost/api/notifications", { headers: bearer(token) })),
    );
    expect(notesAgain.notifications[0]?.userId).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("always-on settings are instance admin routes with defaults and clamping", async () => {
    const { app, store } = appWith();
    const anonymous = await app.fetch(new Request("http://localhost/api/settings/always-on"));
    expect(anonymous.status).toBe(401);
    const { token } = await login(app);
    const defaults = await readJson<{
      settings: {
        schedulerEnabled: boolean;
        schedulerIntervalMs: number;
        backgroundConcurrency: number;
        listenerMaxBytes: number;
      };
    }>(await app.fetch(new Request("http://localhost/api/settings/always-on", { headers: bearer(token) })));
    expect(defaults.settings).toEqual({
      schedulerEnabled: true,
      schedulerIntervalMs: 15_000,
      backgroundConcurrency: 2,
      listenerMaxBytes: 65_536,
    });
    const patched = await readJson<{ settings: { schedulerIntervalMs: number; backgroundConcurrency: number } }>(
      await app.fetch(
        new Request("http://localhost/api/settings/always-on", {
          method: "PATCH",
          headers: { "content-type": "application/json", ...bearer(token) },
          body: JSON.stringify({ schedulerIntervalMs: 10, backgroundConcurrency: 100, schedulerEnabled: false }),
        }),
      ),
    );
    expect(patched.settings.schedulerIntervalMs).toBe(1_000);
    expect(patched.settings.backgroundConcurrency).toBe(32);
    expect((await store.alwaysOnSettings.peek()).schedulerEnabled).toBe(false);
    const rejected = await app.fetch(
      new Request("http://localhost/api/settings/always-on", {
        method: "PATCH",
        headers: { "content-type": "application/json", ...bearer(token) },
        body: JSON.stringify({ schedulerEnabled: "no" }),
      }),
    );
    expect(rejected.status).toBe(400);
  });

  test("records a failed run when the profile call errors", async () => {
    const { app } = setup(
      {
        BOTANICAL_PROFILES: JSON.stringify([
          { id: "mock", name: "Mock", provider: "mock", model: "echo" },
          { id: "grok", name: "Grok", provider: "xai", model: "grok-4" },
        ]),
      },
      {
        fetch: async () => new Response("nope", { status: 500, headers: { "content-type": "application/json" } }),
      },
    );
    const { token } = await login(app);
    const agent = await createAgent(app, token, { name: "Ada" });
    const created = await readJson<{ routine: { id: string } }>(
      await post(
        app,
        "/api/routines",
        {
          agentId: agent.id,
          name: "Broken",
          prompt: "Fail please",
          cron: "0 9 * * *",
          timezone: "UTC",
          profileId: "grok",
        },
        token,
      ),
    );
    await post(app, `/api/routines/${created.routine.id}/run`, {}, token);
    await app.turns.whenIdle();
    const runs = await readJson<{ runs: { status: string; error: string | null; chatId: string | null }[] }>(
      await app.fetch(new Request(`http://localhost/api/routines/${created.routine.id}/runs`, { headers: bearer(token) })),
    );
    expect(runs.runs[0]?.status).toBe("failed");
    expect(runs.runs[0]?.error).toBeTruthy();
    expect(runs.runs[0]?.chatId).toBeTruthy();
    const notes = await readJson<{ notifications: { kind: string }[] }>(
      await app.fetch(new Request("http://localhost/api/notifications", { headers: bearer(token) })),
    );
    expect(notes.notifications.some((item) => item.kind === "run_failed")).toBe(true);
  });

  test("run now works while the routine is paused", async () => {
    const { app } = appWith();
    const { token } = await login(app);
    const agent = await createAgent(app, token, { name: "Ada" });
    const created = await readJson<{ routine: { id: string } }>(
      await post(
        app,
        "/api/routines",
        {
          agentId: agent.id,
          name: "Paused",
          prompt: "Still runs",
          cron: "0 9 * * 1",
          timezone: "UTC",
          profileId: "mock",
          enabled: false,
        },
        token,
      ),
    );
    const response = await post(app, `/api/routines/${created.routine.id}/run`, {}, token);
    expect(response.status).toBe(201);
    await app.turns.whenIdle();
    const runs = await readJson<{ runs: { trigger: string; status: string }[] }>(
      await app.fetch(new Request(`http://localhost/api/routines/${created.routine.id}/runs`, { headers: bearer(token) })),
    );
    expect(runs.runs[0]).toMatchObject({ trigger: "manual", status: "succeeded" });
  });
});
