import type { ToolContext } from "../types.ts";

/**
 * Web tool environment:
 *
 * - BOTANICAL_SEARCH_PROVIDER   brave | tavily | serper | searxng | stub
 *   When unset, the first configured backend wins:
 *   Brave, then Tavily, then Serper, then SearXNG. Otherwise search is a stub.
 * - BRAVE_SEARCH_API_KEY        Brave Search API token (BRAVE_API_KEY also accepted)
 * - TAVILY_API_KEY
 * - SERPER_API_KEY
 * - SEARXNG_URL                 Base URL of a SearXNG instance (http or https)
 * - SEARXNG_API_KEY             Optional bearer token for that instance
 * - BOTANICAL_WEB_FETCH_TIMEOUT_MS
 * - BOTANICAL_WEB_FETCH_MAX_BYTES
 * - BOTANICAL_WEB_FETCH_MAX_CHARS
 * - BOTANICAL_WEB_SEARCH_TIMEOUT_MS
 * - BOTANICAL_WEB_USER_AGENT
 * - BOTANICAL_WEB_ALLOW_PRIVATE_URLS   1 | true | yes | on — dev only; skips the public-host check on web_fetch
 */
export const WEB_TOOL_ENV = {
  searchProvider: "BOTANICAL_SEARCH_PROVIDER",
  braveApiKey: "BRAVE_SEARCH_API_KEY",
  braveApiKeyAlias: "BRAVE_API_KEY",
  tavilyApiKey: "TAVILY_API_KEY",
  serperApiKey: "SERPER_API_KEY",
  searxngUrl: "SEARXNG_URL",
  searxngApiKey: "SEARXNG_API_KEY",
  fetchTimeoutMs: "BOTANICAL_WEB_FETCH_TIMEOUT_MS",
  fetchMaxBytes: "BOTANICAL_WEB_FETCH_MAX_BYTES",
  fetchMaxChars: "BOTANICAL_WEB_FETCH_MAX_CHARS",
  searchTimeoutMs: "BOTANICAL_WEB_SEARCH_TIMEOUT_MS",
  userAgent: "BOTANICAL_WEB_USER_AGENT",
  allowPrivateUrls: "BOTANICAL_WEB_ALLOW_PRIVATE_URLS",
} as const;

export const SEARCH_PROVIDER_IDS = ["brave", "tavily", "serper", "searxng", "stub"] as const;
export type SearchProviderId = (typeof SEARCH_PROVIDER_IDS)[number];

export const FRESHNESS_VALUES = ["day", "week", "month", "year"] as const;
export type Freshness = (typeof FRESHNESS_VALUES)[number];

export const DEFAULT_USER_AGENT = "Botanical/0.1 (+https://github.com/Wqffles-com/botanical)";

export const WEB_LIMITS = {
  fetchTimeoutMs: { default: 15_000, min: 50, max: 120_000 },
  searchTimeoutMs: { default: 15_000, min: 50, max: 120_000 },
  fetchMaxBytes: { default: 2_000_000, min: 128, max: 10_000_000 },
  fetchMaxChars: { default: 20_000, min: 100, max: 100_000 },
  searchResults: { default: 5, min: 1, max: 10 },
  queryLength: 500,
  urlLength: 4_000,
} as const;

export type EnvMap = Record<string, string | undefined>;

export interface WebToolConfig {
  searchProvider: SearchProviderId;
  /** True when the selected provider can make a live request. */
  searchLive: boolean;
  /** Credential or setting the selected provider still needs. */
  missingEnv?: string;
  /** Set when BOTANICAL_SEARCH_PROVIDER is not a known id. */
  invalidProvider?: string;
  braveApiKey?: string;
  tavilyApiKey?: string;
  serperApiKey?: string;
  searxngUrl?: string;
  searxngApiKey?: string;
  fetchTimeoutMs: number;
  fetchMaxBytes: number;
  fetchMaxChars: number;
  searchTimeoutMs: number;
  allowPrivateUrls: boolean;
  userAgent: string;
}

export function envFrom(ctx: ToolContext | undefined): EnvMap {
  return ctx?.env ?? process.env;
}

