import { readFileSync } from "node:fs";

import { CANONICAL_API_KEY_ENVS, isApiKeyConfigured, readEnv, type Env } from "./env.ts";
import { ProviderError } from "./errors.ts";
import { assertHttpUrl } from "./http.ts";
import { createRegistry, type RegistryOptions } from "./registry.ts";
import {
  PROVIDER_TYPES,
  type ModelProfile,
  type ProviderConfig,
  type ProviderRegistry,
  type ProviderType,
} from "./types.ts";

/** Canonical env for a generic OpenAI-compatible host. Both are required. */
export const OPENAI_COMPAT_BASE_URL_ENV = "OPENAI_COMPAT_BASE_URL";
export const OPENAI_COMPAT_API_KEY_ENV = "OPENAI_COMPAT_API_KEY";
export const OPENAI_COMPAT_MODEL_ENV = "OPENAI_COMPAT_MODEL";

/**
 * Older deploy docs used these names. They apply only when the canonical
 * `OPENAI_COMPAT_*` variable is unset.
 */
export const LEGACY_COMPAT_BASE_URL_ENV = "CUSTOM_OPENAI_BASE_URL";
export const LEGACY_COMPAT_API_KEY_ENV = "CUSTOM_OPENAI_API_KEY";

/** Sent when an Anthropic profile does not set maxTokens. The API requires the field. */
export const ANTHROPIC_DEFAULT_MAX_TOKENS = 4096;

const FORBIDDEN_KEYS = ["apiKey", "api_key", "token", "authorization", "password"] as const;
const DEFAULT_KEYS = ["default", "defaultProfile", "defaultModel"] as const;

export interface ListedProfile {
  id: string;
  name: string;
  provider: ProviderType;
  model: string;
  description: string | null;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
}

const DEFAULT_MODELS: readonly ListedProfile[] = [
  {
    id: "openai",
    name: "OpenAI",
    provider: "openai",
    model: "gpt-4.1",
    description: "OpenAI. Replace the model list in profiles.json.",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    description: "Anthropic Claude. Replace the model list in profiles.json.",
    maxTokens: ANTHROPIC_DEFAULT_MAX_TOKENS,
  },
  {
    id: "xai",
    name: "xAI",
    provider: "xai",
    model: "grok-4",
    description: "xAI Grok. Replace the model list in profiles.json.",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    provider: "deepseek",
    model: "deepseek-chat",
    description: "DeepSeek. Replace the model list in profiles.json.",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    provider: "openrouter",
    model: "openrouter/auto",
    description: "OpenRouter. Replace the model list in profiles.json.",
  },
];

export function defaultMockProfile(): ListedProfile {
  return {
    id: "mock",
    name: "Mock",
    provider: "mock",
    model: "echo",
    description: "In-process echo. No API key.",
  };
}

export function compatApiKeyEnv(env: Env): string {
  if (isApiKeyConfigured(OPENAI_COMPAT_API_KEY_ENV, env)) return OPENAI_COMPAT_API_KEY_ENV;
  if (isApiKeyConfigured(LEGACY_COMPAT_API_KEY_ENV, env)) return LEGACY_COMPAT_API_KEY_ENV;
  return OPENAI_COMPAT_API_KEY_ENV;
}

export function compatBaseUrl(env: Env): string | undefined {
  return readEnv(OPENAI_COMPAT_BASE_URL_ENV, env) ?? readEnv(LEGACY_COMPAT_BASE_URL_ENV, env);
}

export function providerConfigured(provider: ProviderType, env: Env, baseUrl?: string): boolean {
  switch (provider) {
    case "mock":
      return true;
    case "openai":
    case "anthropic":
    case "xai":
    case "deepseek":
    case "openrouter":
      return isApiKeyConfigured(CANONICAL_API_KEY_ENVS[provider], env);
    case "openai-compat":
      return isApiKeyConfigured(compatApiKeyEnv(env), env) && Boolean(baseUrl?.trim() || compatBaseUrl(env));
    default: {
      const _never: never = provider;
      return _never;
    }
  }
}

/**
 * `override` replaces the built-in one-profile-per-provider list.
 * `undefined` means "no override" (use the built-in list). An empty array
 * means the operator listed nothing, so only mock remains.
 * Profiles whose provider key is missing are omitted. Mock is always present.
 * Nothing in the result is a default selection.
 */
