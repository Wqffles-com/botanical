import { profileIsAvailable, profileKind } from "./format";
import { providerLabel } from "./format-extra";

/** The profile fields the provider and model pickers read. `ModelProfile` and `ProfileInfo` both fit. */
export type PickableProfile = {
  id: string;
  name: string;
  provider: string;
  model: string;
  kind?: string | null;
  available?: boolean | null;
  unavailableReason?: string | null;
  cli?: string | null;
  defaultModel?: boolean | null;
};

export type ProviderGroup<P extends PickableProfile = PickableProfile> = {
  key: string;
  label: string;
  kind: "api" | "cli";
  profiles: P[];
  available: boolean;
  unavailableReason: string | null;
};

const CLI_LABELS: Record<string, string> = {
  claude: "Claude Code",
  grok: "Grok Build",
  codex: "Codex",
};

/** The provider a profile is listed under: the vendor for API profiles, the harness for CLI profiles. */
export function providerKey(profile: PickableProfile): string {
  if (profileKind(profile) === "cli") return `cli:${profile.cli?.trim() || profile.id}`;
  return `api:${profile.provider}`;
}

function groupLabel(profile: PickableProfile): string {
  if (profileKind(profile) === "cli") {
    const cli = profile.cli?.trim().toLowerCase() ?? "";
    return CLI_LABELS[cli] ?? profile.name;
  }
  return providerLabel(profile.provider);
}

/** Profiles grouped by provider, in first-seen order. */
export function groupProfilesByProvider<P extends PickableProfile>(profiles: readonly P[]): ProviderGroup<P>[] {
  const groups = new Map<string, ProviderGroup<P>>();
  for (const profile of profiles) {
    const key = providerKey(profile);
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        label: groupLabel(profile),
        kind: profileKind(profile),
        profiles: [],
        available: false,
        unavailableReason: null,
      };
      groups.set(key, group);
    }
    group.profiles.push(profile);
    if (profileIsAvailable(profile)) group.available = true;
  }
  for (const group of groups.values()) {
    if (group.available) continue;
    group.unavailableReason =
      group.profiles.map((profile) => profile.unavailableReason?.trim()).find(Boolean) ?? "Unavailable";
  }
  return [...groups.values()];
}

/**
 * What the model picker shows for a profile. A CLI profile that lets the CLI
 * choose reads "Default model". When two profiles of one provider share a
 * model, the profile name tells them apart.
 */
export function modelLabel(profile: PickableProfile, siblings: readonly PickableProfile[] = [profile]): string {
  const base = bareModelLabel(profile);
  const clash = siblings.some((other) => other.id !== profile.id && bareModelLabel(other) === base);
  return clash ? `${base} (${profile.name})` : base;
}

function bareModelLabel(profile: PickableProfile): string {
  return profile.defaultModel ? "Default model" : profile.model.trim() || profile.name;
}

/** The profile to select when the user switches to `group`: the current one if it belongs there, else the first that can run. */
export function profileForProvider<P extends PickableProfile>(group: ProviderGroup<P>, currentId: string | null): P | null {
  const current = group.profiles.find((profile) => profile.id === currentId);
  if (current) return current;
  return group.profiles.find((profile) => profileIsAvailable(profile)) ?? null;
}
