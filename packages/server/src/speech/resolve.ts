import type { ServerConfig, SttProvider } from "../config.ts";

/**
 * What a later per-user / admin-global settings layer needs.
 * `userId` is the authenticated user when the deployment has one.
 */
export interface SttResolveContext {
  config: ServerConfig;
  userId: string | null;
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

async function resolveFromConfig(context: SttResolveContext): Promise<ResolvedStt> {
  const dictation = context.config.dictation;
  if (dictation.mode === "browser") {
    return {
      mode: "browser",
      limits: { maxBytes: dictation.maxBytes, maxSeconds: dictation.maxSeconds },
    };
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
 * Today the result is the env-derived bootstrap on `context.config.dictation`.
 * Per-user and admin-global settings, including API keys stored in the
 * database, belong here later. Env vars stay the bootstrap defaults.
 * `context.userId` is the authenticated user when one exists (v0 passes
 * `"operator"` while a session is present) and is unused until that layer lands.
 */
export async function resolveSttConfig(context: SttResolveContext): Promise<ResolvedStt> {
  return sttConfig.resolve(context);
}
