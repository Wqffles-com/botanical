import { CANONICAL_API_KEY_ENVS, type Env } from "@botanical/providers";
import { currentUserId } from "@botanical/db";

import type { Store } from "./types.ts";

const SECRET_FOR_PROVIDER: Record<string, string> = {
  openai: "openai",
  anthropic: "anthropic",
  xai: "xai",
  deepseek: "deepseek",
  openrouter: "openrouter",
  "openai-compat": "openai-compat",
};

/** Env object for one provider call. Values come from the database, not process.env. */
export async function providerKeyEnv(store: Store, provider: string): Promise<Env> {
  const secretName = SECRET_FOR_PROVIDER[provider];
  if (!secretName) return {};
  const userId = currentUserId();
  const own = userId ? await store.secrets.revealUser(userId, secretName) : null;
  let globalKey: string | null = null;
  if (!own) {
    const user = userId ? await store.accounts.findById(userId) : null;
    const allow = await store.accounts.allowGlobalKeys();
    if (!user || user.role === "admin" || allow) globalKey = await store.secrets.revealGlobal(secretName);
  }
  const key = own ?? globalKey;
  if (!key) return {};
  const env: Env = {};
  if (provider === "openai-compat") {
    env.OPENAI_COMPAT_API_KEY = key;
    env.CUSTOM_OPENAI_API_KEY = key;
    return env;
  }
  const envName = CANONICAL_API_KEY_ENVS[provider as keyof typeof CANONICAL_API_KEY_ENVS];
  if (envName) env[envName] = key;
  return env;
}
