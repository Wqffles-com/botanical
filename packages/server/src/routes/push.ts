import { HttpError, isRecord, json, noContent, readJson } from "../http.ts";
import { PUSH_EVENT_KINDS, type PushEvents, type PushService } from "../push/service.ts";
import { authed, type Router } from "../router.ts";

const ENDPOINT_MAX = 2_000;
const KEY_MAX = 500;

export function registerPush(router: Router, push: PushService): void {
  router.add(
    "GET",
    "/api/push",
    authed(async (ctx) => {
      const userId = requireUserId(ctx.user?.id);
      const [publicKey, subscriptions, events] = await Promise.all([
        push.publicKey(),
        push.listSubscriptions(userId),
        push.events(userId),
      ]);
      return json(200, {
        publicKey,
        events,
        subscriptions: subscriptions.map((item) => ({ endpoint: item.endpoint, createdAt: item.createdAt })),
      });
    }),
  );

  router.add(
    "POST",
    "/api/push/subscribe",
    authed(async (ctx) => {
      const userId = requireUserId(ctx.user?.id);
      const body = await readJson(ctx.request, ctx.config);
      if (!isRecord(body) || !isRecord(body.keys)) throw new HttpError(400, "invalid_body", "subscription expected");
      const endpoint = readText(body.endpoint, "endpoint", ENDPOINT_MAX);
      if (!/^https:\/\//.test(endpoint)) throw new HttpError(400, "invalid_body", "endpoint must be an https URL");
      await push.subscribe(
        userId,
        {
          endpoint,
          p256dh: readText(body.keys.p256dh, "keys.p256dh", KEY_MAX),
          auth: readText(body.keys.auth, "keys.auth", KEY_MAX),
        },
        ctx.now,
      );
      return json(201, { subscribed: true });
    }),
  );

  router.add(
    "POST",
    "/api/push/unsubscribe",
    authed(async (ctx) => {
      const userId = requireUserId(ctx.user?.id);
      const body = await readJson(ctx.request, ctx.config);
      if (!isRecord(body)) throw new HttpError(400, "invalid_body", "JSON object expected");
      await push.unsubscribe(userId, readText(body.endpoint, "endpoint", ENDPOINT_MAX));
      return noContent();
    }),
  );

  router.add(
    "PATCH",
    "/api/push/events",
    authed(async (ctx) => {
      const userId = requireUserId(ctx.user?.id);
      const body = await readJson(ctx.request, ctx.config);
      if (!isRecord(body)) throw new HttpError(400, "invalid_body", "JSON object expected");
      const patch: Partial<PushEvents> = {};
      for (const kind of PUSH_EVENT_KINDS) {
        const value = body[kind];
        if (value === undefined) continue;
        if (typeof value !== "boolean") throw new HttpError(400, "invalid_body", `${kind} must be a boolean`);
        patch[kind] = value;
      }
      return json(200, { events: await push.setEvents(userId, patch) });
    }),
  );
}

function requireUserId(id: string | undefined): string {
  if (!id) throw new HttpError(401, "unauthorized", "Authentication required");
  return id;
}

function readText(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    throw new HttpError(400, "invalid_body", `${field} is required`);
  }
  return value;
}
