import type { ServerConfig } from "../config.ts";
import type { Store } from "../types.ts";
import { attachAgentMessages } from "./agent-messages.ts";
import { createMemoryStore } from "./memory.ts";
import { openPostgresStore } from "./postgres.ts";

export { adoptAgentMessages, attachAgentMessages } from "./agent-messages.ts";
export { createMemoryStore } from "./memory.ts";

/**
 * DATABASE_URL unset → in-memory store.
 * DATABASE_URL set → packages/db. Missing package throws (no silent fallback).
 * Agent messages use the db repository when it implements `agentMessages`.
 * Otherwise the same in-memory repository is attached.
 */
export async function createStore(config: Pick<ServerConfig, "databaseUrl">): Promise<Store> {
  if (!config.databaseUrl) {
    return createMemoryStore({ seed: true });
  }
  return attachAgentMessages(await openPostgresStore(config.databaseUrl));
}
