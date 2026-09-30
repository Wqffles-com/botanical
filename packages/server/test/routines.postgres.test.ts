import { describe, expect, test } from "bun:test";

import { loadConfig } from "../src/config.ts";
import { defaultProviderFetch, ECHO_PROFILE } from "./helpers.ts";
import { createStore } from "../src/db/store.ts";
import { createScheduler } from "../src/routines/scheduler.ts";
import { createTurnCoordinator } from "../src/runtime/turns.ts";

const baseUrl = process.env.BOTANICAL_TEST_DATABASE_URL;
const integration = baseUrl ? test : test.skip;

function withDatabase(connectionString: string, name: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${name}`;
  return url.toString();
}

describe("postgres routine claim", () => {
  integration("claims a due slot once, catch-up once, skips paused, and fails stale runs", async () => {
    if (!baseUrl) throw new Error("BOTANICAL_TEST_DATABASE_URL is required");
    const databaseUrl = withDatabase(baseUrl, "botanical_routines_claim");
    const config = loadConfig({
      BOTANICAL_PASSWORD: "correct horse",
      DATABASE_URL: databaseUrl,
      BOTANICAL_PROFILES: JSON.stringify([ECHO_PROFILE]),
      XAI_API_KEY: "test-xai-key",
    }, { fetch: defaultProviderFetch });
    const store = await createStore(config);
    try {
      for (const routine of await store.routines.list()) await store.routines.delete(routine.id);
      for (const listener of await store.listeners.list()) await store.listeners.delete(listener.id);
      await store.alwaysOnSettings.update({
        schedulerEnabled: true,
        schedulerIntervalMs: 15_000,
        backgroundConcurrency: 2,
        listenerMaxBytes: 65_536,
      });
      const agent = await store.agents.create({
        name: "Ada",
        description: "Test",
        systemPrompt: "Help",
        toolIds: [],
      });
      const now = new Date("2026-06-15T12:30:00.000Z");
      const due = await store.routines.create({
        agentId: agent.id,
        name: "Hourly",
        prompt: "Check",
        cron: "0 * * * *",
        timezone: "UTC",
        profileId: "echo",
        enabled: true,
        nextRunAt: "2026-06-15T07:00:00.000Z",
      });
      const paused = await store.routines.create({
        agentId: agent.id,
        name: "Paused",
        prompt: "No",
        cron: "0 * * * *",
        timezone: "UTC",
        profileId: "echo",
        enabled: false,
        nextRunAt: "2026-06-15T07:00:00.000Z",
      });
      const stale = await store.routineRuns.create({
        routineId: due.id,
        trigger: "manual",
        scheduledFor: "2026-06-15T06:00:00.000Z",
        status: "running",
      });
      await store.routineRuns.update(stale.id, {
        leaseOwner: "dead-process",
        leaseExpiresAt: "2026-06-15T12:00:00.000Z",
      });
      const live = await store.routineRuns.create({
        routineId: due.id,
        trigger: "manual",
        scheduledFor: "2026-06-15T06:30:00.000Z",
        status: "running",
      });
      await store.routineRuns.update(live.id, {
        leaseOwner: "live-process",
        leaseExpiresAt: "2026-06-15T12:32:00.000Z",
      });
      const turns = createTurnCoordinator({ concurrency: 2 });
      const make = () =>
        createScheduler({
          store,
          turns,
          now: () => now,
          executeRun: async () => undefined,
        });
      await make().recover();
      expect((await store.routineRuns.get(stale.id))?.status).toBe("failed");
      expect((await store.routineRuns.get(stale.id))?.error).toBe("interrupted: server stopped");
      expect((await store.routineRuns.get(live.id))?.status).toBe("running");
      const notes = await store.notifications.list();
      expect(notes.some((note) => note.routineRunId === stale.id && note.kind === "run_failed")).toBe(true);

      await Promise.all([make().tick(), make().tick()]);
      const runs = (await store.routineRuns.list(due.id)).filter((run) => run.trigger === "schedule");
      expect(runs).toHaveLength(1);
      expect(runs[0]?.scheduledFor).toBe("2026-06-15T07:00:00.000Z");
      expect((await store.routines.get(due.id))?.nextRunAt).toBe("2026-06-15T13:00:00.000Z");
      expect(await store.routineRuns.list(paused.id)).toHaveLength(0);
      await Promise.all([make().tick(), make().tick()]);
      const again = (await store.routineRuns.list(due.id)).filter((run) => run.trigger === "schedule");
      expect(again).toHaveLength(1);
      expect(due.userId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      expect(paused.userId).toBe(due.userId);

      const tuned = await store.alwaysOnSettings.update({
        schedulerEnabled: false,
        schedulerIntervalMs: 10,
        backgroundConcurrency: 100,
        listenerMaxBytes: 0,
      });
      expect(tuned).toMatchObject({
        schedulerEnabled: false,
        schedulerIntervalMs: 1_000,
        backgroundConcurrency: 32,
        listenerMaxBytes: 1,
      });
      const quiet = await store.routines.create({
        agentId: agent.id,
        name: "Quiet",
        prompt: "No",
        cron: "0 * * * *",
        timezone: "UTC",
        profileId: "echo",
        enabled: true,
        nextRunAt: "2026-06-15T12:00:00.000Z",
      });
      expect(quiet.userId).toBe(due.userId);
      await make().tick();
      expect(await store.routineRuns.list(quiet.id)).toHaveLength(0);
      await expect(store.alwaysOnSettings.update({ schedulerEnabled: "no" as unknown as boolean })).rejects.toThrow(
        /boolean/,
      );
    } finally {
      await store.close();
    }
  });
});
