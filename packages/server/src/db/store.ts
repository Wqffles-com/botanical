import type { ServerConfig } from "../config.ts";
import type { Store } from "../types.ts";
import { createMemoryStore } from "./memory.ts";
import { openPostgresStore } from "./postgres.ts";

export { createMemoryStore } from "./memory.ts";

/**
 * DATABASE_URL unset → in-memory store.
 * DATABASE_URL set → packages/db. Missing package throws (no silent fallback).
 */
export async function createStore(config: Pick<ServerConfig, "databaseUrl">): Promise<Store> {
  if (!config.databaseUrl) {
    return createMemoryStore();
  }
  return openPostgresStore(config.databaseUrl);
}
