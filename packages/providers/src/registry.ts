import { streamAnthropicMessages } from "./anthropic.ts";
import { capabilitiesFor } from "./capabilities.ts";
import {
  CANONICAL_API_KEY_ENVS,
  assertEnvName,
  isApiKeyConfigured,
  resolveApiKey,
  type Env,
} from "./env.ts";
import {
  ProfileRequiredError,
  ProviderError,
  UnknownProfileError,
  UnknownProviderError,
} from "./errors.ts";
import { assertHttpUrl, assertSafeHeaders } from "./http.ts";
import { createMockProvider } from "./mock.ts";
import { streamChatCompletions } from "./openai-client.ts";
import {
  PROVIDER_TYPES,
  type ChatRequest,
  type CompletionInput,
  type LLMProvider,
  type MockScript,
  type ModelCapabilities,
  type ModelProfile,
  type OpenRouterRouting,
  type ProviderConfig,
  type ProviderRegistry,
  type ProviderStatus,
  type ProviderType,
  type ProvidersConfig,
  type ResolvedCompletion,
} from "./types.ts";

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

export const PROVIDER_BASE_URLS = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  xai: "https://api.x.ai/v1",
  deepseek: "https://api.deepseek.com",
  openrouter: "https://openrouter.ai/api/v1",
} as const;

export interface RegistryOptions {
  /** When set, `process.env` is not read. Tests should pass this explicitly. */
  env?: Env;
  fetch?: typeof fetch;
}

/**
 * Five hosted providers with canonical env var names and base URLs.
 * Profiles are intentionally absent — the caller must declare them.
 */
export function builtinProviderConfigs(): ProviderConfig[] {
  return [
    { id: "openai", type: "openai", apiKeyEnv: CANONICAL_API_KEY_ENVS.openai },
    { id: "anthropic", type: "anthropic", apiKeyEnv: CANONICAL_API_KEY_ENVS.anthropic },
    { id: "xai", type: "xai", apiKeyEnv: CANONICAL_API_KEY_ENVS.xai },
    { id: "deepseek", type: "deepseek", apiKeyEnv: CANONICAL_API_KEY_ENVS.deepseek },
    {
      id: "openrouter",
      type: "openrouter",
      apiKeyEnv: CANONICAL_API_KEY_ENVS.openrouter,
      appTitle: "Botanical",
    },
  ];
}

export function assertProfileId(profileId: unknown): asserts profileId is string {
  if (typeof profileId !== "string" || profileId.trim() === "") {
    throw new ProfileRequiredError();
  }
}

export function parseProvidersConfig(input: unknown): ProvidersConfig {
  const record = asRecord(input);
  if (!record) throw new ProviderError("Provider config must be an object.", { code: "config" });
  if ("defaultProfile" in record || "defaultModel" in record || "default" in record) {
    throw new ProviderError(
      "defaultProfile is not allowed. Callers must pass profileId on every completion.",
      { code: "config" },
    );
  }
  if (!Array.isArray(record.providers) || record.providers.length === 0) {
    throw new ProviderError("At least one provider is required.", { code: "config" });
  }
  if (!Array.isArray(record.profiles)) {
    throw new ProviderError("profiles must be an array.", { code: "config" });
  }

  const providers = record.providers.map((entry) => parseProvider(entry));
  const providerIds = new Set<string>();
  for (const provider of providers) {
    if (providerIds.has(provider.id)) {
      throw new ProviderError(`Duplicate provider id "${provider.id}".`, { code: "config" });
    }
    providerIds.add(provider.id);
  }

  const profiles = record.profiles.map((entry) => parseProfile(entry));
  const profileIds = new Set<string>();
  for (const profile of profiles) {
    if (profileIds.has(profile.id)) {
      throw new ProviderError(`Duplicate profile id "${profile.id}".`, { code: "config" });
    }
    profileIds.add(profile.id);
    if (!providerIds.has(profile.provider)) {
      throw new ProviderError(
        `Profile "${profile.id}" references unknown provider "${profile.provider}".`,
        { code: "config" },
      );
    }
  }

  return { providers, profiles };
}

