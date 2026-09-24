import type { ServerConfig } from "./config.ts";
import { HttpError } from "./http.ts";
import type { ModelProfile } from "./types.ts";

export function readRequestedProfileId(value: unknown, required: boolean): string | undefined {
  if (value === undefined) {
    if (required) throw profileRequired();
    return undefined;
  }
  if (typeof value !== "string" || value.trim() === "") {
    throw profileRequired();
  }
  const id = value.trim();
  if (id.length > 64) {
    throw new HttpError(422, "unknown_profile", "Unknown model profile.");
  }
  return id;
}

/**
 * Resolves an explicit profile. `requested` wins over the chat's stored profile.
 * There is no ambient default: an unknown or missing id is an error.
 */
export function resolveProfile(
  config: ServerConfig,
  requested: string | undefined,
  fallbackId: string | undefined,
): ModelProfile {
  if (config.profiles.length === 0) {
    throw new HttpError(
      422,
      "no_profiles_configured",
      "No model profiles are configured. There is no default model.",
    );
  }
  const id = requested ?? fallbackId;
  if (!id) throw profileRequired();
  const profile = config.profiles.find((item) => item.id === id);
  if (!profile) {
    throw new HttpError(
      422,
      "unknown_profile",
      "Unknown model profile. Choose one from GET /api/profiles. There is no default model.",
    );
  }
  return profile;
}

function profileRequired(): HttpError {
  return new HttpError(
    422,
    "profile_required",
    "Choose a model profile. Botanical has no default model.",
  );
}
