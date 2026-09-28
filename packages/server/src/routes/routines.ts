import type { ServerConfig } from "../config.ts";
import { HttpError, isRecord, json, noContent, readJson } from "../http.ts";
import { readRequestedProfileId, resolveProfile } from "../profiles.ts";
import { checkSchedule, nextFutureSlot, normalizeCron } from "../routines/cron.ts";
import type { createBackgroundJobs } from "../runtime/jobs.ts";
import { authed, type Router } from "../router.ts";
import type { Routine, Store } from "../types.ts";
import { LIMITS, readBoundedString, readRequiredId, requireParam } from "../validate.ts";

type Jobs = ReturnType<typeof createBackgroundJobs>;

export function registerRoutines(router: Router, jobs: Jobs): void {
  router.add(
    "GET",
    "/api/routines",
    authed(async (ctx) => {
      const agentId = readOptionalAgentFilter(ctx.url);
      const routines = await ctx.store.routines.list(agentId ? { agentId } : undefined);
      const views = await Promise.all(routines.map((routine) => withLastRun(ctx.store, routine)));
      return json(200, { routines: views });
    }),
  );

  router.add(
    "POST",
    "/api/routines/preview",
    authed(async (ctx) => {
      const body = await readJson(ctx.request, ctx.config);
      if (!isRecord(body)) throw new HttpError(400, "invalid_body", "JSON object expected");
      const cron = readBoundedString(body.cron, "cron", { required: true, max: 80 }) ?? "";
      const timezone = readBoundedString(body.timezone, "timezone", { required: true, max: 120 }) ?? "";
      const checked = checkSchedule(normalizeCron(cron), timezone, ctx.now, 5);
      if (!checked.ok) return json(200, { valid: false, error: checked.error ?? "Invalid schedule", next: [] });
      return json(200, { valid: true, next: checked.next });
    }),
  );

  router.add(
    "POST",
    "/api/routines",
    authed(async (ctx) => {
      const input = await readRoutineBody(ctx.store, ctx.config, ctx.request, ctx.now);
      const routine = await ctx.store.routines.create(input);
      return json(201, { routine: await withLastRun(ctx.store, routine) });
    }),
  );

  router.add(
    "GET",
    "/api/routines/:id",
    authed(async (ctx) => {
      const routine = await loadRoutine(ctx.store, requireParam(ctx.params, "id"));
      return json(200, { routine: await withLastRun(ctx.store, routine) });
    }),
  );

  router.add(
    "PATCH",
    "/api/routines/:id",
    authed(async (ctx) => {
      const existing = await loadRoutine(ctx.store, requireParam(ctx.params, "id"));
      const patch = await readRoutinePatch(ctx.store, ctx.config, ctx.request, ctx.now, existing);
      const routine = await ctx.store.routines.update(existing.id, patch);
      if (!routine) throw new HttpError(404, "not_found", "Routine not found");
      return json(200, { routine: await withLastRun(ctx.store, routine) });
    }),
  );

  router.add(
    "DELETE",
    "/api/routines/:id",
    authed(async (ctx) => {
      const existing = await loadRoutine(ctx.store, requireParam(ctx.params, "id"));
      await ctx.store.routines.delete(existing.id);
      return noContent();
    }),
  );

  router.add(
    "POST",
    "/api/routines/:id/pause",
    authed(async (ctx) => {
      const existing = await loadRoutine(ctx.store, requireParam(ctx.params, "id"));
      const routine = await ctx.store.routines.update(existing.id, { enabled: false });
      if (!routine) throw new HttpError(404, "not_found", "Routine not found");
      return json(200, { routine: await withLastRun(ctx.store, routine) });
    }),
  );

  router.add(
    "POST",
    "/api/routines/:id/resume",
    authed(async (ctx) => {
      const existing = await loadRoutine(ctx.store, requireParam(ctx.params, "id"));
      const nextRunAt = nextFutureSlot(existing, ctx.now).toISOString();
      const routine = await ctx.store.routines.update(existing.id, { enabled: true, nextRunAt });
      if (!routine) throw new HttpError(404, "not_found", "Routine not found");
      return json(200, { routine: await withLastRun(ctx.store, routine) });
    }),
  );

  router.add(
    "POST",
    "/api/routines/:id/run",
    authed(async (ctx) => {
      const existing = await loadRoutine(ctx.store, requireParam(ctx.params, "id"));
      const run = await ctx.store.routineRuns.create({
        routineId: existing.id,
        trigger: "manual",
        scheduledFor: ctx.now.toISOString(),
        status: "queued",
      });
      void jobs.executeRoutineRun(run.id);
      return json(201, { run });
    }),
  );

  router.add(
    "GET",
    "/api/routines/:id/runs",
    authed(async (ctx) => {
      const existing = await loadRoutine(ctx.store, requireParam(ctx.params, "id"));
      const page = readPage(ctx.url);
      const runs = await ctx.store.routineRuns.list(existing.id, page);
      return json(200, { runs });
    }),
  );
}

async function withLastRun(store: Store, routine: Routine) {
  const lastRun = await store.routineRuns.latest(routine.id);
  return { ...routine, lastRun };
}

