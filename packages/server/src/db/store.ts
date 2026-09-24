import type { ServerConfig } from "../config.ts";
import type { Store } from "../types.ts";
import { createMemoryStore } from "./memory.ts";
import { openPostgresStore } from "./postgres.ts";

export { createMemoryStore } from "./memory.ts";

/**
 * DATABASE_URL unset → in-memory store.
 * DATABASE_URL set → packages/db, after Drizzle migrations. Missing package throws (no silent fallback).
 * Configured profiles are upserted as metadata so chats can reference them. API keys stay in the environment.
 */
export async function createStore(config: Pick<ServerConfig, "databaseUrl" | "profiles">): Promise<Store> {
  if (!config.databaseUrl) {
    return createMemoryStore();
  }
  const store = await openPostgresStore(config.databaseUrl);
  try {
    for (const profile of config.profiles) {
      await store.profiles.upsert({ ...profile });
    }
  } catch (error) {
    await store.close();
    throw error;
  }
  return store;
}