export function createRegistry(input: unknown, options: RegistryOptions = {}): ProviderRegistry {
  const config = parseProvidersConfig(input);
  const built = new Map<string, LLMProvider>();
  for (const provider of config.providers) {
    built.set(provider.id, buildProvider(provider, options));
  }
  const profiles = config.profiles.map((profile) => Object.freeze({ ...profile }));
  const byId = new Map(profiles.map((profile) => [profile.id, profile]));

  function requireProfile(profileId: string): ModelProfile {
    assertProfileId(profileId);
    const profile = byId.get(profileId);
    if (!profile) throw new UnknownProfileError(profileId);
    return profile;
  }

  function providerFor(profile: ModelProfile): LLMProvider {
    const provider = built.get(profile.provider);
    if (!provider) throw new UnknownProviderError(profile.provider);
    return provider;
  }

  function resolve(completion: CompletionInput): ResolvedCompletion {
    const input = asCompletion(completion);
    rejectInlineKey(input);
    const profile = requireProfile(input.profileId);
    const provider = providerFor(profile);
    provider.assertReady();
    validateMessages(input.messages);
    const model = resolveModel(profile, input.model);
    const maxTokens = input.maxTokens ?? profile.maxTokens;
    const timeoutMs = input.timeoutMs ?? profile.timeoutMs;
    if (provider.type === "anthropic" && maxTokens === undefined) {
      throw new ProviderError(
        "Anthropic requires maxTokens. Set it on the profile or on the completion request.",
        { providerId: provider.id, code: "config" },
      );
    }
    if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs < 1)) {
      throw new ProviderError("timeoutMs must be a positive number.", { code: "config" });
    }
    return {
      profile,
      providerId: provider.id,
      providerType: provider.type,
      model,
    };
  }

  return {
    listProfiles() {
      return profiles;
    },
    listProviders() {
      return config.providers.map((provider) => providerStatus(provider, options.env));
    },
    getProfile(profileId: string) {
      if (typeof profileId !== "string" || profileId.trim() === "") return undefined;
      return byId.get(profileId);
    },
    requireProfile,
    capabilities(profileId: string, model?: string) {
      const profile = requireProfile(profileId);
      const provider = providerFor(profile);
      const selected = model ?? profile.model;
      if (selected.trim() === "") {
        throw new ProviderError(`Profile "${profile.id}" has no model configured.`, { code: "config" });
      }
      return provider.capabilities(selected);
    },
    resolve,
    complete(completion: CompletionInput) {
      const input = asCompletion(completion);
      const resolved = resolve(input);
      const provider = providerFor(resolved.profile);
      return provider.complete(toChatRequest(input, resolved));
    },
  };
}

function buildProvider(config: ProviderConfig, options: RegistryOptions): LLMProvider {
  if (config.type === "mock") {
    return createMockProvider(config.id, config.mock ?? {});
  }

  const baseURL = config.baseURL ?? defaultBaseURL(config.type);
  if (!baseURL) {
    throw new ProviderError(`Provider "${config.id}" requires baseURL.`, { code: "config" });
  }

  if (config.type === "anthropic") {
    const envName = config.apiKeyEnv ?? CANONICAL_API_KEY_ENVS.anthropic;
    return {
      id: config.id,
      type: config.type,
      assertReady() {
        resolveApiKey(envName, options.env, config.id);
      },
      capabilities(model: string) {
        return capabilitiesFor("anthropic", model, config.capabilities);
      },
      complete(request: ChatRequest) {
        return streamAnthropicMessages(request, {
          id: config.id,
          apiKey: resolveApiKey(envName, options.env, config.id),
          baseURL,
          fetchImpl: options.fetch,
          defaultHeaders: config.defaultHeaders,
          anthropicVersion: config.anthropicVersion,
        });
      },
    };
  }

  const envName = config.apiKeyEnv;
  return {
    id: config.id,
    type: config.type,
    assertReady() {
      if (envName) resolveApiKey(envName, options.env, config.id);
    },
    capabilities(model: string) {
      return capabilitiesFor(config.type, model, config.capabilities);
    },
    complete(request: ChatRequest) {
      const apiKey = envName ? resolveApiKey(envName, options.env, config.id) : undefined;
      return streamChatCompletions(request, {
        id: config.id,
        apiKey,
        baseURL,
        fetchImpl: options.fetch,
        defaultHeaders: vendorHeaders(config),
        extraBody: vendorBody(config),
        includeUsage: config.includeUsage,
        tokenField: config.type === "openai" ? "max_completion_tokens" : "max_tokens",
      });
    },
  };
}

