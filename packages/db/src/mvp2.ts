import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';

import type { BotanicalDb } from './client.ts';
import { agentRoles } from './schema/roles.ts';
import { agents } from './schema/agents.ts';
import { memories } from './schema/memories.ts';
import { roles } from './schema/roles.ts';
import type { StoredRolePermissions } from './types.ts';

export interface RolePermissions {
  capabilities: string[];
  mcp: Array<{ server: string; tools?: string[] }>;
}

export interface RoleRecord {
  id: string;
  name: string;
  description: string;
  permissions: RolePermissions;
  builtin: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRoleSummary {
  id: string;
  name: string;
  builtin: boolean;
  permissions: RolePermissions;
}

export type MemoryScope = 'shared' | 'agent';

export interface MemoryRecord {
  id: string;
  scope: MemoryScope;
  agentId: string | null;
  content: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface MemoryQuery {
  scope?: MemoryScope;
  agentId?: string;
  q?: string;
  tag?: string;
  limit?: number;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createMvp2(db: BotanicalDb, userId: string) {
  async function loadRoles(agentIds: readonly string[]): Promise<Map<string, AgentRoleSummary[]>> {
    const ids = agentIds.filter((id) => UUID_PATTERN.test(id));
    const grouped = new Map<string, AgentRoleSummary[]>();
    if (ids.length === 0) return grouped;
    const rows = await db
      .select({ agentId: agentRoles.agentId, role: roles })
      .from(agentRoles)
      .innerJoin(roles, eq(agentRoles.roleId, roles.id))
      .where(inArray(agentRoles.agentId, ids))
      .orderBy(asc(roles.name));
    for (const row of rows) {
      const list = grouped.get(row.agentId) ?? [];
      list.push(toSummary(row.role));
      grouped.set(row.agentId, list);
    }
    return grouped;
  }

  async function setAgentRoles(agentId: string, roleIds: readonly string[]): Promise<RoleRecord[]> {
    if (!UUID_PATTERN.test(agentId)) return [];
    const unique = [...new Set(roleIds)];
    for (const roleId of unique) {
      if (!UUID_PATTERN.test(roleId)) throw new Error(`Unknown role ${JSON.stringify(roleId)}`);
    }
    if (unique.length > 0) {
      const found = await db.select({ id: roles.id }).from(roles).where(inArray(roles.id, unique));
      if (found.length !== unique.length) throw new Error('Unknown role');
    }
    await db.transaction(async (tx) => {
      await tx.delete(agentRoles).where(eq(agentRoles.agentId, agentId));
      if (unique.length > 0) {
        await tx.insert(agentRoles).values(unique.map((roleId) => ({ agentId, roleId })));
      }
    });
    return listForAgent(agentId);
  }

  async function listForAgent(agentId: string): Promise<RoleRecord[]> {
    if (!UUID_PATTERN.test(agentId)) return [];
    const rows = await db
      .select({ role: roles })
      .from(agentRoles)
      .innerJoin(roles, eq(agentRoles.roleId, roles.id))
      .where(eq(agentRoles.agentId, agentId))
      .orderBy(asc(roles.name));
    return rows.map((row) => toRole(row.role));
  }

  return {
    loadRoles,
    memories: {
      async list(query: MemoryQuery = {}): Promise<MemoryRecord[]> {
        const filters = [eq(memories.userId, userId)];
        if (query.scope) filters.push(eq(memories.scope, query.scope));
        if (query.agentId) {
          if (!UUID_PATTERN.test(query.agentId)) return [];
          filters.push(eq(memories.agentId, query.agentId));
        }
        if (query.q?.trim()) filters.push(ilike(memories.content, `%${escapeLike(query.q.trim())}%`));
        if (query.tag?.trim()) filters.push(sql`${query.tag.trim()} = ANY(${memories.tags})`);
        const limit = clampLimit(query.limit);
        const rows = await db
          .select()
          .from(memories)
          .where(and(...filters))
          .orderBy(desc(memories.updatedAt), desc(memories.id))
          .limit(limit);
        return rows.map(toMemory);
      },
      async listVisible(agentId: string, opts?: { limit?: number }): Promise<MemoryRecord[]> {
        if (!UUID_PATTERN.test(agentId)) return [];
        const rows = await db
          .select()
          .from(memories)
          .where(
            and(
              eq(memories.userId, userId),
              or(eq(memories.scope, 'shared'), and(eq(memories.scope, 'agent'), eq(memories.agentId, agentId))),
            ),
          )
          .orderBy(desc(memories.updatedAt), desc(memories.id))
          .limit(clampLimit(opts?.limit, 200));
        return rows.map(toMemory);
      },
      async get(id: string): Promise<MemoryRecord | null> {
        if (!UUID_PATTERN.test(id)) return null;
        const rows = await db
          .select()
          .from(memories)
          .where(and(eq(memories.id, id), eq(memories.userId, userId)))
          .limit(1);
        return rows[0] ? toMemory(rows[0]) : null;
      },
      async create(input: {
        scope: MemoryScope;
        agentId?: string | null;
        content: string;
        tags?: string[];
      }): Promise<MemoryRecord> {
        const scope = input.scope;
        if (scope !== 'shared' && scope !== 'agent') throw new Error('scope must be shared or agent');
        const content = input.content.trim();
        if (!content) throw new Error('content is required');
        const agentId = input.agentId ?? null;
        if (scope === 'agent' && !agentId) throw new Error('agent scope requires agentId');
        if (agentId && !UUID_PATTERN.test(agentId)) throw new Error('agent not found');
        if (agentId) {
          const owner = await db
            .select({ id: agents.id })
            .from(agents)
            .where(and(eq(agents.id, agentId), eq(agents.userId, userId)))
            .limit(1);
          if (!owner[0]) throw new Error('agent not found');
        }
        const inserted = await db
          .insert(memories)
          .values({
            userId,
            scope,
            agentId,
            content,
            tags: normalizeTags(input.tags),
          })
          .returning();
        const row = inserted[0];
        if (!row) throw new Error('memory insert failed');
        return toMemory(row);
      },
      async update(
        id: string,
        patch: { content?: string; tags?: string[] },
      ): Promise<MemoryRecord | null> {
        if (!UUID_PATTERN.test(id)) return null;
        const values: { content?: string; tags?: string[]; updatedAt: Date } = { updatedAt: new Date() };
        if (patch.content !== undefined) {
          const content = patch.content.trim();
          if (!content) throw new Error('content is required');
          values.content = content;
        }
        if (patch.tags !== undefined) values.tags = normalizeTags(patch.tags);
        const updated = await db
          .update(memories)
          .set(values)
          .where(and(eq(memories.id, id), eq(memories.userId, userId)))
          .returning();
        return updated[0] ? toMemory(updated[0]) : null;
      },
      async delete(id: string): Promise<boolean> {
        if (!UUID_PATTERN.test(id)) return false;
        const removed = await db
          .delete(memories)
          .where(and(eq(memories.id, id), eq(memories.userId, userId)))
          .returning({ id: memories.id });
        return removed.length > 0;
      },
      async deleteVisible(id: string, agentId: string): Promise<'deleted' | 'missing' | 'forbidden'> {
        const row = await this.get(id);
        if (!row) return 'missing';
        if (row.scope === 'agent' && row.agentId !== agentId) return 'forbidden';
        const removed = await this.delete(id);
        return removed ? 'deleted' : 'missing';
      },
    },
    roles: {
      async list(): Promise<RoleRecord[]> {
        const rows = await db.select().from(roles).orderBy(asc(roles.name));
        return rows.map(toRole);
      },
      async get(id: string): Promise<RoleRecord | null> {
        if (!UUID_PATTERN.test(id)) return null;
        const rows = await db.select().from(roles).where(eq(roles.id, id)).limit(1);
        return rows[0] ? toRole(rows[0]) : null;
      },
      async getByName(name: string): Promise<RoleRecord | null> {
        const rows = await db.select().from(roles).where(eq(roles.name, name)).limit(1);
        return rows[0] ? toRole(rows[0]) : null;
      },
      async create(input: {
        name: string;
        description?: string;
        permissions: RolePermissions;
      }): Promise<RoleRecord> {
        const inserted = await db
          .insert(roles)
          .values({
            name: input.name.trim(),
            description: input.description?.trim() ?? '',
            permissions: input.permissions,
            builtin: false,
          })
          .returning();
        const row = inserted[0];
        if (!row) throw new Error('role insert failed');
        return toRole(row);
      },
      async update(
        id: string,
        patch: { name?: string; description?: string; permissions?: RolePermissions },
      ): Promise<RoleRecord | null> {
        if (!UUID_PATTERN.test(id)) return null;
        const values: {
          name?: string;
          description?: string;
          permissions?: RolePermissions;
          updatedAt: Date;
        } = { updatedAt: new Date() };
        if (patch.name !== undefined) values.name = patch.name.trim();
        if (patch.description !== undefined) values.description = patch.description;
        if (patch.permissions !== undefined) values.permissions = patch.permissions;
        const updated = await db.update(roles).set(values).where(eq(roles.id, id)).returning();
        return updated[0] ? toRole(updated[0]) : null;
      },
      async delete(id: string): Promise<boolean> {
        if (!UUID_PATTERN.test(id)) return false;
        const current = await db.select().from(roles).where(eq(roles.id, id)).limit(1);
        const row = current[0];
        if (!row) return false;
        if (row.builtin) throw new Error('builtin roles cannot be deleted');
        const assigned = await db.select({ agentId: agentRoles.agentId }).from(agentRoles).where(eq(agentRoles.roleId, id)).limit(1);
        if (assigned[0]) throw new Error('role is still assigned');
        const removed = await db.delete(roles).where(eq(roles.id, id)).returning({ id: roles.id });
        return removed.length > 0;
      },
      listForAgent,
      setForAgent: setAgentRoles,
    },
  };
}

function toRole(row: typeof roles.$inferSelect): RoleRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    permissions: normalizePermissions(row.permissions),
    builtin: row.builtin,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function toSummary(row: typeof roles.$inferSelect): AgentRoleSummary {
  const role = toRole(row);
  return { id: role.id, name: role.name, builtin: role.builtin, permissions: role.permissions };
}

function toMemory(row: typeof memories.$inferSelect): MemoryRecord {
  return {
    id: row.id,
    scope: row.scope === 'agent' ? 'agent' : 'shared',
    agentId: row.agentId,
    content: row.content,
    tags: row.tags ?? [],
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function normalizePermissions(value: StoredRolePermissions | null): RolePermissions {
  const capabilities = Array.isArray(value?.capabilities)
    ? value.capabilities.filter((item): item is string => typeof item === 'string')
    : [];
  const mcp = Array.isArray(value?.mcp)
    ? value.mcp
        .filter((item) => item && typeof item.server === 'string')
        .map((item) => ({
          server: item.server,
          ...(Array.isArray(item.tools) ? { tools: item.tools.filter((tool) => typeof tool === 'string') } : {}),
        }))
    : [];
  return { capabilities, mcp };
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

function clampLimit(value: number | undefined, fallback = 50): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(200, Math.floor(value)));
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function iso(value: Date): string {
  return value.toISOString();
}