export function selectProfiles(override: readonly ListedProfile[] | undefined, env: Env): ListedProfile[] {
  const source = override === undefined ? autoProfiles(env) : override.map((profile) => ({ ...profile }));
  const kept: ListedProfile[] = [];
  for (const profile of source) {
    if (profile.id === "mock" && profile.provider !== "mock") {
      throw new ProviderError('Profile id "mock" is reserved for the mock provider.', { code: "config" });
    }
    const baseUrl = profile.provider === "openai-compat" ? resolveCompatBase(profile, env) : profile.baseUrl;
    if (!providerConfigured(profile.provider, env, baseUrl)) continue;
    const next: ListedProfile = { ...profile, description: profile.description ?? null };
    if (baseUrl && profile.provider === "openai-compat") next.baseUrl = baseUrl;
    if (next.provider === "anthropic" && next.maxTokens === undefined) {
      next.maxTokens = ANTHROPIC_DEFAULT_MAX_TOKENS;
    }
    kept.push(next);
  }

  const mocks = kept.filter((profile) => profile.provider === "mock");
  const rest = kept.filter((profile) => profile.provider !== "mock");
  if (!mocks.some((profile) => profile.id === "mock")) mocks.unshift(defaultMockProfile());
  return [...mocks, ...rest];
}

/**
 * Read `BOTANICAL_PROFILES_FILE` when it is set, otherwise `BOTANICAL_PROFILES`.
 * A blank value means there is no override. The file wins when both are set.
 */
export function readProfilesOverride(
  env: Env,
  readFile: (path: string) => string = (path) => readFileSync(path, "utf8"),
): unknown | undefined {
  const filePath = env.BOTANICAL_PROFILES_FILE?.trim() ?? "";
  if (filePath !== "") {
    let text: string;
    try {
      text = readFile(filePath);
    } catch {
      throw new ProviderError(`BOTANICAL_PROFILES_FILE could not be read (${filePath}).`, { code: "config" });
    }
    if (text.trim() === "") {
      throw new ProviderError("BOTANICAL_PROFILES_FILE is empty.", { code: "config" });
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new ProviderError("BOTANICAL_PROFILES_FILE must be JSON.", { code: "config" });
    }
  }
  const inline = env.BOTANICAL_PROFILES;
  if (inline === undefined || inline.trim() === "") return undefined;
  try {
    return JSON.parse(inline) as unknown;
  } catch {
    throw new ProviderError("BOTANICAL_PROFILES must be JSON.", { code: "config" });
  }
}

/**
 * Accept a profile array, `{ profiles: [...] }`, or `{ models: { openai: ["gpt-4.1"] } }`.
 * `defaultProfile` is rejected. API keys are rejected.
 */
export function parseProfilesDocument(value: unknown): ListedProfile[] {
  if (Array.isArray(value)) {
    const profiles = parseProfileArray(value);
    assertUnique(profiles);
    return profiles;
  }
  const record = asRecord(value);
  if (!record) {
    throw new ProviderError("Profiles document must be an array or an object.", { code: "config" });
  }
  rejectDefaults(record, "profiles document");
  const profiles = record.profiles === undefined ? [] : parseProfileArray(record.profiles);
  const fromModels = record.models === undefined ? [] : profilesFromModels(record.models);
  if (record.profiles === undefined && record.models === undefined) {
    throw new ProviderError('Profiles document needs a "profiles" array or a "models" map.', {
      code: "config",
    });
  }
  const combined = [...profiles, ...fromModels];
  assertUnique(combined);
  return combined;
}

