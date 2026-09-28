import type { ServerConfig } from "../config.ts";
import { HttpError, isRecord, json, noContent, readJson } from "../http.ts";
import { payloadPreview, readLimitedBytes } from "../listeners/body.ts";
import { isListenerKind, listenerHandler } from "../listeners/kinds.ts";
import type { SlidingWindowLimiter } from "../listeners/limit.ts";
import { generateListenerSecret } from "../listeners/verify.ts";
import { readRequestedProfileId, resolveProfile } from "../profiles.ts";
import type { createBackgroundJobs } from "../runtime/jobs.ts";
import { authed, type Router } from "../router.ts";
import type { Listener, Store } from "../types.ts";
import { LIMITS, readBoundedString, readRequiredId, requireParam } from "../validate.ts";
import { readPage } from "./routines.ts";

type Jobs = ReturnType<typeof createBackgroundJobs>;

const TEMPLATE_MAX = 20_000;

export function registerListeners(router: Router): void {
  router.add(
    "GET",
    "/api/listeners",
    authed(async (ctx) => {
      const agentId = ctx.url.searchParams.get("agentId");
      if (agentId !== null && (agentId.trim() === "" || agentId.length > LIMITS.id)) {
        throw new HttpError(400, "invalid_query", "agentId is invalid");
      }
      const rows = await ctx.store.listeners.list(agentId ? { agentId: agentId.trim() } : undefined);
      const origin = publicOrigin(ctx.config, ctx.url);
      return json(200, { listeners: rows.map((row) => presentListener(row, origin)) });
    }),
  );

  router.add(
    "POST",
    "/api/listeners",
    authed(async (ctx) => {
      const input = await readListenerBody(ctx.store, ctx.config, ctx.request);
      const secret = generateListenerSecret();
      const listener = await ctx.store.listeners.create({ ...input, secret });
      const origin = publicOrigin(ctx.config, ctx.url);
      return json(201, {
        listener: presentListener(listener, origin),
        secret,
        url: hookUrl(origin, listener.id),
      });
    }),
  );

  router.add(
    "GET",
    "/api/listeners/:id",
    authed(async (ctx) => {
      const listener = await loadListener(ctx.store, requireParam(ctx.params, "id"));
      return json(200, { listener: presentListener(listener, publicOrigin(ctx.config, ctx.url)) });
    }),
  );

  router.add(
    "PATCH",
    "/api/listeners/:id",
    authed(async (ctx) => {
      const existing = await loadListener(ctx.store, requireParam(ctx.params, "id"));
      const patch = await readListenerPatch(ctx.config, ctx.request);
      const listener = await ctx.store.listeners.update(existing.id, patch);
      if (!listener) throw new HttpError(404, "not_found", "Listener not found");
      return json(200, { listener: presentListener(listener, publicOrigin(ctx.config, ctx.url)) });
    }),
  );

  router.add(
    "DELETE",
    "/api/listeners/:id",
    authed(async (ctx) => {
      const existing = await loadListener(ctx.store, requireParam(ctx.params, "id"));
      await ctx.store.listeners.delete(existing.id);
      return noContent();
    }),
  );

  router.add(
    "POST",
    "/api/listeners/:id/rotate-secret",
    authed(async (ctx) => {
      const existing = await loadListener(ctx.store, requireParam(ctx.params, "id"));
      const secret = generateListenerSecret();
      const listener = await ctx.store.listeners.setSecret(existing.id, secret);
      if (!listener) throw new HttpError(404, "not_found", "Listener not found");
      const origin = publicOrigin(ctx.config, ctx.url);
      return json(200, { secret, url: hookUrl(origin, listener.id) });
    }),
  );

  router.add(
    "GET",
    "/api/listeners/:id/deliveries",
    authed(async (ctx) => {
      const existing = await loadListener(ctx.store, requireParam(ctx.params, "id"));
      const deliveries = await ctx.store.listenerDeliveries.list(existing.id, readPage(ctx.url));
      return json(200, { deliveries });
    }),
  );
}

/**
 * Public webhook. Not wrapped in `authed`: the listener secret authenticates the caller.
 * Unknown listeners and bad signatures share one 401 body.
 */