export function loadWebToolConfig(env: EnvMap): WebToolConfig {
  const braveApiKey = readEnv(env, WEB_TOOL_ENV.braveApiKey) ?? readEnv(env, WEB_TOOL_ENV.braveApiKeyAlias);
  const tavilyApiKey = readEnv(env, WEB_TOOL_ENV.tavilyApiKey);
  const serperApiKey = readEnv(env, WEB_TOOL_ENV.serperApiKey);
  const searxngApiKey = readEnv(env, WEB_TOOL_ENV.searxngApiKey);
  const userAgentRaw = readEnv(env, WEB_TOOL_ENV.userAgent);
  const shared = {
    braveApiKey,
    tavilyApiKey,
    serperApiKey,
    searxngApiKey,
    fetchTimeoutMs: readBounded(env, WEB_TOOL_ENV.fetchTimeoutMs, WEB_LIMITS.fetchTimeoutMs),
    fetchMaxBytes: readBounded(env, WEB_TOOL_ENV.fetchMaxBytes, WEB_LIMITS.fetchMaxBytes),
    fetchMaxChars: readBounded(env, WEB_TOOL_ENV.fetchMaxChars, WEB_LIMITS.fetchMaxChars),
    searchTimeoutMs: readBounded(env, WEB_TOOL_ENV.searchTimeoutMs, WEB_LIMITS.searchTimeoutMs),
    allowPrivateUrls: readFlag(env, WEB_TOOL_ENV.allowPrivateUrls),
    userAgent: (userAgentRaw ?? DEFAULT_USER_AGENT).slice(0, 200),
  };

  const explicitRaw = readEnv(env, WEB_TOOL_ENV.searchProvider);
  const explicit = explicitRaw?.toLowerCase();
  if (explicit && !isSearchProvider(explicit)) {
    return { ...shared, searchProvider: "stub", searchLive: false, invalidProvider: explicitRaw };
  }

  const selected: SearchProviderId = explicit && isSearchProvider(explicit)
    ? explicit
    : braveApiKey
      ? "brave"
      : tavilyApiKey
        ? "tavily"
        : serperApiKey
          ? "serper"
          : readEnv(env, WEB_TOOL_ENV.searxngUrl)
            ? "searxng"
            : "stub";

  return { ...shared, ...credentialsFor(selected, env, shared) };
}

function credentialsFor(
  provider: SearchProviderId,
  env: EnvMap,
  keys: Pick<WebToolConfig, "braveApiKey" | "tavilyApiKey" | "serperApiKey" | "searxngApiKey">,
): Pick<WebToolConfig, "searchProvider" | "searchLive" | "missingEnv" | "searxngUrl"> {
  switch (provider) {
    case "brave":
      return keys.braveApiKey
        ? { searchProvider: "brave", searchLive: true }
        : { searchProvider: "brave", searchLive: false, missingEnv: "BRAVE_SEARCH_API_KEY or BRAVE_API_KEY" };
    case "tavily":
      return keys.tavilyApiKey
        ? { searchProvider: "tavily", searchLive: true }
        : { searchProvider: "tavily", searchLive: false, missingEnv: "TAVILY_API_KEY" };
    case "serper":
      return keys.serperApiKey
        ? { searchProvider: "serper", searchLive: true }
        : { searchProvider: "serper", searchLive: false, missingEnv: "SERPER_API_KEY" };
    case "searxng": {
      const raw = readEnv(env, WEB_TOOL_ENV.searxngUrl);
      const parsed = raw ? parseBaseUrl(raw) : undefined;
      if (!parsed) {
        const missingEnv = raw ? "SEARXNG_URL (must be an http or https URL)" : "SEARXNG_URL";
        return { searchProvider: "searxng", searchLive: false, missingEnv };
      }
      return { searchProvider: "searxng", searchLive: true, searxngUrl: parsed };
    }
    case "stub":
      return { searchProvider: "stub", searchLive: false };
  }
}

export function configSecrets(config: WebToolConfig): string[] {
  return [config.braveApiKey, config.tavilyApiKey, config.serperApiKey, config.searxngApiKey]
    .filter((secret): secret is string => typeof secret === "string" && secret.length >= 8);
}

function isSearchProvider(value: string): value is SearchProviderId {
  return (SEARCH_PROVIDER_IDS as readonly string[]).includes(value);
}

function readEnv(env: EnvMap, key: string): string | undefined {
  const value = env[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readFlag(env: EnvMap, key: string): boolean {
  const raw = readEnv(env, key);
  if (!raw) return false;
  return raw === "1" || raw.toLowerCase() === "true" || raw.toLowerCase() === "yes" || raw.toLowerCase() === "on";
}

function readBounded(
  env: EnvMap,
  key: string,
  bounds: { default: number; min: number; max: number },
): number {
  const raw = readEnv(env, key);
  if (!raw) return bounds.default;
  const value = Number(raw);
  if (!Number.isFinite(value)) return bounds.default;
  return Math.min(bounds.max, Math.max(bounds.min, Math.floor(value)));
}

function parseBaseUrl(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    url.hash = "";
    url.username = "";
    url.password = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}
