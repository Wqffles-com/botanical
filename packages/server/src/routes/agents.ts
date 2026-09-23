import { HttpError, isRecord, json, noContent, readJson } from "../http.ts";
import { authed, type Router } from "../router.ts";
import type { AgentPatch } from "../types.ts";
import { LIMITS, readBoundedString, readToolIds, requireParam } from "../validate.ts";

export function registerAgents(router: Router): void {
  router.add(
    "GET",
    "/api/agents",
    authed(async (ctx) => {
      const agents = await ctx.store.agents.list();
      return json(200, { agents });
    }),
  );

  router.add(
    "POST",
    "/api/agents",
    authed(async (ctx) => {
      const body = await readJson(ctx.request, ctx.config);
      if (!isRecord(body)) throw new HttpError(400, "invalid_body", "JSON object expected");
      const name = readBoundedString(body.name, "name", { required: true, max: LIMITS.name });
      const description =
        readBoundedString(body.description, "description", {
          required: false,
          max: LIMITS.description,
        }) ?? "";
      const systemPrompt = readBoundedString(body.systemPrompt, "systemPrompt", {
        required: true,
        max: LIMITS.systemPrompt,
      });
      const toolIds = body.toolIds === undefined ? [] : readToolIds(body.toolIds);
      if (!name || !systemPrompt) {
        throw new HttpError(400, "invalid_body", "name and systemPrompt are required");
      }
      const agent = await ctx.store.agents.create({ name, description, systemPrompt, toolIds });
      return json(201, { agent });
    }),
  );

  router.add(
    "GET",
    "/api/agents/:id",
    authed(async (ctx) => {
      const agent = await ctx.store.agents.get(requireParam(ctx.params, "id"));
      if (!agent) throw new HttpError(404, "not_found", "Agent not found");
      return json(200, { agent });
    }),
  );

  router.add(
    "PATCH",
    "/api/agents/:id",
    authed(async (ctx) => {
      const id = requireParam(ctx.params, "id");
      const body = await readJson(ctx.request, ctx.config);
      if (!isRecord(body)) throw new HttpError(400, "invalid_body", "JSON object expected");
      const patch: AgentPatch = {};
      if ("name" in body) {
        const name = readBoundedString(body.name, "name", { required: true, max: LIMITS.name });
        if (!name) throw new HttpError(400, "invalid_body", "name is required");
        patch.name = name;
      }
      if ("description" in body) {
        patch.description =
          readBoundedString(body.description, "description", {
            required: false,
            max: LIMITS.description,
          }) ?? "";
      }
      if ("systemPrompt" in body) {
        const systemPrompt = readBoundedString(body.systemPrompt, "systemPrompt", {
          required: true,
          max: LIMITS.systemPrompt,
        });
        if (!systemPrompt) throw new HttpError(400, "invalid_body", "systemPrompt is required");
        patch.systemPrompt = systemPrompt;
      }
      if ("toolIds" in body) {
        patch.toolIds = readToolIds(body.toolIds);
      }
      if (
        patch.name === undefined &&
        patch.description === undefined &&
        patch.systemPrompt === undefined &&
        patch.toolIds === undefined
      ) {
        throw new HttpError(400, "invalid_body", "No fields to update");
      }
      const agent = await ctx.store.agents.update(id, patch);
      if (!agent) throw new HttpError(404, "not_found", "Agent not found");
      return json(200, { agent });
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
