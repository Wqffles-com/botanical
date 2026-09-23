import { json } from "../http.ts";
import { authed, type Router } from "../router.ts";

export function registerProfiles(router: Router): void {
  router.add(
    "GET",
    "/api/profiles",
    authed((ctx) => {
      return json(200, {
        profiles: ctx.config.profiles.map((profile) => ({ ...profile })),
        defaultProfileId: null,
      });
    }),
  );
}
