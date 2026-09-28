import type { ServerConfig, SttProvider } from "../config.ts";
import { STT_PROVIDERS } from "../config.ts";
import type { Store } from "../types.ts";

/**
 * Speech settings come from the database: a user's row overrides the admin global row.
 * `config.dictation` is only the bootstrap used when the database has no speech settings yet.
 */
export interface SttResolveContext {
  config: ServerConfig;
  userId: string | null;
  store?: Store;
}

export type ResolvedStt =
  | {
      mode: "server";
      provider: SttProvider;
      baseUrl: string;
      apiKey: string | null;
      model: string;
      limits: { maxBytes: number; maxSeconds: number };
    }
  | {
      mode: "browser";
      limits: { maxBytes: number; maxSeconds: number };
    };

function fromDictation(context: SttResolveContext): ResolvedStt {
  const dictation = context.config.dictation;
  if (dictation.mode === "browser") {
    return { mode: "browser", limits: { maxBytes: dictation.maxBytes, maxSeconds: dictation.maxSeconds } };
  }
  return {
    mode: "server",
    provider: dictation.provider,
    baseUrl: dictation.baseUrl,
    apiKey: dictation.apiKey,
    model: dictation.model,
    limits: { maxBytes: dictation.maxBytes, maxSeconds: dictation.maxSeconds },
  };
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

async function resolveFromConfig(context: SttResolveContext): Promise<ResolvedStt> {
  const fallback = fromDictation(context);
  if (!context.store) return fallback;
  const global = await context.store.prefs.globalByPrefix("stt.");
  const user = context.userId ? await context.store.prefs.userByPrefix(context.userId, "stt.") : {};
  if (global["stt.mode"] === undefined && Object.keys(user).length === 0) return fallback;
  const merged = { ...global, ...user };
  const limits = {
    maxBytes: readNumber(merged["stt.max_bytes"], fallback.mode === "browser" ? fallback.limits.maxBytes : fallback.limits.maxBytes),
    maxSeconds: readNumber(merged["stt.max_seconds"], fallback.limits.maxSeconds),
  };
  if (merged["stt.mode"] === "browser") return { mode: "browser", limits };
  const providerRaw = readString(merged["stt.provider"]) ?? (fallback.mode === "server" ? fallback.provider : "openai-compat");
  const provider = (STT_PROVIDERS as readonly string[]).includes(providerRaw) ? (providerRaw as SttProvider) : "openai-compat";
  const baseUrl = readString(merged["stt.base_url"]) ?? (fallback.mode === "server" ? fallback.baseUrl : "");
  const model = readString(merged["stt.model"]) ?? (fallback.mode === "server" ? fallback.model : "");
  let apiKey: string | null = null;
  if (context.userId) apiKey = await context.store.secrets.revealUser(context.userId, "stt");
  if (!apiKey) {
    const user = context.userId ? await context.store.accounts.findById(context.userId) : null;
    const allow = await context.store.accounts.allowGlobalKeys();
    if (!user || user.role === "admin" || allow) apiKey = await context.store.secrets.revealGlobal("stt");
  }
  if (!apiKey && fallback.mode === "server") apiKey = fallback.apiKey;
  return { mode: "server", provider, baseUrl, apiKey, model, limits };
}

/**
 * Holder so tests can prove routes call {@link resolveSttConfig}.
 * Production uses {@link resolveFromConfig}.
 */
export const sttConfig = {
  resolve: resolveFromConfig,
};

/**
 * Resolve speech-to-text settings for one request.
 *
 * This is the only seam that reads dictation configuration. Routes call it
 * and pass the result into adapters. Adapters do not read env or config.
 * Per-user rows override admin-global rows. API keys are decrypted here and
 * never returned to the browser. Env vars only seed the database on first boot.
 */
export async function resolveSttConfig(context: SttResolveContext): Promise<ResolvedStt> {
  return sttConfig.resolve(context);
}
