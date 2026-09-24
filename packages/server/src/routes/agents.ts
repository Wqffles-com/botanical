import { HttpError, json, noContent, readJson } from "../http.ts";
import { authed, type Router } from "../router.ts";
import type { Agent } from "../types.ts";
import { parseCreateAgent, parseUpdateAgent, requireParam } from "../validate.ts";

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
      const agent = await ctx.store.agents.create(parseCreateAgent(body));
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
      const agent = await ctx.store.agents.update(id, parseUpdateAgent(body));
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
          "This agent still owns chats. Delete those chats first.",
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
    icon: agent.icon,
    color: agent.color,
    description: agent.description,
    prompt: agent.systemPrompt,
    systemPrompt: agent.systemPrompt,
    tools: toolIds,
    toolIds,
    defaultProfileId: agent.defaultProfileId,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  };
}