function defaultBaseURL(type: ProviderType): string | undefined {
  switch (type) {
    case "openai":
      return PROVIDER_BASE_URLS.openai;
    case "anthropic":
      return PROVIDER_BASE_URLS.anthropic;
    case "xai":
      return PROVIDER_BASE_URLS.xai;
    case "deepseek":
      return PROVIDER_BASE_URLS.deepseek;
    case "openrouter":
      return PROVIDER_BASE_URLS.openrouter;
    default:
      return undefined;
  }
}

function vendorHeaders(config: ProviderConfig): Record<string, string> | undefined {
  const headers: Record<string, string> = { ...config.defaultHeaders };
  if (config.type === "openrouter") {
    if (config.httpReferer) headers["HTTP-Referer"] = config.httpReferer;
    if (config.appTitle) headers["X-Title"] = config.appTitle;
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}

function vendorBody(config: ProviderConfig): Record<string, unknown> | undefined {
  if (config.type !== "openrouter" || !config.routing) return undefined;
  const provider: Record<string, unknown> = {};
  if (config.routing.order) provider.order = config.routing.order;
  if (config.routing.allowFallbacks !== undefined) provider.allow_fallbacks = config.routing.allowFallbacks;
  if (config.routing.only) provider.only = config.routing.only;
  if (config.routing.ignore) provider.ignore = config.routing.ignore;
  return Object.keys(provider).length > 0 ? { provider } : undefined;
}

function providerStatus(provider: ProviderConfig, env: Env | undefined): ProviderStatus {
  const apiKeyEnv = provider.apiKeyEnv;
  const keyConfigured =
    provider.type === "mock" || apiKeyEnv === undefined || isApiKeyConfigured(apiKeyEnv, env);
  const status: ProviderStatus = {
    id: provider.id,
    type: provider.type,
    keyConfigured,
  };
  if (apiKeyEnv) status.apiKeyEnv = apiKeyEnv;
  return status;
}

function toChatRequest(input: CompletionInput, resolved: ResolvedCompletion): ChatRequest {
  const request: ChatRequest = {
    model: resolved.model,
    messages: input.messages,
  };
  if (input.tools !== undefined) request.tools = input.tools;
  const temperature = input.temperature ?? resolved.profile.temperature;
  const maxTokens = input.maxTokens ?? resolved.profile.maxTokens;
  const timeoutMs = input.timeoutMs ?? resolved.profile.timeoutMs;
  if (temperature !== undefined) request.temperature = temperature;
  if (maxTokens !== undefined) request.maxTokens = maxTokens;
  if (timeoutMs !== undefined) request.timeoutMs = timeoutMs;
  if (input.signal !== undefined) request.signal = input.signal;
  return request;
}

function resolveModel(profile: ModelProfile, override: string | undefined): string {
  const model = override !== undefined ? override : profile.model;
  if (typeof model !== "string" || model.trim() === "") {
    throw new ProviderError(`Profile "${profile.id}" has no model configured.`, { code: "config" });
  }
  return model;
}

function validateMessages(messages: CompletionInput["messages"]): void {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new ProviderError("messages must be a non-empty array.", { code: "config" });
  }
}

function asCompletion(input: CompletionInput): CompletionInput {
  if (!input || typeof input !== "object") throw new ProfileRequiredError();
  return input;
}

function rejectInlineKey(input: CompletionInput): void {
  if ("apiKey" in input) {
    throw new ProviderError(
      "API keys cannot be passed to complete(). Set server environment variables.",
      { code: "config" },
    );
  }
}

