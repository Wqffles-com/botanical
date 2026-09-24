import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

export type DeploymentMode = "self_host" | "saas";
export type LogLevel = "debug" | "info" | "warn" | "error";

/** Env vars that may be supplied as `<NAME>_FILE` (Docker/K8s secrets). */
export const FILE_BACKED_ENV = [
  "DATABASE_URL",
  "BOTANICAL_PASSCODE",
  "BOTANICAL_SESSION_SECRET",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "XAI_API_KEY",
  "DEEPSEEK_API_KEY",
  "OPENROUTER_API_KEY",
  "CUSTOM_OPENAI_API_KEY",
  "CUSTOM_OPENAI_BASE_URL",
  "TAVILY_API_KEY",
  "BRAVE_SEARCH_API_KEY",
] as const;

export const PROVIDER_ENV = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  xai: "XAI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
} as const;

const PLACEHOLDER_PASSCODES = new Set([
  "change-me",
  "change-me-to-a-long-random-passcode",
  "password",
  "passcode",
]);

const PLACEHOLDER_SECRETS = new Set([
  "change-me",
  "change-me-session-secret",
]);

export type DatabaseSsl = "require" | "verify-full";

export type AppConfig = {
  mode: DeploymentMode;
  passcode: string;
  sessionSecret: string;
  sessionDerived: boolean;
  databaseUrl: string;
  databaseSsl: DatabaseSsl | null;
  poolMax: number;
  publicOrigin: string;
  cookieSecure: boolean;
  serveWeb: boolean;
  webRoot: string;
  host: string;
  port: number;
  trustProxy: boolean;
  logLevel: LogLevel;
  workspace: string;
  sessionTtlSeconds: number;
  version: string;
  warnings: string[];
};

export type ConfigResult = {
  errors: string[];
  warnings: string[];
  config: AppConfig | null;
};

function trimmed(env: NodeJS.ProcessEnv, key: string): string {
  return env[key]?.trim() ?? "";
}

export function loadFileBackedEnv(
  env: NodeJS.ProcessEnv,
  read: (filePath: string) => string = (filePath) => readFileSync(filePath, "utf8"),
): string[] {
  const errors: string[] = [];
  for (const key of FILE_BACKED_ENV) {
    if (trimmed(env, key)) continue;
    const fileKey = `${key}_FILE`;
    const filePath = trimmed(env, fileKey);
    if (!filePath) continue;
    try {
      const value = read(filePath).trim();
      if (!value) {
        errors.push(`${fileKey} is empty`);
        continue;
      }
      env[key] = value;
    } catch {
      errors.push(`${fileKey} is not readable`);
    }
  }
  return errors;
}

export function cookieSecure(env: NodeJS.ProcessEnv): boolean {
  const flag = trimmed(env, "COOKIE_SECURE").toLowerCase();
  if (flag === "1" || flag === "true") return true;
  if (flag === "0" || flag === "false") return false;
  return trimmed(env, "BOTANICAL_PUBLIC_ORIGIN").startsWith("https://");
}

export function providerFlags(env: NodeJS.ProcessEnv): Record<string, boolean> {
  const flags: Record<string, boolean> = {};
  for (const [name, key] of Object.entries(PROVIDER_ENV)) {
    flags[name] = Boolean(trimmed(env, key));
  }
  flags.custom = Boolean(trimmed(env, "CUSTOM_OPENAI_BASE_URL") || trimmed(env, "CUSTOM_OPENAI_API_KEY"));
  return flags;
}

export function searchFlags(env: NodeJS.ProcessEnv): Record<string, boolean> {
  return {
    tavily: Boolean(trimmed(env, "TAVILY_API_KEY")),
    brave: Boolean(trimmed(env, "BRAVE_SEARCH_API_KEY")),
  };
}

function parseDatabaseSsl(url: string, env: NodeJS.ProcessEnv): { ssl: DatabaseSsl | null; error?: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ssl: null, error: "DATABASE_URL is not a valid URL" };
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    return { ssl: null, error: "DATABASE_URL must use the postgresql:// scheme" };
  }
  if (!parsed.hostname) {
    return { ssl: null, error: "DATABASE_URL is missing a host" };
  }
  const fromEnv = trimmed(env, "DATABASE_SSL").toLowerCase();
  const fromUrl = parsed.searchParams.get("sslmode")?.toLowerCase() ?? "";
  const mode = fromEnv || fromUrl;
  if (mode === "verify-full" || mode === "verify-ca") return { ssl: "verify-full" };
  if (mode === "require" || mode === "prefer") return { ssl: "require" };
  return { ssl: null };
}

export function databaseWarnings(url: string, env: NodeJS.ProcessEnv): string[] {
  const warnings: string[] = [];
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return warnings;
  }
  const host = parsed.hostname;
  if (
    trimmed(env, "USE_BUNDLED_DATABASE") !== "0" &&
    (host === "localhost" || host === "127.0.0.1" || host === "::1")
  ) {
    warnings.push(
      "DATABASE_URL host is localhost; inside Compose use the postgres service name as the host",
    );
  }
  const password = trimmed(env, "POSTGRES_PASSWORD");
  if (password && decodeURIComponent(parsed.password) !== password) {
    warnings.push("DATABASE_URL password does not match POSTGRES_PASSWORD");
  }
  if (password === "botanical" || password === "change-me-postgres") {
    warnings.push("POSTGRES_PASSWORD is a published example value; change it before exposing the host");
  }
  return warnings;
}

function parsePort(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const port = Number(raw);
  if (port < 1 || port > 65535) return null;
  return port;
}

