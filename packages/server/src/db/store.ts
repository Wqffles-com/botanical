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
export async function createStore(config: Pick<ServerConfig, "databaseUrl" | "profiles">): Promise<Store> {
  if (!config.databaseUrl) {
    return createMemoryStore({ seed: true });
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
  return attachAgentMessages(store);
}
