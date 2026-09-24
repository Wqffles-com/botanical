import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Store } from "../types.ts";
import { attachAgentMessages } from "./agent-messages.ts";

/**
 * Load `@botanical/db` when DATABASE_URL is set.
 *
 * packages/db exports `createStore({ connectionString })`, runs Drizzle
 * migrations, and returns a Store with kind "postgres". This module does not
 * import a Postgres driver; packages/db owns the pool.
 *
 * The Store covers agents (name, Lucide icon, color, default profile suggestion),
 * chats, messages including tool calls, profile metadata, agent messages, and
 * sessions (token hash only). When the db repository has `list`/`create` but not
 * the runtime bus methods, those methods are filled in here. If `agentMessages`
 * is missing entirely, `attachAgentMessages` keeps an in-memory repository.
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
  return attachAgentMessages(bridgeAgentMessages(created));
}

/**
 * packages/db persists agent mail with list/get/create/update.
 * The runtime bus also needs insert, listForAgent, deliverPending, markRead, and updateStatus.
 */
function bridgeAgentMessages(store: Store): Store {
  const repo = store.agentMessages;
  if (
    typeof repo.insert === "function" &&
    typeof repo.listForAgent === "function" &&
    typeof repo.deliverPending === "function" &&
    typeof repo.markRead === "function" &&
    typeof repo.updateStatus === "function"
  ) {
    return store;
  }
  return {
    ...store,
    agentMessages: {
      list: (query) => repo.list(query),
      get: (id) => repo.get(id),
      create: (input) => repo.create(input),
      update: (id, patch) => repo.update(id, patch),
      async insert(input) {
        return repo.create({
          fromAgentId: input.fromAgentId,
          toAgentId: input.toAgentId,
          body: input.body,
          ...(input.id ? { id: input.id } : {}),
          ...(input.fromChatId ? { fromChatId: input.fromChatId } : {}),
        });
      },
      async listForAgent(agentId, opts) {
        const rows = await repo.list({ agentId });
        const filtered = rows.filter((message) => {
          if (message.toAgentId !== agentId) return false;
          if (opts?.status && opts.status.length > 0 && !opts.status.includes(message.status)) return false;
          return true;
        });
        filtered.sort((a, b) => {
          const byTime = a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
          return opts?.newestFirst ? -byTime : byTime;
        });
        return filtered.slice(0, opts?.limit ?? 100);
      },
      async deliverPending(opts) {
        const limit = opts?.limit ?? 50;
        const rows = await repo.list({
          ...(opts?.toAgentId ? { agentId: opts.toAgentId } : {}),
          status: "pending",
        });
        const pending = rows
          .filter((message) => message.status === "pending")
          .filter((message) => !opts?.toAgentId || message.toAgentId === opts.toAgentId)
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
        const delivered = [];
        for (const row of pending) {
          if (delivered.length >= limit) break;
          const updated = await repo.update(row.id, { status: "delivered" });
          if (updated) delivered.push({ ...updated, deliveredAt: updated.deliveredAt ?? updated.updatedAt });
        }
        return delivered;
      },
      async markRead(ids) {
        const updated = [];
        for (const id of ids) {
          const current = await repo.get(id);
          if (!current || current.status !== "delivered") continue;
          const next = await repo.update(id, { status: "read" });
          if (next) updated.push({ ...next, readAt: next.readAt ?? next.updatedAt });
        }
        return updated;
      },
      async updateStatus(id, status) {
        const current = await repo.get(id);
        if (!current) return null;
        if (current.status === status) return current;
        const next = await repo.update(id, { status });
        if (!next) return null;
        return {
          ...next,
          ...(status === "delivered" ? { deliveredAt: next.deliveredAt ?? next.updatedAt } : {}),
          ...(status === "read" ? { readAt: next.readAt ?? next.updatedAt } : {}),
        };
      },
    },
  };
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
    typeof store.sessions.create === "function" &&
    typeof store.profiles?.list === "function" &&
    typeof store.profiles.upsert === "function" &&
    typeof store.agentMessages?.list === "function" &&
    typeof store.agentMessages.create === "function" &&
    typeof store.close === "function"
  );
}