export function registerHooks(
  router: Router,
  deps: { jobs: Jobs; limiter: SlidingWindowLimiter },
): void {
  router.add("POST", "/api/hooks/:listenerId", async (ctx) => {
    const id = requireParam(ctx.params, "listenerId");
    const settings = await ctx.store.alwaysOnSettings.get();
    const limited = await readLimitedBytes(ctx.request, settings.listenerMaxBytes);
    const listener = await ctx.store.listeners.get(id);
    if (!limited.ok) {
      if (listener) {
        await ctx.store.listenerDeliveries.create({
          listenerId: listener.id,
          status: "rejected",
          httpStatus: 413,
          error: "Payload too large",
          payloadBytes: settings.listenerMaxBytes + 1,
          payloadPreview: "",
        });
      }
      throw new HttpError(413, "payload_too_large", "Request body is too large");
    }
    if (!listener) throw new HttpError(401, "unauthorized", "Unauthorized");
    if (!deps.limiter.allow(listener.id)) {
      await reject(ctx.store, listener.id, 429, limited.bytes, "Too many requests");
      throw new HttpError(429, "rate_limited", "Too many requests");
    }
    const handler = listenerHandler(listener.kind);
    const verified =
      handler?.verify({ headers: ctx.request.headers, rawBody: limited.bytes, secret: listener.secret }) ?? false;
    if (!verified) {
      await reject(ctx.store, listener.id, 401, limited.bytes, "Unauthorized");
      throw new HttpError(401, "unauthorized", "Unauthorized");
    }
    if (!listener.enabled) {
      await reject(ctx.store, listener.id, 403, limited.bytes, "Listener is disabled");
      throw new HttpError(403, "forbidden", "Listener is disabled");
    }
    const delivery = await ctx.store.listenerDeliveries.create({
      listenerId: listener.id,
      status: "accepted",
      httpStatus: 202,
      payloadBytes: limited.bytes.byteLength,
      payloadPreview: payloadPreview(limited.bytes),
    });
    const text = new TextDecoder("utf-8", { fatal: false }).decode(limited.bytes);
    void deps.jobs.executeListenerDelivery(delivery.id, text);
    return json(202, { deliveryId: delivery.id });
  });
}

async function reject(
  store: Store,
  listenerId: string,
  httpStatus: number,
  bytes: Uint8Array,
  error: string,
): Promise<void> {
  await store.listenerDeliveries.create({
    listenerId,
    status: "rejected",
    httpStatus,
    error,
    payloadBytes: bytes.byteLength,
    payloadPreview: payloadPreview(bytes),
  });
}

function presentListener(listener: Listener, origin: string) {
  return {
    id: listener.id,
    userId: listener.userId,
    agentId: listener.agentId,
    name: listener.name,
    kind: listener.kind,
    profileId: listener.profileId,
    promptTemplate: listener.promptTemplate,
    enabled: listener.enabled,
    createdAt: listener.createdAt,
    updatedAt: listener.updatedAt,
    url: hookUrl(origin, listener.id),
  };
}

export function hookUrl(origin: string, id: string): string {
  return `${origin.replace(/\/$/, "")}/api/hooks/${id}`;
}

export function publicOrigin(config: ServerConfig, url: URL): string {
  return config.publicOrigin ?? url.origin;
}

async function loadListener(store: Store, id: string): Promise<Listener> {
  const listener = await store.listeners.get(id);
  if (!listener) throw new HttpError(404, "not_found", "Listener not found");
  return listener;
}

async function readListenerBody(store: Store, config: ServerConfig, request: Request) {
  const body = await readJson(request, config);
  if (!isRecord(body)) throw new HttpError(400, "invalid_body", "JSON object expected");
  const agentId = readRequiredId(body.agentId, "agentId");
  const agent = await store.agents.get(agentId);
  if (!agent) throw new HttpError(404, "not_found", "Agent not found");
  const name = readBoundedString(body.name, "name", { required: true, max: LIMITS.name });
  if (!name) throw new HttpError(400, "invalid_body", "name is required");
  const kind = body.kind === undefined ? "webhook" : readBoundedString(body.kind, "kind", { required: true, max: 40 });
  if (!kind || !isListenerKind(kind)) {
    throw new HttpError(400, "invalid_body", "kind must be webhook");
  }
  const profile = resolveProfile(config, readRequestedProfileId(body.profileId, true), undefined);
  const promptTemplate =
    body.promptTemplate === undefined
      ? ""
      : (readBoundedString(body.promptTemplate, "promptTemplate", { required: false, max: TEMPLATE_MAX }) ?? "");
  const enabled = readOptionalBoolean(body.enabled, "enabled") ?? true;
  return { agentId: agent.id, name, kind, profileId: profile.id, promptTemplate, enabled };
}

async function readListenerPatch(config: ServerConfig, request: Request) {
  const body = await readJson(request, config);
  if (!isRecord(body)) throw new HttpError(400, "invalid_body", "JSON object expected");
  const patch: { name?: string; profileId?: string; promptTemplate?: string; enabled?: boolean } = {};
  if (body.name !== undefined) {
    const name = readBoundedString(body.name, "name", { required: true, max: LIMITS.name });
    if (!name) throw new HttpError(400, "invalid_body", "name is required");
    patch.name = name;
  }
  if (body.profileId !== undefined) {
    patch.profileId = resolveProfile(config, readRequestedProfileId(body.profileId, true), undefined).id;
  }
  if (body.promptTemplate !== undefined) {
    patch.promptTemplate =
      readBoundedString(body.promptTemplate, "promptTemplate", { required: false, max: TEMPLATE_MAX }) ?? "";
  }
  if (body.enabled !== undefined) {
    const enabled = readOptionalBoolean(body.enabled, "enabled");
    if (enabled === undefined) throw new HttpError(400, "invalid_body", "enabled must be a boolean");
    patch.enabled = enabled;
  }
  return patch;
}

function readOptionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new HttpError(400, "invalid_body", `${field} must be a boolean`);
  return value;
}