function parseProvider(value: unknown): ProviderConfig {
  const record = asRecord(value);
  if (!record) throw new ProviderError("Provider entry must be an object.", { code: "config" });
  if ("apiKey" in record && record.apiKey != null && record.apiKey !== "") {
    throw new ProviderError(
      "Inline apiKey is not allowed. Set apiKeyEnv and store the key in the server environment.",
      { code: "config" },
    );
  }
  const id = requireId(record.id, "provider id");
  if (typeof record.type !== "string" || !isProviderType(record.type)) {
    throw new ProviderError(`Provider "${id}" has unknown type "${String(record.type)}".`, {
      code: "config",
    });
  }
  const config: ProviderConfig = { id, type: record.type };
  if (record.apiKeyEnv !== undefined) {
    if (typeof record.apiKeyEnv !== "string") {
      throw new ProviderError(`Provider "${id}" apiKeyEnv must be a string.`, { code: "config" });
    }
    assertEnvName(record.apiKeyEnv);
    config.apiKeyEnv = record.apiKeyEnv;
  } else if (config.type !== "mock" && config.type !== "openai-compat") {
    config.apiKeyEnv = CANONICAL_API_KEY_ENVS[config.type];
  }
  if (record.baseURL !== undefined) {
    if (typeof record.baseURL !== "string") {
      throw new ProviderError(`Provider "${id}" baseURL must be a string.`, { code: "config" });
    }
    assertHttpUrl(record.baseURL, `Provider "${id}" baseURL`);
    config.baseURL = record.baseURL;
  }
  if (record.defaultHeaders !== undefined) {
    config.defaultHeaders = stringRecord(record.defaultHeaders, `Provider "${id}" defaultHeaders`);
    assertSafeHeaders(config.defaultHeaders);
  }
  if (record.httpReferer !== undefined) {
    if (typeof record.httpReferer !== "string") {
      throw new ProviderError(`Provider "${id}" httpReferer must be a string.`, { code: "config" });
    }
    config.httpReferer = record.httpReferer;
  }
  if (record.appTitle !== undefined) {
    if (typeof record.appTitle !== "string") {
      throw new ProviderError(`Provider "${id}" appTitle must be a string.`, { code: "config" });
    }
    config.appTitle = record.appTitle;
  }
  if (record.routing !== undefined) config.routing = parseRouting(record.routing);
  if (record.includeUsage !== undefined) {
    if (typeof record.includeUsage !== "boolean") {
      throw new ProviderError(`Provider "${id}" includeUsage must be a boolean.`, { code: "config" });
    }
    config.includeUsage = record.includeUsage;
  }
  if (record.anthropicVersion !== undefined) {
    if (typeof record.anthropicVersion !== "string" || record.anthropicVersion.trim() === "") {
      throw new ProviderError(`Provider "${id}" anthropicVersion must be a string.`, { code: "config" });
    }
    config.anthropicVersion = record.anthropicVersion;
  }
  if (record.capabilities !== undefined) {
    config.capabilities = parseCapabilityMap(record.capabilities, `Provider "${id}" capabilities`);
  }
  if (record.mock !== undefined) {
    if (config.type !== "mock") {
      throw new ProviderError(`Provider "${id}" cannot set mock unless type is "mock".`, { code: "config" });
    }
    config.mock = parseMock(record.mock);
  }
  return config;
}

function parseProfile(value: unknown): ModelProfile {
  const record = asRecord(value);
  if (!record) throw new ProviderError("Profile entry must be an object.", { code: "config" });
  const profile: ModelProfile = {
    id: requireId(record.id, "profile id"),
    provider: requireId(record.provider, "profile provider"),
    model: requireModel(record.model, "profile model"),
  };
  if (record.label !== undefined) {
    if (typeof record.label !== "string") throw new ProviderError("Profile label must be a string.", { code: "config" });
    profile.label = record.label;
  }
  if (record.temperature !== undefined) profile.temperature = requireNumber(record.temperature, "temperature");
  if (record.maxTokens !== undefined) profile.maxTokens = requirePositive(record.maxTokens, "maxTokens");
  if (record.timeoutMs !== undefined) profile.timeoutMs = requirePositive(record.timeoutMs, "timeoutMs");
  return profile;
}

