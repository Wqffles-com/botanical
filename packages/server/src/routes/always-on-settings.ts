import { AlwaysOnSettingsError, type AlwaysOnSettingsPatch } from "@botanical/db";
import { HttpError, isRecord, json, readJson } from "../http.ts";
import { authed, type Router } from "../router.ts";

/**
 * Instance-admin settings for background work.
 * Passcode-gated with the other operator routes today.
 * When accounts land, restrict this route to admins. It is not a per-user setting.
 */
export function registerAlwaysOnSettings(router: Router): void {
  router.add(
    "GET",
    "/api/settings/always-on",
    authed(async (ctx) => {
      const settings = await ctx.store.alwaysOnSettings.get();
      return json(200, { settings });
    }),
  );

  router.add(
    "PATCH",
    "/api/settings/always-on",
    authed(async (ctx) => {
      const body = await readJson(ctx.request, ctx.config);
      if (!isRecord(body)) throw new HttpError(400, "invalid_body", "JSON object expected");
      try {
        const settings = await ctx.store.alwaysOnSettings.update(readPatch(body));
        return json(200, { settings });
      } catch (error) {
        if (error instanceof AlwaysOnSettingsError) {
          throw new HttpError(400, "invalid_body", error.message);
        }
        throw error;
      }
    }),
  );
}

function readPatch(body: Record<string, unknown>): AlwaysOnSettingsPatch {
  const patch: AlwaysOnSettingsPatch = {};
  if ("schedulerEnabled" in body) patch.schedulerEnabled = body.schedulerEnabled as boolean;
  if ("schedulerIntervalMs" in body) patch.schedulerIntervalMs = body.schedulerIntervalMs as number;
  if ("backgroundConcurrency" in body) patch.backgroundConcurrency = body.backgroundConcurrency as number;
  if ("listenerMaxBytes" in body) patch.listenerMaxBytes = body.listenerMaxBytes as number;
  return patch;
}