async function loadRoutine(store: Store, id: string): Promise<Routine> {
  const routine = await store.routines.get(id);
  if (!routine) throw new HttpError(404, "not_found", "Routine not found");
  return routine;
}

async function readRoutineBody(
  store: Store,
  config: ServerConfig,
  request: Request,
  now: Date,
): Promise<{
  agentId: string;
  name: string;
  prompt: string;
  cron: string;
  timezone: string;
  profileId: string;
  enabled: boolean;
  nextRunAt: string;
}> {
  const body = await readJson(request, config);
  if (!isRecord(body)) throw new HttpError(400, "invalid_body", "JSON object expected");
  const agentId = readRequiredId(body.agentId, "agentId");
  const agent = await store.agents.get(agentId);
  if (!agent) throw new HttpError(404, "not_found", "Agent not found");
  const name = readBoundedString(body.name, "name", { required: true, max: LIMITS.name });
  const prompt = readBoundedString(body.prompt, "prompt", { required: true, max: LIMITS.content });
  if (!name || !prompt) throw new HttpError(400, "invalid_body", "name and prompt are required");
  const cron = normalizeCron(readBoundedString(body.cron, "cron", { required: true, max: 80 }) ?? "");
  const timezone = readBoundedString(body.timezone, "timezone", { required: true, max: 120 }) ?? "";
  const profile = resolveProfile(config, readRequestedProfileId(body.profileId, true), undefined);
  const enabled = readOptionalBoolean(body.enabled, "enabled") ?? true;
  const checked = checkSchedule(cron, timezone, now, 1);
  if (!checked.ok || !checked.next[0]) {
    throw new HttpError(400, "invalid_body", checked.error ?? "Invalid schedule");
  }
  return {
    agentId: agent.id,
    name,
    prompt,
    cron,
    timezone,
    profileId: profile.id,
    enabled,
    nextRunAt: checked.next[0],
  };
}

async function readRoutinePatch(
  store: Store,
  config: ServerConfig,
  request: Request,
  now: Date,
  existing: Routine,
): Promise<Partial<Routine> & { nextRunAt?: string }> {
  void store;
  const body = await readJson(request, config);
  if (!isRecord(body)) throw new HttpError(400, "invalid_body", "JSON object expected");
  const patch: {
    name?: string;
    prompt?: string;
    cron?: string;
    timezone?: string;
    profileId?: string;
    enabled?: boolean;
    nextRunAt?: string;
  } = {};
  if (body.name !== undefined) {
    const name = readBoundedString(body.name, "name", { required: true, max: LIMITS.name });
    if (!name) throw new HttpError(400, "invalid_body", "name is required");
    patch.name = name;
  }
  if (body.prompt !== undefined) {
    const prompt = readBoundedString(body.prompt, "prompt", { required: true, max: LIMITS.content });
    if (!prompt) throw new HttpError(400, "invalid_body", "prompt is required");
    patch.prompt = prompt;
  }
  if (body.profileId !== undefined) {
    patch.profileId = resolveProfile(config, readRequestedProfileId(body.profileId, true), undefined).id;
  }
  if (body.enabled !== undefined) patch.enabled = readOptionalBoolean(body.enabled, "enabled") ?? existing.enabled;
  const cron = body.cron === undefined ? existing.cron : normalizeCron(readBoundedString(body.cron, "cron", { required: true, max: 80 }) ?? "");
  const timezone =
    body.timezone === undefined
      ? existing.timezone
      : (readBoundedString(body.timezone, "timezone", { required: true, max: 120 }) ?? "");
  if (body.cron !== undefined) patch.cron = cron;
  if (body.timezone !== undefined) patch.timezone = timezone;
  const scheduleChanged = body.cron !== undefined || body.timezone !== undefined;
  const resuming = patch.enabled === true && !existing.enabled;
  if (scheduleChanged || resuming) {
    const checked = checkSchedule(cron, timezone, now, 1);
    if (!checked.ok || !checked.next[0]) {
      throw new HttpError(400, "invalid_body", checked.error ?? "Invalid schedule");
    }
    patch.nextRunAt = checked.next[0];
  }
  return patch;
}

function readOptionalAgentFilter(url: URL): string | null {
  const agentId = url.searchParams.get("agentId");
  if (agentId === null) return null;
  if (agentId.trim() === "" || agentId.length > LIMITS.id) {
    throw new HttpError(400, "invalid_query", "agentId is invalid");
  }
  return agentId.trim();
}

function readOptionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new HttpError(400, "invalid_body", `${field} must be a boolean`);
  return value;
}

export function readPage(url: URL): { limit: number; offset: number } {
  return {
    limit: readQueryInt(url.searchParams.get("limit"), 20, 100),
    offset: readQueryInt(url.searchParams.get("offset"), 0, 10_000),
  };
}

function readQueryInt(value: string | null, fallback: number, max: number): number {
  if (value === null || value.trim() === "") return fallback;
  if (!/^\d+$/.test(value.trim())) throw new HttpError(400, "invalid_query", "limit and offset must be integers");
  return Math.min(max, Number(value.trim()));
}
