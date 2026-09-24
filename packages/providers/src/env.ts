import { MissingApiKeyError, ProviderError } from "./errors.ts";

export type Env = Record<string, string | undefined>;

/** Canonical server env var for each hosted provider. Not a model default. */
export const CANONICAL_API_KEY_ENVS = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  xai: "XAI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
} as const;

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function assertEnvName(name: string): void {
  if (!ENV_NAME.test(name)) {
    throw new ProviderError(
      `apiKeyEnv "${name}" is not an environment variable name. Put the secret in the server environment and reference it by name.`,
      { code: "config" },
    );
  }
}

export function readEnv(envName: string, env?: Env): string | undefined {
  const source = env ?? process.env;
  const value = source[envName];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function isApiKeyConfigured(envName: string, env?: Env): boolean {
  return readEnv(envName, env) !== undefined;
}

/**
 * Read a provider key from the server environment.
 * When `env` is passed, `process.env` is not consulted.
 */
export function resolveApiKey(envName: string, env: Env | undefined, providerId?: string): string {
  assertEnvName(envName);
  const value = readEnv(envName, env);
  if (!value) throw new MissingApiKeyError(envName, providerId);
  return value;
}
