import {
  DEPLOYMENT_MODES,
  MODEL_PROVIDERS,
  type DeploymentMode,
  type ModelProfile,
  type ModelProvider,
} from "./types.ts";

export const SERVER_VERSION = "0.1.0";

const SESSION_TTL_DEFAULT = 60 * 60 * 24 * 14;
const MAX_BODY_DEFAULT = 1_000_000;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/** Argon2 hash wins when both values are set. The plaintext is then discarded. */
export type PasswordAuth =
  | { method: "hash"; hash: string }
  | { method: "password"; password: string };

export interface ServerConfig {
  version: string;
  deploymentMode: DeploymentMode;
  /** Display name only. v0 does not change product behavior by deployment mode. */
  brandName: string;
  host: string;
  port: number;
  auth: PasswordAuth;
  sessionTtlSeconds: number;
  cookieName: string;
  cookieSecure: boolean;
  corsOrigin: string | null;
  trustProxy: boolean;
  databaseUrl?: string;
  profiles: readonly ModelProfile[];
  maxBodyBytes: number;
}

/**
 * v0: SELF_HOST and SAAS share routes, auth, and persistence.
 * Mode selects the default brand and is echoed to clients. Do not fork behavior on it.
 */
export function defaultBrandName(mode: DeploymentMode): string {
  return mode === "SAAS" ? "Botanical Cloud" : "Botanical";
}

export function loadConfig(env: Record<string, string | undefined>): ServerConfig {
  const deploymentMode = parseDeploymentMode(env.BOTANICAL_DEPLOYMENT_MODE);
  const brandRaw = env.BOTANICAL_BRAND_NAME?.trim() ?? "";
  if (env.BOTANICAL_BRAND_NAME !== undefined && env.BOTANICAL_BRAND_NAME.trim() === "") {
    throw new ConfigError("BOTANICAL_BRAND_NAME cannot be empty");
  }
  if (brandRaw.length > 80) {
    throw new ConfigError("BOTANICAL_BRAND_NAME must be at most 80 characters");
  }

  const password = env.BOTANICAL_PASSWORD === "" ? undefined : env.BOTANICAL_PASSWORD;
  const passwordHash = env.BOTANICAL_PASSWORD_HASH === "" ? undefined : env.BOTANICAL_PASSWORD_HASH;
  if (!password && !passwordHash) {
    throw new ConfigError("Set BOTANICAL_PASSWORD or BOTANICAL_PASSWORD_HASH");
  }
  if (passwordHash && !passwordHash.startsWith("$argon2")) {
    throw new ConfigError(
      "BOTANICAL_PASSWORD_HASH must be an argon2 hash produced by Bun.password.hash",
    );
  }

  const auth: PasswordAuth = passwordHash
    ? { method: "hash", hash: passwordHash }
    : { method: "password", password: requiredPassword(password) };
  const databaseUrl = parseDatabaseUrl(env.DATABASE_URL);

  return {
    version: SERVER_VERSION,
    deploymentMode,
    brandName: brandRaw || defaultBrandName(deploymentMode),
    host: parseHost(env.BOTANICAL_HOST),
    port: parsePort(env.BOTANICAL_PORT ?? env.PORT),
    auth,
    sessionTtlSeconds: parsePositiveInt(env.BOTANICAL_SESSION_TTL_SECONDS, SESSION_TTL_DEFAULT, {
      min: 60,
      max: 60 * 60 * 24 * 365,
      name: "BOTANICAL_SESSION_TTL_SECONDS",
    }),
    cookieName: "botanical_session",
    cookieSecure: parseBool(env.BOTANICAL_COOKIE_SECURE, "BOTANICAL_COOKIE_SECURE", false),
    corsOrigin: parseCorsOrigin(env.BOTANICAL_CORS_ORIGIN),
    trustProxy: parseBool(env.BOTANICAL_TRUST_PROXY, "BOTANICAL_TRUST_PROXY", false),
    ...(databaseUrl ? { databaseUrl } : {}),
    profiles: parseProfiles(env.BOTANICAL_PROFILES),
    maxBodyBytes: parsePositiveInt(env.BOTANICAL_MAX_BODY_BYTES, MAX_BODY_DEFAULT, {
      min: 1024,
      max: 5_000_000,
      name: "BOTANICAL_MAX_BODY_BYTES",
    }),
  };
}

function requiredPassword(password: string | undefined): string {
  if (!password) {
    throw new ConfigError("Set BOTANICAL_PASSWORD or BOTANICAL_PASSWORD_HASH");
  }
  return password;
}

function parseDeploymentMode(raw: string | undefined): DeploymentMode {
  const value = (raw ?? "SELF_HOST").trim();
  if ((DEPLOYMENT_MODES as readonly string[]).includes(value)) {
    return value as DeploymentMode;
  }
  throw new ConfigError(
    `BOTANICAL_DEPLOYMENT_MODE must be SELF_HOST or SAAS (received ${JSON.stringify(raw ?? "")})`,
  );
}

