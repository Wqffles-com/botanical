import { ACCENT_SETTING_KEY, DEFAULT_ACCENT, normalizeAccent } from "@botanical/core";

import { HttpError, isRecord, json, readJson } from "../http.ts";
import { authed, type Router } from "../router.ts";
import { readAccent } from "../validate.ts";

/**
 * Per-user accent. Neutral leaves the monochrome primary in place.
 * Stored on `user_settings` as `appearance.accent`.
 */
export function registerAppearance(router: Router): void {
  router.add(
    "GET",
    "/api/settings/appearance",
    authed(async (ctx) => {
      const userId = ctx.user?.id;
      if (!userId) throw new HttpError(401, "unauthorized", "Authentication required");
      const stored = await ctx.store.prefs.getUser(userId, ACCENT_SETTING_KEY);
      return json(200, { accent: normalizeAccent(stored) });
    }),
  );

  router.add(
    "PATCH",
    "/api/settings/appearance",
    authed(async (ctx) => {
      const userId = ctx.user?.id;
      if (!userId) throw new HttpError(401, "unauthorized", "Authentication required");
      const body = await readJson(ctx.request, ctx.config);
      if (!isRecord(body)) throw new HttpError(400, "invalid_body", "JSON object expected");
      if (!Object.prototype.hasOwnProperty.call(body, "accent")) {
        throw new HttpError(400, "invalid_body", "accent is required");
      }
      const accent = readAccent(body.accent);
      if (accent === DEFAULT_ACCENT) {
        await ctx.store.prefs.deleteUser(userId, ACCENT_SETTING_KEY);
      } else {
        await ctx.store.prefs.setUser(userId, ACCENT_SETTING_KEY, accent);
      }
      return json(200, { accent });
    }),
  );
}
