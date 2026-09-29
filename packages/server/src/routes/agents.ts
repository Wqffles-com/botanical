import { effectivePermissions, isCapability } from "@botanical/agent-runtime";

import { HttpError, json, noContent, readJson } from "../http.ts";
import { authed, type Router } from "../router.ts";
import type { Agent } from "../types.ts";
import { parseCreateAgent, parseUpdateAgent, requireParam } from "../validate.ts";
import { resolveRoleIds } from "./roles.ts";

export function registerAgents(router: Router): void {
  router.add(
    "GET",
    "/api/agents",
    authed(async (ctx) => {
      const agents = await ctx.store.agents.list();
      return json(200, { agents: agents.map(presentAgent) });
    }),
  );

  router.add(
    "POST",
    "/api/agents",
    authed(async (ctx) => {
      const body = await readJson(ctx.request, ctx.config);
      const input = parseCreateAgent(body);
      if (input.roleIds) input.roleIds = await resolveRoleIds(ctx.store, input.roleIds);
      const agent = await ctx.store.agents.create(input);
      return json(201, { agent: presentAgent(agent) });
    }),
  );

  router.add(
    "GET",
    "/api/agents/:id",
    authed(async (ctx) => {
      const agent = await ctx.store.agents.get(requireParam(ctx.params, "id"));
      if (!agent) throw new HttpError(404, "not_found", "Agent not found");
      return json(200, { agent: presentAgent(agent) });
    }),
  );

  router.add(
    "PATCH",
    "/api/agents/:id",
    authed(async (ctx) => {
      const id = requireParam(ctx.params, "id");
      const body = await readJson(ctx.request, ctx.config);
      const patch = parseUpdateAgent(body);
      if (patch.roleIds) patch.roleIds = await resolveRoleIds(ctx.store, patch.roleIds);
      const agent = await ctx.store.agents.update(id, patch);
      if (!agent) throw new HttpError(404, "not_found", "Agent not found");
      return json(200, { agent: presentAgent(agent) });
    }),
  );

  router.add(
    "DELETE",
    "/api/agents/:id",
    authed(async (ctx) => {
      const id = requireParam(ctx.params, "id");
      const existing = await ctx.store.agents.get(id);
      if (!existing) throw new HttpError(404, "not_found", "Agent not found");
      const owned = await ctx.store.chats.countByAgent(id);
      if (owned > 0) {
        throw new HttpError(
          409,
          "agent_in_use",
          "This agent still owns or is a member of chats. Delete those chats or remove it from them first.",
        );
      }
      await ctx.store.agents.delete(id);
      return noContent();
    }),
  );
}

/** Wire shape: contract names (`prompt`, `tools`) plus the existing aliases. */
function presentAgent(agent: Agent) {
  const toolIds = [...agent.toolIds];
  return {
    id: agent.id,
    name: agent.name,
    title: agent.title,
    icon: agent.icon,
    shape: agent.shape,
    picture: agent.picture,
    color: agent.color,
    description: agent.description,
    prompt: agent.systemPrompt,
    systemPrompt: agent.systemPrompt,
    tools: toolIds,
    toolIds,
    defaultProfileId: agent.defaultProfileId,
    createdByAgentId: agent.createdByAgentId,
    roleIds: [...agent.roleIds],
    roles: agent.roles.map((role) => ({
      id: role.id,
      name: role.name,
      builtin: role.builtin,
      permissions: role.permissions,
    })),
    effectivePermissions: effectivePermissions(
      agent.roles.map((role) => ({
        id: role.id,
        name: role.name,
        permissions: {
          capabilities: role.permissions.capabilities.filter(isCapability),
          mcp: role.permissions.mcp,
        },
      })),
    ),
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  };
}