function parseHost(raw: string | undefined): string {
  const host = raw?.trim() || "0.0.0.0";
  if (host.length > 253 || /\s/.test(host)) {
    throw new ConfigError("BOTANICAL_HOST is invalid");
  }
  return host;
}

function parsePort(raw: string | undefined): number {
  const text = raw?.trim() || "8787";
  if (!/^\d+$/.test(text)) {
    throw new ConfigError("PORT / BOTANICAL_PORT must be an integer");
  }
  const port = Number(text);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError("PORT / BOTANICAL_PORT must be between 1 and 65535");
  }
  return port;
}

function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
  opts: { min: number; max: number; name: string },
): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  if (!/^\d+$/.test(raw.trim())) {
    throw new ConfigError(`${opts.name} must be an integer`);
  }
  const value = Number(raw.trim());
  if (!Number.isSafeInteger(value) || value < opts.min || value > opts.max) {
    throw new ConfigError(`${opts.name} must be between ${opts.min} and ${opts.max}`);
  }
  return value;
}

function parseBool(raw: string | undefined, name: string, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = raw.trim().toLowerCase();
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw new ConfigError(`${name} must be true or false`);
}

function parseCorsOrigin(raw: string | undefined): string | null {
  const text = raw?.trim() ?? "";
  if (!text) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new ConfigError(
      "BOTANICAL_CORS_ORIGIN must be an absolute origin, for example http://localhost:5173",
    );
  }
  if (url.username || url.password) {
    throw new ConfigError("BOTANICAL_CORS_ORIGIN must not include credentials");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new ConfigError("BOTANICAL_CORS_ORIGIN must be an origin without a path, query, or hash");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ConfigError("BOTANICAL_CORS_ORIGIN must be http or https");
  }
  return url.origin;
}

function parseDatabaseUrl(raw: string | undefined): string | undefined {
  const text = raw?.trim() ?? "";
  if (!text) return undefined;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new ConfigError("DATABASE_URL must be a postgres connection URL");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new ConfigError("DATABASE_URL must start with postgres:// or postgresql://");
  }
  return text;
}

const FORBIDDEN_PROFILE_KEYS = ["apiKey", "api_key", "token", "authorization", "password"] as const;

function parseProfiles(raw: string | undefined): readonly ModelProfile[] {
  const text = raw?.trim() ?? "";
  if (!text) return Object.freeze([]);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ConfigError("BOTANICAL_PROFILES must be a JSON array");
  }
  if (!Array.isArray(parsed)) {
    throw new ConfigError("BOTANICAL_PROFILES must be a JSON array");
  }

  const profiles: ModelProfile[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < parsed.length; index++) {
    const profile = parseProfile(parsed[index], index);
    if (seen.has(profile.id)) {
      throw new ConfigError(`Duplicate model profile id ${JSON.stringify(profile.id)}`);
    }
    seen.add(profile.id);
    profiles.push(Object.freeze(profile));
  }
  return Object.freeze(profiles);
}

function parseProfile(value: unknown, index: number): ModelProfile {
  const label = `BOTANICAL_PROFILES[${index}]`;
  if (!isRecord(value)) {
    throw new ConfigError(`${label} must be an object`);
  }
  for (const key of FORBIDDEN_PROFILE_KEYS) {
    if (key in value) {
      throw new ConfigError(
        `${label} must not contain ${key}. Provider API keys belong in server environment variables.`,
      );
    }
  }

  const id = readProfileField(value.id, `${label}.id`);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    throw new ConfigError(
      `${label}.id must be 1-64 characters of letters, numbers, "_" or "-"`,
    );
  }
  const name = readProfileField(value.name, `${label}.name`);
  if (name.length > 120) {
    throw new ConfigError(`${label}.name must be at most 120 characters`);
  }
  const provider = readProfileField(value.provider, `${label}.provider`);
  if (!(MODEL_PROVIDERS as readonly string[]).includes(provider)) {
    throw new ConfigError(
      `${label}.provider must be one of ${MODEL_PROVIDERS.join(", ")}`,
    );
  }
  const model = readProfileField(value.model, `${label}.model`);
  if (model.length > 200) {
    throw new ConfigError(`${label}.model must be at most 200 characters`);
  }

  const profile: ModelProfile = {
    id,
    name,
    provider: provider as ModelProvider,
    model,
  };
  if (value.baseUrl !== undefined) {
    profile.baseUrl = parseBaseUrl(value.baseUrl, label);
  }
  return profile;
}

function parseBaseUrl(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ConfigError(`${label}.baseUrl must be an http(s) URL`);
  }
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new ConfigError(`${label}.baseUrl must be an http(s) URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ConfigError(`${label}.baseUrl must be an http(s) URL`);
  }
  if (url.username || url.password) {
    throw new ConfigError(`${label}.baseUrl must not include credentials`);
  }
  return url.toString();
}

function readProfileField(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ConfigError(`${label} is required`);
  }
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
