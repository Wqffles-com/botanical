import { EncryptionKeyMissing } from "@botanical/db";
import type { ServerConfig } from "../config.ts";
import type { Store } from "../types.ts";
import { attachAgentMessages } from "./agent-messages.ts";
import { createMemoryStore } from "./memory.ts";
import { openPostgresStore } from "./postgres.ts";

export { adoptAgentMessages, attachAgentMessages } from "./agent-messages.ts";
export { createMemoryStore } from "./memory.ts";

/**
 * DATABASE_URL unset → in-memory store (seeded example agents).
 * DATABASE_URL set → packages/db, after Drizzle migrations. Missing package throws (no silent fallback).
 * Configured profiles are upserted as metadata so chats can reference them. API keys stay in the environment.
 * Agent messages use the db repository when it implements the runtime contract.
 * Otherwise the same in-memory repository is attached.
 */
export async function createStore(
  config: Pick<ServerConfig, "databaseUrl" | "profiles" | "encryptionKey" | "dictation">,
  env: Record<string, string | undefined> = process.env,
): Promise<Store> {
  if (!config.databaseUrl) {
    const store = createMemoryStore({ seed: true, ...(config.encryptionKey ? { encryptionKey: config.encryptionKey } : {}) });
    await seedInstance(store, config, env);
    return store;
  }
  const store = await openPostgresStore(config.databaseUrl, config.encryptionKey ?? undefined);
  try {
    await seedInstance(attachAgentMessages(store), config, env);
  } catch (error) {
    await store.close();
    throw error;
  }
  return attachAgentMessages(store);
}

/** First boot copies env profiles, provider keys, and speech settings into the database. Later edits win. */
export async function seedInstance(
  store: Store,
  config: Pick<ServerConfig, "profiles" | "encryptionKey" | "dictation">,
  env: Record<string, string | undefined>,
): Promise<void> {
  const globals = await store.globalProfiles.list();
  if (globals.length === 0) {
    for (const profile of config.profiles) {
      await store.globalProfiles.upsert({ ...profile });
    }
  }
  if (config.encryptionKey) {
    const seeded: Array<[string, string | undefined]> = [
      ["openai", env.OPENAI_API_KEY],
      ["anthropic", env.ANTHROPIC_API_KEY],
      ["xai", env.XAI_API_KEY],
      ["deepseek", env.DEEPSEEK_API_KEY],
      ["openrouter", env.OPENROUTER_API_KEY],
      ["dashscope", env.DASHSCOPE_API_KEY],
      ["openai-compat", env.OPENAI_COMPAT_API_KEY ?? env.CUSTOM_OPENAI_API_KEY],
      ["stt", env.BOTANICAL_STT_API_KEY],
    ];
    for (const [name, value] of seeded) {
      const trimmed = value?.trim() ?? "";
      if (!trimmed) continue;
      if (await store.secrets.hasGlobal(name)) continue;
      try {
        await store.secrets.putGlobal(name, trimmed);
      } catch (error) {
        if (error instanceof EncryptionKeyMissing) continue;
        throw error;
      }
    }
  }
  const mode = await store.prefs.getGlobal("stt.mode");
  if (mode === undefined) {
    const dictation = config.dictation;
    if (dictation.mode === "browser") {
      await store.prefs.setGlobal("stt.mode", "browser");
    } else {
      await store.prefs.setGlobal("stt.mode", "server");
      await store.prefs.setGlobal("stt.provider", dictation.provider);
      await store.prefs.setGlobal("stt.base_url", dictation.baseUrl);
      await store.prefs.setGlobal("stt.model", dictation.model);
    }
    await store.prefs.setGlobal("stt.max_bytes", dictation.maxBytes);
    await store.prefs.setGlobal("stt.max_seconds", dictation.maxSeconds);
  }
}
