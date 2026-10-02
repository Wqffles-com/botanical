import { HttpError, isRecord, json, readJson } from "../http.ts";
import { adminOnly, authed, type Router } from "../router.ts";
import { DEFAULT_PRICES, PRICE_OVERRIDES_PREF, isModelPrice, parsePriceOverrides } from "../usage/prices.ts";
import { buildUsageReport } from "../usage/report.ts";

const DAY_MS = 86_400_000;
const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;

export function registerUsage(router: Router): void {
  router.add(
    "GET",
    "/api/usage",
    authed(async (ctx) => {
      const days = readDays(ctx.url.searchParams.get("days"));
      const scope = ctx.url.searchParams.get("scope") ?? "own";
      if (scope !== "own" && scope !== "all") throw new HttpError(400, "invalid_query", "scope must be own or all");
      if (scope === "all" && ctx.user?.role !== "admin") throw new HttpError(403, "forbidden", "Admin only");

      const until = new Date(Math.floor(ctx.now.getTime() / DAY_MS + 1) * DAY_MS);
      const since = new Date(until.getTime() - days * DAY_MS);
      const events = await ctx.store.usage.list({
        since: since.toISOString(),
        until: until.toISOString(),
        ...(scope === "all" ? { allUsers: true } : {}),
      });

      const [agents, profiles] = await Promise.all([ctx.store.agents.list(), ctx.store.profiles.list()]);
      const users = new Map<string, string>();
      if (scope === "all") {
        for (const id of new Set(events.map((event) => event.userId))) {
          const user = await ctx.store.accounts.findById(id);
          if (user) users.set(id, user.displayName || user.email);
        }
      }
      const overrides = parsePriceOverrides(await ctx.store.prefs.getGlobal(PRICE_OVERRIDES_PREF));
      const report = buildUsageReport(
        events,
        { since: since.toISOString(), until: until.toISOString() },
        overrides,
        {
          agents: new Map(agents.map((agent) => [agent.id, agent.name])),
          profiles: new Map(profiles.map((profile) => [profile.id, profile.name])),
          users,
        },
      );
      return json(200, { scope, days, report, prices: { defaults: DEFAULT_PRICES, overrides } });
    }),
  );

  router.add(
    "PUT",
    "/api/admin/usage/prices",
    adminOnly(async (ctx) => {
      const body = await readJson(ctx.request, ctx.config);
      if (!isRecord(body) || !isRecord(body.overrides)) {
        throw new HttpError(400, "invalid_body", "overrides must be an object of model prefix to price");
      }
      for (const [key, value] of Object.entries(body.overrides)) {
        if (!key.trim() || !isModelPrice(value)) {
          throw new HttpError(
            400,
            "invalid_body",
            `Price for ${JSON.stringify(key)} needs inputPerMTok and outputPerMTok, each a number from 0 to 100000`,
          );
        }
      }
      const overrides = parsePriceOverrides(body.overrides);
      await ctx.store.prefs.setGlobal(PRICE_OVERRIDES_PREF, overrides);
      return json(200, { prices: { defaults: DEFAULT_PRICES, overrides } });
    }),
  );
}

function readDays(raw: string | null): number {
  if (raw === null) return DEFAULT_DAYS;
  const days = Number(raw);
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
    throw new HttpError(400, "invalid_query", `days must be a whole number from 1 to ${MAX_DAYS}`);
  }
  return days;
}
