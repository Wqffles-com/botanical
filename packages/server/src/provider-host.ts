import {
  createConfiguredRegistry,
  createRuntimeBridge,
  type Env,
  type ListedProfile,
  type ProviderRegistry,
  type RuntimeProfileResolver,
} from "@botanical/providers";

import type { ModelProfile } from "./types.ts";

/** Narrower than `typeof fetch` so tests can pass a mock without Bun's `preconnect`. */
export type ProviderFetch = (input: Request | URL | string, init?: RequestInit) => Promise<Response>;

/** Registry plus the agent-runtime ProfileResolver shape. Keys stay in the env closure. */
export interface ProviderHost {
  readonly registry: ProviderRegistry;
  readonly runtime: RuntimeProfileResolver;
}

export function createProviderHost(
  profiles: readonly ModelProfile[],
  env: Env,
  fetchImpl?: ProviderFetch,
): ProviderHost {
  const registry = createConfiguredRegistry(profiles.map(toListed), {
    env,
    ...(fetchImpl ? { fetch: fetchImpl as typeof fetch } : {}),
  });
  return {
    registry,
    runtime: createRuntimeBridge(registry),
  };
}

function toListed(profile: ModelProfile): ListedProfile {
  const listed: ListedProfile = {
    id: profile.id,
    name: profile.name,
    provider: profile.provider,
    model: profile.model,
    description: profile.description ?? null,
  };
  if (profile.baseUrl) listed.baseUrl = profile.baseUrl;
  if (profile.maxTokens !== undefined) listed.maxTokens = profile.maxTokens;
  if (profile.temperature !== undefined) listed.temperature = profile.temperature;
  return listed;
}
