import { randomUUID } from "node:crypto";
import { BUILTIN_ROLES } from "@botanical/agent-runtime";

import type {
  AgentRoleSummary,
  MemoryPatch,
  MemoryQuery,
  MemoryRecord,
  MemoryRepository,
  NewMemory,
  NewRole,
  RolePatch,
  RolePermissions,
  RoleRecord,
  RoleRepository,
} from "../types.ts";

const ROLE_EPOCH = "2026-09-27T00:00:00.000Z";

/**
 * In-memory memories and roles. Builtin roles are seeded on every store so
 * tests and DATABASE_URL-less servers match the Postgres migration.
 */
export function createPlatform(timestamp: () => string): {
  memories: MemoryRepository;
  roles: RoleRepository;
  summaries(roleIds: readonly string[]): AgentRoleSummary[];
  roleIds(agentId: string): string[];
  onAgentDeleted(agentId: string): void;
} {
  const memories = new Map<string, MemoryRecord>();
  const roles = new Map<string, RoleRecord>();
  const membership = new Map<string, string[]>();

  for (const builtin of BUILTIN_ROLES) {
    roles.set(builtin.id, {
      id: builtin.id,
      name: builtin.name,
      description: builtin.description,
      permissions: {
        capabilities: [...builtin.permissions.capabilities],
        mcp: builtin.permissions.mcp.map((grant) => ({ ...grant, ...(grant.tools ? { tools: [...grant.tools] } : {}) })),
      },
      builtin: true,
      createdAt: ROLE_EPOCH,
      updatedAt: ROLE_EPOCH,
    });
  }

  function summaries(roleIds: readonly string[]): AgentRoleSummary[] {
    const out: AgentRoleSummary[] = [];
    for (const id of roleIds) {
      const role = roles.get(id);
      if (!role) continue;
      out.push({
        id: role.id,
        name: role.name,
        builtin: role.builtin,
        permissions: clonePermissions(role.permissions),
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  function requireKnownRoles(roleIds: readonly string[]): string[] {
    const unique: string[] = [];
    for (const raw of roleIds) {
      const role = roles.get(raw) ?? [...roles.values()].find((item) => item.name === raw);
      if (!role) throw new Error(`Unknown role ${JSON.stringify(raw)}`);
      if (!unique.includes(role.id)) unique.push(role.id);
    }
    return unique;
  }

  const memoryRepo: MemoryRepository = {
    async list(query?: MemoryQuery) {
      const limit = clamp(query?.limit, 50);
      return [...memories.values()]
        .filter((row) => matchesMemory(row, query))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id))
        .slice(0, limit)
        .map(clone);
    },
    async listVisible(agentId, opts) {
      const limit = clamp(opts?.limit, 200);
      return [...memories.values()]
        .filter((row) => row.scope === "shared" || (row.scope === "agent" && row.agentId === agentId))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id))
        .slice(0, limit)
        .map(clone);
    },
    async get(id) {
      const row = memories.get(id);
      return row ? clone(row) : null;
    },
    async create(input: NewMemory) {
      if (input.scope !== "shared" && input.scope !== "agent") throw new Error("scope must be shared or agent");
      const content = input.content.trim();
      if (!content) throw new Error("content is required");
      const agentId = input.agentId ?? null;
      if (input.scope === "agent" && !agentId) throw new Error("agent scope requires agentId");
      const now = timestamp();
      const row: MemoryRecord = {
        id: randomUUID(),
        scope: input.scope,
        agentId,
        content,
        tags: normalizeTags(input.tags),
        createdAt: now,
        updatedAt: now,
      };
      memories.set(row.id, row);
      return clone(row);
    },
    async update(id, patch: MemoryPatch) {
      const current = memories.get(id);
      if (!current) return null;
      const next: MemoryRecord = { ...current, tags: [...current.tags], updatedAt: timestamp() };
      if (patch.content !== undefined) {
        const content = patch.content.trim();
        if (!content) throw new Error("content is required");
        next.content = content;
      }
      if (patch.tags !== undefined) next.tags = normalizeTags(patch.tags);
      memories.set(id, next);
      return clone(next);
    },
    async delete(id) {
      return memories.delete(id);
    },
    async deleteVisible(id, agentId) {
      const row = memories.get(id);
      if (!row) return "missing";
      if (row.scope === "agent" && row.agentId !== agentId) return "forbidden";
      memories.delete(id);
      return "deleted";
    },
  };

  const roleRepo: RoleRepository = {
    async list() {
      return [...roles.values()].sort((a, b) => a.name.localeCompare(b.name)).map(clone);
    },
    async get(id) {
      const role = roles.get(id);
      return role ? clone(role) : null;
    },
    async getByName(name) {
      const role = [...roles.values()].find((item) => item.name === name);
      return role ? clone(role) : null;
    },
    async create(input: NewRole) {
      const name = input.name.trim();
      if (!name) throw new Error("name is required");
      if ([...roles.values()].some((role) => role.name === name)) throw new Error(`Role ${JSON.stringify(name)} already exists`);
      const now = timestamp();
      const row: RoleRecord = {
        id: randomUUID(),
        name,
        description: input.description?.trim() ?? "",
        permissions: clonePermissions(input.permissions),
        builtin: false,
        createdAt: now,
        updatedAt: now,
      };
      roles.set(row.id, row);
      return clone(row);
    },
    async update(id, patch: RolePatch) {
      const current = roles.get(id);
      if (!current) return null;
      const next: RoleRecord = {
        ...current,
        permissions: clonePermissions(current.permissions),
        updatedAt: timestamp(),
      };
      if (patch.name !== undefined) next.name = patch.name.trim();
      if (patch.description !== undefined) next.description = patch.description;
      if (patch.permissions !== undefined) next.permissions = clonePermissions(patch.permissions);
      roles.set(id, next);
      return clone(next);
    },
    async delete(id) {
      const current = roles.get(id);
      if (!current) return false;
      if (current.builtin) throw new Error("builtin roles cannot be deleted");
      for (const [, ids] of membership) {
        if (ids.includes(id)) throw new Error("role is still assigned");
      }
      return roles.delete(id);
    },
    async listForAgent(agentId) {
      return summaries(membership.get(agentId) ?? []).map((summary) => {
        const role = roles.get(summary.id);
        if (!role) throw new Error("role missing");
        return clone(role);
      });
    },
    async setForAgent(agentId, roleIds) {
      const unique = requireKnownRoles(roleIds);
      membership.set(agentId, unique);
      return this.listForAgent(agentId);
    },
  };

  return {
    memories: memoryRepo,
    roles: roleRepo,
    summaries,
    roleIds(agentId: string) {
      return [...(membership.get(agentId) ?? [])];
    },
    onAgentDeleted(agentId) {
      membership.delete(agentId);
      for (const [id, row] of memories) {
        if (row.agentId === agentId) memories.delete(id);
      }
    },
  };
}

function matchesMemory(row: MemoryRecord, query: MemoryQuery | undefined): boolean {
  if (!query) return true;
  if (query.scope && row.scope !== query.scope) return false;
  if (query.agentId && row.agentId !== query.agentId) return false;
  if (query.tag && !row.tags.includes(query.tag)) return false;
  if (query.q && !row.content.toLowerCase().includes(query.q.trim().toLowerCase())) return false;
  return true;
}

function normalizeTags(tags: readonly string[] | undefined): string[] {
  if (!tags) return [];
  const out: string[] = [];
  for (const tag of tags) {
    const text = tag.trim();
    if (!text || out.includes(text)) continue;
    out.push(text);
  }
  return out;
}

function clonePermissions(permissions: {
  capabilities: readonly string[];
  mcp: ReadonlyArray<{ server: string; tools?: readonly string[] }>;
}): RolePermissions {
  return {
    capabilities: [...permissions.capabilities],
    mcp: permissions.mcp.map((grant) => ({
      server: grant.server,
      ...(grant.tools ? { tools: [...grant.tools] } : {}),
    })),
  };
}

function clamp(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(200, Math.floor(value)));
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
