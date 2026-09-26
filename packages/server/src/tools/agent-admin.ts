import {
  contributorFromBuiltins,
  escalationError,
  parseRolePermissions,
  toolAccess,
  type AgentRoleGrant,
  type ToolContributor,
} from "@botanical/agent-runtime";

import type { Agent, Store } from "../types.ts";
import { parseCreateAgent } from "../validate.ts";

const OBJECT = { type: "object", additionalProperties: false } as const;

/**
 * Agents create agents through the same validation path as POST /api/agents.
 * The caller cannot grant tools or roles beyond its own effective permissions.
 * `agent_create` requires the `agent.create` capability when the caller has roles.
 * Agents with no roles keep allowlist-only behavior.
 */
export function createAgentAdminContributor(store: Store): ToolContributor {
  return contributorFromBuiltins(
    [
      {
        name: "agent_create",
        description:
          "Create another agent. You cannot grant tools or roles beyond your own permissions. Requires the agent.create capability when you have roles.",
        parameters: {
          ...OBJECT,
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            prompt: { type: "string" },
            systemPrompt: { type: "string" },
            icon: { type: "string" },
            color: { type: "string" },
            tools: { type: "array", items: { type: "string" } },
            roles: {
              type: "array",
              items: { type: "string" },
              description: "Role ids or role names. Each role must fit inside your permissions.",
            },
          },
          required: ["name"],
        },
        async execute(args, ctx) {
          const caller = await store.agents.get(ctx?.agentId ?? "");
          if (!caller) return fail("Calling agent was not found");
          const access = toolAccess(subject(caller), { name: "agent_create", origin: "builtin" });
          if (!access.ok) return fail(access.message);
          const names = roleNames(args);
          if (names === null) return fail("roles must be an array of role ids or names");
          let draft: ReturnType<typeof parseCreateAgent>;
          try {
            draft = parseCreateAgent(normalizeCreateArgs(args));
          } catch (cause) {
            const message = cause instanceof Error ? cause.message : "Invalid agent";
            return fail(message);
          }
          const requestedRoles = await resolveRoles(store, names);
          if (typeof requestedRoles === "string") return fail(requestedRoles);
          const blocked = escalationError(subject(caller), {
            toolIds: draft.toolIds,
            roles: requestedRoles,
          });
          if (blocked) return fail(blocked);
          const created = await store.agents.create({
            ...draft,
            createdByAgentId: caller.id,
            roleIds: requestedRoles.map((role) => role.id),
          });
          return {
            id: created.id,
            name: created.name,
            roleIds: created.roleIds,
            createdByAgentId: created.createdByAgentId,
          };
        },
      },
      {
        name: "agent_list",
        description: "List agents in this Botanical instance (id, name, description). Requires agent.message when you have roles.",
        parameters: { ...OBJECT, properties: {} },
        async execute(_args, ctx) {
          const caller = await store.agents.get(ctx?.agentId ?? "");
          if (!caller) return fail("Calling agent was not found");
          const access = toolAccess(subject(caller), { name: "agent_list", origin: "builtin" });
          if (!access.ok) return fail(access.message);
          const agents = await store.agents.list();
          return {
            agents: agents.map((agent) => ({
              id: agent.id,
              name: agent.name,
              description: agent.description,
            })),
          };
        },
      },
    ],
    { id: "builtin.agents" },
  );
}

function subject(agent: Agent) {
  return {
    name: agent.name,
    toolAllowlist: agent.toolIds,
    a2aEnabled: false,
    roles: agent.roles.map((role) => ({
      id: role.id,
      name: role.name,
      permissions: parseRolePermissions(role.permissions),
    })),
  };
}

function normalizeCreateArgs(args: unknown): Record<string, unknown> {
  const record = asRecord(args);
  const body: Record<string, unknown> = {};
  if (typeof record.name === "string") body.name = record.name;
  if (typeof record.description === "string") body.description = record.description;
  const prompt = typeof record.prompt === "string" ? record.prompt : record.systemPrompt;
  if (typeof prompt === "string") body.prompt = prompt;
  if (typeof record.icon === "string") body.icon = record.icon;
  if (typeof record.color === "string") body.color = record.color;
  if (Array.isArray(record.tools)) body.tools = record.tools;
  return body;
}

function roleNames(args: unknown): string[] | null {
  const record = asRecord(args);
  if (record.roles === undefined) return [];
  if (!Array.isArray(record.roles)) return null;
  const names: string[] = [];
  for (const item of record.roles) {
    if (typeof item !== "string") return null;
    names.push(item);
  }
  return names;
}

function fail(message: string): { output: { error: string }; isError: true } {
  return { output: { error: message }, isError: true };
}

async function resolveRoles(store: Store, names: readonly string[]): Promise<AgentRoleGrant[] | string> {
  const grants: AgentRoleGrant[] = [];
  for (const name of names) {
    const key = name.trim();
    if (!key) return "roles must be an array of role ids or names";
    const role = (await store.roles.get(key)) ?? (await store.roles.getByName(key));
    if (!role) return `Unknown role ${JSON.stringify(key)}`;
    if (grants.some((grant) => grant.id === role.id)) continue;
    grants.push({
      id: role.id,
      name: role.name,
      permissions: parseRolePermissions(role.permissions),
    });
  }
  return grants;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}
