import { json } from "../http.ts";
import { authed, type Router } from "../router.ts";

export function registerProfiles(router: Router): void {
  router.add(
    "GET",
    "/api/profiles",
    authed((ctx) => {
      return json(200, {
        profiles: ctx.config.profiles.map((profile) => ({
          id: profile.id,
          name: profile.name,
          provider: profile.provider,
          model: profile.model,
          description: profile.description ?? null,
          ...(profile.baseUrl ? { baseUrl: profile.baseUrl } : {}),
          ...(profile.maxTokens !== undefined ? { maxTokens: profile.maxTokens } : {}),
        })),
        defaultProfileId: null,
      });
    }),
  );
}
