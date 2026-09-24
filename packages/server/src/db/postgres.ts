import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Store } from "../types.ts";
import { attachAgentMessages } from "./agent-messages.ts";

/**
 * TODO(packages/db): Postgres is not wired in this workspace yet.
 *
 * When packages/db lands, export:
 *
 *   export function createStore(options: { connectionString: string }): Promise<Store>;
 *
 * The Store shape is defined in src/types.ts (agents, chats, messages, sessions)
 * and must use kind: "postgres".
 *
 * Suggested tables (docs/ARCHITECTURE.md):
 *   agents(id, name, description, system_prompt, tool_ids jsonb, created_at, updated_at)
 *   chats(id, agent_id, profile_id, title, created_at, updated_at)
 *     — one owning agent per chat; do not update agent_id
 *   messages(id, chat_id, role, content, tool_calls, tool_call_id, name, profile_id, created_at)
 *     — tool rows set tool_call_id; assistant rows may set tool_calls.
 *   sessions(id, token_hash, created_at, expires_at)
 *     — store the sha256 of the bearer/cookie token, never the raw token
 *   agent_messages(id, from_agent, to_agent, body, status, created_at, updated_at)
 *     — implement Store.agentMessages (insert, get, listForAgent, deliverPending,
 *       markRead, updateStatus). deliverPending must SKIP LOCKED.
 *
 * Chat delete should remove the chat and its messages in one transaction.
 * This module does not import a Postgres driver; packages/db owns the pool.
 * If createStore() omits agentMessages, the server attaches the in-memory
 * repository (see src/db/agent-messages.ts) rather than failing boot.
 */
export const POSTGRES_NOT_WIRED =
  "DATABASE_URL is set but packages/db is not available or does not export createStore(). " +
  "TODO: wire Postgres through packages/db. Unset DATABASE_URL to use the in-memory store.";

interface DbModule {
  createStore?: (options: { connectionString: string }) => Promise<Store> | Store;
}

export async function openPostgresStore(connectionString: string): Promise<Store> {
  const loaded = await loadDbModule();
  if (!loaded?.createStore) {
    throw new Error(POSTGRES_NOT_WIRED);
  }
  let created: Store;
  try {
    created = await loaded.createStore({ connectionString });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`packages/db createStore() failed: ${message}`);
  }
  if (!isPostgresStore(created)) {
    throw new Error(
      'packages/db createStore() must return a Store with kind "postgres" and agents, chats, messages, and sessions repositories.',
    );
  }
  return attachAgentMessages(created);
}

async function loadDbModule(): Promise<DbModule | null> {
  const here = dirname(fileURLToPath(import.meta.url));
  const packageRoot = join(here, "../../../db");
  const specs = entrySpecifiers(packageRoot);
  const installed = join(here, "../../node_modules/@botanical/db/package.json");
  if (existsSync(installed)) specs.push("@botanical/db");
  if (!existsSync(packageRoot) && specs.length === 0) return null;
  if (specs.length === 0) {
    throw new Error(
      "packages/db is present but has no importable entry. Export createStore from src/index.ts or package.json exports.",
    );
  }

  let lastError: unknown;
  for (const spec of specs) {
    try {
      return (await import(spec)) as DbModule;
    } catch (err) {
      lastError = err;
    }
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`${POSTGRES_NOT_WIRED} Import failed: ${detail}`);
}

function entrySpecifiers(packageRoot: string): string[] {
  const specs: string[] = [];
  const pkgPath = join(packageRoot, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { main?: unknown; exports?: unknown };
      const target = exportTarget(pkg.exports) ?? (typeof pkg.main === "string" ? pkg.main : undefined);
      if (target) specs.push(target.startsWith(".") ? join(packageRoot, target) : target);
    } catch {
      // Conventional paths below still apply when package.json is unreadable.
    }
  }
  for (const relative of ["src/index.ts", "src/index.js", "index.ts", "index.js"]) {
    const candidate = join(packageRoot, relative);
    if (existsSync(candidate) && !specs.includes(candidate)) specs.push(candidate);
  }
  return specs;
}

function exportTarget(exports: unknown): string | undefined {
  if (typeof exports === "string") return exports;
  if (!exports || typeof exports !== "object") return undefined;
  const record = exports as Record<string, unknown>;
  const dot = "." in record ? record["."] : undefined;
  if (typeof dot === "string") return dot;
  if (dot && typeof dot === "object") {
    const conditions = dot as Record<string, unknown>;
    for (const key of ["bun", "import", "default", "node"]) {
      const value = conditions[key];
      if (typeof value === "string") return value;
    }
  }
  return undefined;
}

function isPostgresStore(value: unknown): value is Store {
  if (!value || typeof value !== "object") return false;
  const store = value as Partial<Store>;
  return (
    store.kind === "postgres" &&
    typeof store.agents?.list === "function" &&
    typeof store.agents.get === "function" &&
    typeof store.chats?.list === "function" &&
    typeof store.chats.get === "function" &&
    typeof store.messages?.listByChat === "function" &&
    typeof store.messages.create === "function" &&
    typeof store.sessions?.getByTokenHash === "function" &&
    typeof store.sessions.create === "function"
  );
}