/** Build a registry for the listed profiles. Keys stay in `options.env`. */
export function createConfiguredRegistry(
  profiles: readonly ListedProfile[],
  options: RegistryOptions = {},
): ProviderRegistry {
  const env = options.env ?? process.env;
  const providers: ProviderConfig[] = [{ id: "mock", type: "mock" }];
  const seenProviders = new Set<string>(["mock"]);
  const compatIds = compatProviderIds(profiles, env);
  const registryProfiles: ModelProfile[] = [];

  for (const profile of profiles) {
    if (profile.provider === "mock") {
      registryProfiles.push(toRegistryProfile(profile, "mock"));
      continue;
    }
    if (profile.provider === "openai-compat") {
      const base = profile.baseUrl ?? compatBaseUrl(env);
      if (!base) {
        throw new ProviderError(`Profile "${profile.id}" requires a base URL.`, { code: "config" });
      }
      const normalized = normalizeBaseUrl(base, `Profile "${profile.id}" baseUrl`);
      const providerId = compatIds.get(normalized);
      if (!providerId) {
        throw new ProviderError(`Profile "${profile.id}" has no OpenAI-compatible provider.`, {
          code: "config",
        });
      }
      if (!seenProviders.has(providerId)) {
        seenProviders.add(providerId);
        providers.push({
          id: providerId,
          type: "openai-compat",
          apiKeyEnv: compatApiKeyEnv(env),
          baseURL: normalized,
          includeUsage: false,
        });
      }
      registryProfiles.push(toRegistryProfile(profile, providerId));
      continue;
    }

    if (!seenProviders.has(profile.provider)) {
      seenProviders.add(profile.provider);
      const config: ProviderConfig = {
        id: profile.provider,
        type: profile.provider,
        apiKeyEnv: CANONICAL_API_KEY_ENVS[profile.provider],
      };
      if (profile.provider === "openrouter") config.appTitle = "Botanical";
      providers.push(config);
    }
    registryProfiles.push(toRegistryProfile(profile, profile.provider));
  }

  return createRegistry({ providers, profiles: registryProfiles }, options);
}

function autoProfiles(env: Env): ListedProfile[] {
  const profiles: ListedProfile[] = DEFAULT_MODELS.map((profile) => ({ ...profile }));
  if (providerConfigured("openai-compat", env)) {
    const base = compatBaseUrl(env);
    if (base) {
      profiles.push({
        id: "openai-compat",
        name: "OpenAI-compatible",
        provider: "openai-compat",
        model: readEnv(OPENAI_COMPAT_MODEL_ENV, env) ?? "default",
        description: "OpenAI-compatible host. Set OPENAI_COMPAT_MODEL or profiles.json.",
        baseUrl: normalizeBaseUrl(base, OPENAI_COMPAT_BASE_URL_ENV),
      });
    }
  }
  return profiles;
}

function resolveCompatBase(profile: ListedProfile, env: Env): string | undefined {
  const raw = profile.baseUrl?.trim() || compatBaseUrl(env);
  if (!raw) return undefined;
  return normalizeBaseUrl(raw, `Profile "${profile.id}" baseUrl`);
}

function compatProviderIds(profiles: readonly ListedProfile[], env: Env): Map<string, string> {
  const bases: string[] = [];
  for (const profile of profiles) {
    if (profile.provider !== "openai-compat") continue;
    const raw = profile.baseUrl ?? compatBaseUrl(env);
    if (!raw) continue;
    const base = normalizeBaseUrl(raw, `Profile "${profile.id}" baseUrl`);
    if (!bases.includes(base)) bases.push(base);
  }
  const ids = new Map<string, string>();
  bases.forEach((base, index) => {
    ids.set(base, index === 0 ? "openai-compat" : `openai-compat-${index + 1}`);
  });
  return ids;
}

function toRegistryProfile(profile: ListedProfile, providerId: string): ModelProfile {
  const registryProfile: ModelProfile = {
    id: profile.id,
    provider: providerId,
    model: profile.model,
    label: profile.name,
  };
  if (profile.maxTokens !== undefined) registryProfile.maxTokens = profile.maxTokens;
  if (profile.temperature !== undefined) registryProfile.temperature = profile.temperature;
  return registryProfile;
}

function parseProfileArray(value: unknown): ListedProfile[] {
  if (!Array.isArray(value)) {
    throw new ProviderError("profiles must be an array.", { code: "config" });
  }
  return value.map((entry, index) => parseOneProfile(entry, index));
}

function parseOneProfile(value: unknown, index: number): ListedProfile {
  const label = `profiles[${index}]`;
  const record = asRecord(value);
  if (!record) throw new ProviderError(`${label} must be an object.`, { code: "config" });
  rejectSecrets(record, label);
  rejectDefaults(record, label);
  const provider = requireProvider(record.provider, `${label}.provider`);
  const model = requireText(record.model, `${label}.model`);
  const id = requireText(record.id, `${label}.id`);
  const nameSource = record.name === undefined ? model : record.name;
  const name = requireText(nameSource, `${label}.name`).slice(0, 120);
  const profile: ListedProfile = {
    id,
    name,
    provider,
    model,
    description: optionalText(record.description),
  };
  if (record.baseUrl !== undefined || record.baseURL !== undefined) {
    const base = record.baseUrl ?? record.baseURL;
    if (typeof base !== "string" || base.trim() === "") {
      throw new ProviderError(`${label}.baseUrl must be an http(s) URL.`, { code: "config" });
    }
    profile.baseUrl = base.trim();
  }
  if (record.maxTokens !== undefined) profile.maxTokens = requirePositiveInt(record.maxTokens, `${label}.maxTokens`);
  if (record.temperature !== undefined) profile.temperature = requireFinite(record.temperature, `${label}.temperature`);
  return profile;
}