function parseRouting(value: unknown): OpenRouterRouting {
  const record = asRecord(value);
  if (!record) throw new ProviderError("routing must be an object.", { code: "config" });
  const routing: OpenRouterRouting = {};
  if (record.order !== undefined) routing.order = stringArray(record.order, "routing.order");
  if (record.only !== undefined) routing.only = stringArray(record.only, "routing.only");
  if (record.ignore !== undefined) routing.ignore = stringArray(record.ignore, "routing.ignore");
  if (record.allowFallbacks !== undefined) {
    if (typeof record.allowFallbacks !== "boolean") {
      throw new ProviderError("routing.allowFallbacks must be a boolean.", { code: "config" });
    }
    routing.allowFallbacks = record.allowFallbacks;
  }
  return routing;
}

function parseMock(value: unknown): MockScript {
  const record = asRecord(value);
  if (!record) throw new ProviderError("mock must be an object.", { code: "config" });
  const script: MockScript = {};
  if (record.reply !== undefined) {
    if (typeof record.reply !== "string" && typeof record.reply !== "function") {
      throw new ProviderError("mock.reply must be a string.", { code: "config" });
    }
    script.reply = record.reply as MockScript["reply"];
  }
  if (record.events !== undefined) {
    if (!Array.isArray(record.events) && typeof record.events !== "function") {
      throw new ProviderError("mock.events must be an array.", { code: "config" });
    }
    script.events = record.events as MockScript["events"];
  }
  if (record.chunkSize !== undefined) script.chunkSize = requirePositive(record.chunkSize, "mock.chunkSize");
  if (record.capabilities !== undefined) {
    const parsed = parseCapabilityMap({ model: record.capabilities }, "mock.capabilities");
    const caps = parsed.model;
    if (caps) script.capabilities = caps;
  }
  return script;
}

function parseCapabilityMap(
  value: unknown,
  label: string,
): Record<string, Partial<ModelCapabilities>> {
  const record = asRecord(value);
  if (!record) throw new ProviderError(`${label} must be an object.`, { code: "config" });
  const out: Record<string, Partial<ModelCapabilities>> = {};
  for (const [model, raw] of Object.entries(record)) {
    const caps = asRecord(raw);
    if (!caps) throw new ProviderError(`${label}.${model} must be an object.`, { code: "config" });
    const partial: Partial<ModelCapabilities> = {};
    for (const key of ["tools", "parallelTools", "vision", "streaming", "reasoning"] as const) {
      if (caps[key] === undefined) continue;
      if (typeof caps[key] !== "boolean") {
        throw new ProviderError(`${label}.${model}.${key} must be a boolean.`, { code: "config" });
      }
      partial[key] = caps[key];
    }
    if (caps.maxContext !== undefined) {
      partial.maxContext = requirePositive(caps.maxContext, `${label}.${model}.maxContext`);
    }
    out[model] = partial;
  }
  return out;
}

function requireId(value: unknown, label: string): string {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new ProviderError(
      `${label} must match ${ID_PATTERN.source} (letters, numbers, and . _ : -).`,
      { code: "config" },
    );
  }
  return value;
}

function requireModel(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ProviderError(`${label} must be a non-empty string.`, { code: "config" });
  }
  return value.trim();
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ProviderError(`${label} must be a finite number.`, { code: "config" });
  }
  return value;
}

function requirePositive(value: unknown, label: string): number {
  const number = requireNumber(value, label);
  if (number < 1) throw new ProviderError(`${label} must be >= 1.`, { code: "config" });
  return number;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new ProviderError(`${label} must be an array of strings.`, { code: "config" });
  }
  return value;
}

function stringRecord(value: unknown, label: string): Record<string, string> {
  const record = asRecord(value);
  if (!record) throw new ProviderError(`${label} must be an object.`, { code: "config" });
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry !== "string") {
      throw new ProviderError(`${label}.${key} must be a string.`, { code: "config" });
    }
    out[key] = entry;
  }
  return out;
}

function isProviderType(value: string): value is ProviderType {
  return (PROVIDER_TYPES as readonly string[]).includes(value);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}
