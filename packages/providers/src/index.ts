/** Adapter ids. No SDK calls in the scaffold. */
export const PROVIDER_IDS = [
  "openai",
  "anthropic",
  "xai",
  "deepseek",
  "openrouter",
  "openai-compat",
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export interface ProviderAdapter {
  readonly id: ProviderId;
}