function profilesFromModels(value: unknown): ListedProfile[] {
  const record = asRecord(value);
  if (!record) throw new ProviderError("models must be an object.", { code: "config" });
  const profiles: ListedProfile[] = [];
  const seen = new Set<string>();
  for (const [providerName, rawList] of Object.entries(record)) {
    const provider = requireProvider(providerName, `models provider "${providerName}"`);
    if (!Array.isArray(rawList) || rawList.length === 0) {
      throw new ProviderError(`models.${provider} must be a non-empty array of model ids.`, { code: "config" });
    }
    const multiple = rawList.length > 1;
    for (const rawModel of rawList) {
      if (typeof rawModel !== "string" || rawModel.trim() === "") {
        throw new ProviderError(`models.${provider} must be a non-empty array of model ids.`, { code: "config" });
      }
      const model = rawModel.trim();
      const baseId = multiple ? `${provider}-${slug(model)}` : provider;
      const id = uniqueId(baseId, seen);
      seen.add(id);
      const profile: ListedProfile = {
        id,
        name: model.slice(0, 120),
        provider,
        model,
        description: null,
      };
      if (provider === "anthropic") profile.maxTokens = ANTHROPIC_DEFAULT_MAX_TOKENS;
      profiles.push(profile);
    }
  }
  return profiles;
}

function assertUnique(profiles: readonly ListedProfile[]): void {
  const seen = new Set<string>();
  for (const profile of profiles) {
    if (seen.has(profile.id)) {
      throw new ProviderError(`Duplicate model profile id ${JSON.stringify(profile.id)}.`, { code: "config" });
    }
    seen.add(profile.id);
  }
}

function uniqueId(base: string, seen: Set<string>): string {
  const trimmed = base.slice(0, 64);
  if (!seen.has(trimmed)) return trimmed;
  for (let n = 2; n < 1000; n += 1) {
    const suffix = `-${n}`;
    const id = `${trimmed.slice(0, 64 - suffix.length)}${suffix}`;
    if (!seen.has(id)) return id;
  }
  throw new ProviderError(`Duplicate model profile id ${JSON.stringify(base)}.`, { code: "config" });
}

function slug(model: string): string {
  const cleaned = model
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned.slice(0, 40) || "model";
}

function rejectSecrets(record: Record<string, unknown>, label: string): void {
  for (const key of FORBIDDEN_KEYS) {
    if (key in record) {
      throw new ProviderError(
        `${label} must not contain ${key}. Provider API keys belong in server environment variables.`,
        { code: "config" },
      );
    }
  }
}

function rejectDefaults(record: Record<string, unknown>, label: string): void {
  for (const key of DEFAULT_KEYS) {
    if (key in record) {
      throw new ProviderError(
        `${label} must not set ${key}. Callers pass profileId. Botanical has no default model.`,
        { code: "config" },
      );
    }
  }
}

function requireProvider(value: unknown, label: string): ProviderType {
  if (typeof value !== "string" || !(PROVIDER_TYPES as readonly string[]).includes(value)) {
    throw new ProviderError(`${label} must be one of ${PROVIDER_TYPES.join(", ")}.`, { code: "config" });
  }
  return value as ProviderType;
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ProviderError(`${label} is required.`, { code: "config" });
  }
  return value.trim();
}

function optionalText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new ProviderError("description must be a string.", { code: "config" });
  }
  const text = value.trim();
  return text.length > 0 ? text : null;
}

function requireFinite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ProviderError(`${label} must be a finite number.`, { code: "config" });
  }
  return value;
}

function requirePositiveInt(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 2_000_000) {
    throw new ProviderError(`${label} must be an integer from 1 to 2000000.`, { code: "config" });
  }
  return value;
}

export function normalizeBaseUrl(value: string, label: string): string {
  assertHttpUrl(value, label);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ProviderError(`${label} must be an http(s) URL.`, { code: "config" });
  }
  if (url.username || url.password) {
    throw new ProviderError(`${label} must not include credentials.`, { code: "config" });
  }
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${path}${url.search}`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}