function parseLogLevel(raw: string): LogLevel | null {
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") return raw;
  return null;
}

/**
 * Read deployment configuration. Does not print secrets.
 * Mutates `env` when `*_FILE` secrets are loaded into their plain keys.
 */
export function evaluateConfig(env: NodeJS.ProcessEnv): ConfigResult {
  const errors = loadFileBackedEnv(env);
  const warnings: string[] = [];

  const modeRaw = trimmed(env, "DEPLOYMENT_MODE");
  let mode: DeploymentMode | null = null;
  if (modeRaw === "self_host" || modeRaw === "saas") mode = modeRaw;
  else if (!modeRaw) errors.push("DEPLOYMENT_MODE is required (self_host or saas)");
  else errors.push("DEPLOYMENT_MODE must be self_host or saas");

  const passcode = trimmed(env, "BOTANICAL_PASSCODE");
  if (!passcode) errors.push("BOTANICAL_PASSCODE is required");
  else if (passcode.length < 8) errors.push("BOTANICAL_PASSCODE must be at least 8 characters");

  const databaseUrl = trimmed(env, "DATABASE_URL");
  let databaseSsl: DatabaseSsl | null = null;
  if (!databaseUrl) errors.push("DATABASE_URL is required");
  else {
    const parsed = parseDatabaseSsl(databaseUrl, env);
    if (parsed.error) errors.push(parsed.error);
    databaseSsl = parsed.ssl;
    warnings.push(...databaseWarnings(databaseUrl, env));
  }

  const sessionSet = trimmed(env, "BOTANICAL_SESSION_SECRET");
  let sessionSecret = sessionSet;
  let sessionDerived = false;
  if (!sessionSecret && passcode) {
    sessionSecret = createHash("sha256").update(`botanical-session:${passcode}`).digest("hex");
    sessionDerived = true;
  }

  if (mode === "saas") {
    if (passcode && PLACEHOLDER_PASSCODES.has(passcode)) {
      errors.push("saas mode refuses the example BOTANICAL_PASSCODE");
    } else if (passcode && passcode.length < 12) {
      errors.push("saas mode requires BOTANICAL_PASSCODE of at least 12 characters");
    }
    if (!sessionSet || sessionSet.length < 16) {
      errors.push("saas mode requires BOTANICAL_SESSION_SECRET of at least 16 characters");
    } else if (PLACEHOLDER_SECRETS.has(sessionSet)) {
      errors.push("saas mode refuses the example BOTANICAL_SESSION_SECRET");
    }
    const origin = trimmed(env, "BOTANICAL_PUBLIC_ORIGIN");
    if (!origin) warnings.push("saas mode should set BOTANICAL_PUBLIC_ORIGIN to the public https origin");
    else if (origin.startsWith("http://")) {
      warnings.push("saas mode is using an http:// origin; terminate TLS and set an https:// origin");
    }
  } else if (mode === "self_host") {
    if (passcode && PLACEHOLDER_PASSCODES.has(passcode)) {
      warnings.push("BOTANICAL_PASSCODE is still the example value; change it before exposing the port");
    }
    if (sessionSet && PLACEHOLDER_SECRETS.has(sessionSet)) {
      warnings.push("BOTANICAL_SESSION_SECRET is still the example value; change it before exposing the port");
    } else if (sessionDerived) {
      warnings.push("BOTANICAL_SESSION_SECRET is unset; sessions are derived from the passcode");
    }
  }

  const port = parsePort(trimmed(env, "PORT") || "8787");
  if (port === null) errors.push("PORT must be an integer from 1 to 65535");

  const logLevel = parseLogLevel(trimmed(env, "LOG_LEVEL") || "info");
  if (logLevel === null) errors.push("LOG_LEVEL must be debug, info, warn, or error");

  const ttlRaw = trimmed(env, "BOTANICAL_SESSION_TTL_SECONDS") || "604800";
  const sessionTtlSeconds = Number(ttlRaw);
  if (!Number.isInteger(sessionTtlSeconds) || sessionTtlSeconds < 60) {
    errors.push("BOTANICAL_SESSION_TTL_SECONDS must be an integer >= 60");
  }

  const poolRaw = trimmed(env, "DATABASE_POOL_MAX") || "4";
  const poolMax = Number(poolRaw);
  if (!Number.isInteger(poolMax) || poolMax < 1 || poolMax > 50) {
    errors.push("DATABASE_POOL_MAX must be an integer from 1 to 50");
  }

  if (errors.length > 0 || !mode || !databaseUrl || port === null || logLevel === null) {
    return { errors, warnings, config: null };
  }

  return {
    errors,
    warnings,
    config: {
      mode,
      passcode,
      sessionSecret,
      sessionDerived,
      databaseUrl,
      databaseSsl,
      poolMax,
      publicOrigin: trimmed(env, "BOTANICAL_PUBLIC_ORIGIN"),
      cookieSecure: cookieSecure(env),
      serveWeb: ["1", "true", "yes"].includes(trimmed(env, "SERVE_WEB").toLowerCase()),
      webRoot: trimmed(env, "WEB_ROOT") || "/app/public",
      host: trimmed(env, "HOST") || "0.0.0.0",
      port,
      trustProxy: trimmed(env, "TRUST_PROXY") === "1",
      logLevel,
      workspace: trimmed(env, "BOTANICAL_WORKSPACE") || "/data",
      sessionTtlSeconds,
      version: trimmed(env, "BOTANICAL_VERSION") || "0.0.0-dev",
      warnings,
    },
  };
}
