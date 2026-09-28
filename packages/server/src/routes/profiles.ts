import { userCliAvailability } from "../cli-install/service.ts";
import { HttpError, json } from "../http.ts";
import { authed, type Router } from "../router.ts";
import type { ModelProfile } from "../types.ts";

export function registerProfiles(router: Router): void {
  router.add(
    "GET",
    "/api/profiles",
    authed(async (ctx) => {
      const profiles = [];
      for (const profile of await ctx.store.profiles.list()) {
        profiles.push(await presentProfile(profile));
      }
      return json(200, { profiles, defaultProfileId: null });
    }),
  );
}

export async function presentProfile(profile: ModelProfile) {
  const kind = profile.kind ?? (profile.provider === "cli" ? "cli" : "api");
  let available = true;
  let unavailableReason: string | undefined;
  if (kind === "cli" && profile.cli) {
    const status = await cliStatus(profile, profile.cli);
    available = status.available;
    unavailableReason = status.unavailableReason;
  }
  return {
    id: profile.id,
    name: profile.name,
    provider: profile.provider,
    model: profile.model,
    description: profile.description ?? null,
    kind,
    available,
    ...(available ? {} : { unavailableReason: unavailableReason ?? "CLI profile is unavailable" }),
    ...(profile.cli ? { cli: profile.cli } : {}),
    ...(profile.baseUrl ? { baseUrl: profile.baseUrl } : {}),
    ...(profile.maxTokens !== undefined ? { maxTokens: profile.maxTokens } : {}),
  };
}

export async function assertCliProfileReady(profile: ModelProfile): Promise<void> {
  if ((profile.kind ?? (profile.provider === "cli" ? "cli" : "api")) !== "cli" || !profile.cli) return;
  const status = await cliStatus(profile, profile.cli);
  if (!status.available) {
    throw new HttpError(422, "profile_unavailable", status.unavailableReason ?? "CLI profile is unavailable");
  }
}

/** Checked against the acting user's CLI home, where settings-panel logins land. */
async function cliStatus(profile: ModelProfile, cli: NonNullable<ModelProfile["cli"]>) {
  return (await userCliAvailability({ cli, ...(profile.bin ? { bin: profile.bin } : {}) })).status;
}
