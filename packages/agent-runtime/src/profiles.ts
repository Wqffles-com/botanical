import { ProfileNotFoundError } from "./errors";
import type { LLMProvider } from "./provider";

export interface ProfileSummary {
  id: string;
  providerId: string;
  model: string;
}

export interface ResolvedProfile {
  profileId: string;
  providerId: string;
  provider: LLMProvider;
  model: string;
}

export interface ProfileResolver {
  resolve(profileId: string): Promise<ResolvedProfile>;
  list(): Promise<ProfileSummary[]>;
}

export function staticProfileResolver(
  profiles: Record<string, { provider: LLMProvider; model: string; providerId?: string }>,
): ProfileResolver {
  const entries = Object.entries(profiles);
  return {
    async list() {
      return entries.map(([id, profile]) => ({
        id,
        providerId: profile.providerId ?? profile.provider.id,
        model: profile.model,
      }));
    },
    async resolve(profileId: string) {
      const profile = profiles[profileId];
      if (!profile) throw new ProfileNotFoundError(profileId);
      return {
        profileId,
        providerId: profile.providerId ?? profile.provider.id,
        provider: profile.provider,
        model: profile.model,
      };
    },
  };
}
