import type { ProviderType } from "./types.ts";

/** Hosted vendors with a fixed base URL and one API key each. */
export const HOSTED_PROVIDERS = ["openai", "anthropic", "xai", "deepseek", "openrouter"] as const;
export type HostedProvider = (typeof HOSTED_PROVIDERS)[number];

/**
 * Current model ids per hosted vendor. The first entry is the provider's base
 * profile; the rest are listed as sibling profiles `<provider>--<model>`.
 * Any other id can still be added as a custom model.
 */
export const API_KNOWN_MODELS: Record<HostedProvider, readonly string[]> = {
  openai: ["gpt-5.5", "gpt-5.4", "gpt-5-mini"],
  anthropic: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-1", "claude-haiku-4-5"],
  xai: ["grok-4.7", "grok-code-fast-1"],
  deepseek: ["deepseek-flash", "deepseek-v4-pro"],
  openrouter: ["openrouter/auto"],
};

/** Model ids the vendor has removed, mapped to the id that replaced them. */
export const RETIRED_MODELS: Partial<Record<ProviderType, Readonly<Record<string, string>>>> = {
  deepseek: {
    "deepseek-chat": "deepseek-flash",
    "deepseek-reasoner": "deepseek-flash",
  },
};

export function isHostedProvider(value: string): value is HostedProvider {
  return (HOSTED_PROVIDERS as readonly string[]).includes(value);
}

/** The replacement for a removed model, or `undefined` when `model` is still served. */
export function retiredModelReplacement(provider: string, model: string): string | undefined {
  return RETIRED_MODELS[provider as ProviderType]?.[model.trim()];
}

/** Profile id for a model listed under a provider's base profile. */
export function modelProfileId(baseId: string, model: string): string {
  return `${baseId}--${model.replace(/[^A-Za-z0-9_-]/g, "-")}`.slice(0, 64);
}
