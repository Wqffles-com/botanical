import { HttpError, isRecord, json, noContent, readJson } from "../http.ts";
import { readRequestedProfileId, resolveProfile } from "../profiles.ts";
import { authed, type Router } from "../router.ts";
import { LIMITS, readBoundedString, readRequiredId, requireParam } from "../validate.ts";

export function registerChats(router: Router): void {
  router.add(
    "GET",
    "/api/chats",
    authed(async (ctx) => {
      const agentId = ctx.url.searchParams.get("agentId");
      let chats = await ctx.store.chats.list();
      if (agentId !== null) {
        if (agentId.trim() === "" || agentId.length > LIMITS.id) {
          throw new HttpError(400, "invalid_query", "agentId is invalid");
        }
        chats = chats.filter((chat) => chat.agentId === agentId);
      }
      return json(200, { chats });
    }),
  );

  router.add(
    "POST",
    "/api/chats",
    authed(async (ctx) => {
      const body = await readJson(ctx.request, ctx.config);
      if (!isRecord(body)) throw new HttpError(400, "invalid_body", "JSON object expected");
      const agentId = readRequiredId(body.agentId, "agentId");
      const agent = await ctx.store.agents.get(agentId);
      if (!agent) throw new HttpError(404, "not_found", "Agent not found");
      const profile = resolveProfile(ctx.config, readRequestedProfileId(body.profileId, true), undefined);
      const title =
        body.title === undefined
          ? "New chat"
          : readBoundedString(body.title, "title", { required: true, max: LIMITS.title });
      if (!title) throw new HttpError(400, "invalid_body", "title is required");
      const chat = await ctx.store.chats.create({
        agentId: agent.id,
        profileId: profile.id,
        title,
      });
      return json(201, { chat });
    }),
  );

  router.add(
    "GET",
    "/api/chats/:id",
    authed(async (ctx) => {
      const chat = await ctx.store.chats.get(requireParam(ctx.params, "id"));
      if (!chat) throw new HttpError(404, "not_found", "Chat not found");
      return json(200, { chat });
    }),
  );

  router.add(
    "DELETE",
    "/api/chats/:id",
    authed(async (ctx) => {
      const id = requireParam(ctx.params, "id");
      const chat = await ctx.store.chats.get(id);
      if (!chat) throw new HttpError(404, "not_found", "Chat not found");
      // TODO(packages/db): delete the chat and its messages in one transaction.
      await ctx.store.messages.deleteByChat(id);
      await ctx.store.chats.delete(id);
      return noContent();
    }),
  );
}
