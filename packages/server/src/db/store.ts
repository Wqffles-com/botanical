import { EncryptionKeyMissing } from "@botanical/db";
import { ANTHROPIC_DEFAULT_MAX_TOKENS, retiredModelReplacement } from "@botanical/providers";
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
  const seeded = new Set(readSeededIds(await store.prefs.getGlobal(SEEDED_PROFILES_PREF)));
  if (globals.length === 0) {
    for (const profile of config.profiles) {
      await store.globalProfiles.upsert({ ...profile });
      seeded.add(profile.id);
    }
  } else {
    // Profiles added to the configured list after first boot (new built-in
    // models, BOTANICAL_CLI_PROFILES) must reach the chat profile list too.
    // Each id is seeded once, so a profile an admin deletes stays deleted.
    const known = new Set(globals.map((profile) => profile.id));
    const names = new Set(globals.map((profile) => profile.name));
    for (const profile of config.profiles) {
      if (known.has(profile.id) || names.has(profile.name)) continue;
      const kind = profile.kind ?? (profile.provider === "cli" ? "cli" : "api");
      if (kind !== "cli" && seeded.has(profile.id)) continue;
      await store.globalProfiles.upsert({ ...profile });
      seeded.add(profile.id);
    }
    // A vendor that removes a model breaks every profile still pinned to it,
    // and an Anthropic profile without maxTokens cannot run at all.
    for (const profile of globals) {
      const replacement = retiredModelReplacement(profile.provider, profile.model);
      const missingMaxTokens = profile.provider === "anthropic" && profile.maxTokens === undefined;
      if (!replacement && !missingMaxTokens) continue;
      await store.globalProfiles.upsert({
        ...profile,
        ...(replacement ? { model: replacement } : {}),
        ...(missingMaxTokens ? { maxTokens: ANTHROPIC_DEFAULT_MAX_TOKENS } : {}),
      });
    }
  }
  await store.prefs.setGlobal(SEEDED_PROFILES_PREF, [...seeded]);
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

/** Profile ids already copied from the configured list, so deleted ones are not re-added. */
const SEEDED_PROFILES_PREF = "profiles.seeded";

function readSeededIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
