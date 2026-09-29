import { HttpError, isRecord, json, noContent, readJson } from "../http.ts";
import { readRequestedProfileId, resolveProfile } from "../profiles.ts";
import { authed, type Router } from "../router.ts";
import { ensureAgentChat, findAgentChat, isAgentChat } from "../runtime/agent-chat.ts";
import type { Store } from "../types.ts";
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
        chats = chats.filter((chat) => chat.agentId === agentId || chat.memberIds.includes(agentId));
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
      const profile = await resolveProfile(ctx.store, readRequestedProfileId(body.profileId, true), undefined);
      const memberIds =
        body.memberIds === undefined ? [] : await readMemberIds(ctx.store, body.memberIds, agent.id);
      const title =
        body.title === undefined
          ? "New chat"
          : readBoundedString(body.title, "title", { required: true, max: LIMITS.title });
      if (!title) throw new HttpError(400, "invalid_body", "title is required");
      if (memberIds.length === 0) {
        // One chat per agent: without members this opens the agent's own chat, creating it the first time.
        const { chat, created } = await ensureAgentChat(ctx.store, agent, profile.id);
        return json(created ? 201 : 200, { chat });
      }
      const chat = await ctx.store.chats.create({
        agentId: agent.id,
        memberIds,
        profileId: profile.id,
        title,
      });
      return json(201, { chat });
    }),
  );

  router.add(
    "GET",
    "/api/agents/:id/chat",
    authed(async (ctx) => {
      const agent = await ctx.store.agents.get(requireParam(ctx.params, "id"));
      if (!agent) throw new HttpError(404, "not_found", "Agent not found");
      return json(200, { chat: await findAgentChat(ctx.store, agent.id) });
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
    "PATCH",
    "/api/chats/:id",
    authed(async (ctx) => {
      const id = requireParam(ctx.params, "id");
      const existing = await ctx.store.chats.get(id);
      if (!existing) throw new HttpError(404, "not_found", "Chat not found");
      const body = await readJson(ctx.request, ctx.config);
      if (!isRecord(body)) throw new HttpError(400, "invalid_body", "JSON object expected");
      const patch: { title?: string; profileId?: string; memberIds?: string[] } = {};
      if (body.title !== undefined) {
        const title = readBoundedString(body.title, "title", { required: true, max: LIMITS.title });
        if (!title) throw new HttpError(400, "invalid_body", "title is required");
        patch.title = title;
      }
      if (body.profileId !== undefined) {
        const profile = await resolveProfile(ctx.store, readRequestedProfileId(body.profileId, true), undefined);
        patch.profileId = profile.id;
      }
      if (body.memberIds !== undefined) {
        const memberIds = await readMemberIds(ctx.store, body.memberIds, existing.agentId);
        if (isAgentChat(existing) && memberIds.length > 0) {
          throw new HttpError(
            400,
            "invalid_body",
            "An agent's own chat has no members. Start a group chat with POST /api/chats instead.",
          );
        }
        if (!isAgentChat(existing) && memberIds.length === 0) {
          throw new HttpError(400, "invalid_body", "A group chat keeps at least one member. Delete the chat instead.");
        }
        patch.memberIds = memberIds;
      }
      if (patch.title === undefined && patch.profileId === undefined && patch.memberIds === undefined) {
        return json(200, { chat: existing });
      }
      const chat = await ctx.store.chats.update(id, patch);
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

/**
 * Group chat members: agent ids beside the owner, in speaking order. Duplicates collapse.
 * The owner cannot be listed, and every id must be one of the user's agents.
 */
async function readMemberIds(store: Store, value: unknown, ownerId: string): Promise<string[]> {
  if (!Array.isArray(value)) throw new HttpError(400, "invalid_body", "memberIds must be an array of agent ids");
  const ids = [...new Set(value.map((item) => readRequiredId(item, "memberIds[]")))];
  if (ids.length > LIMITS.chatMembers) {
    throw new HttpError(400, "invalid_body", `A group chat can have at most ${LIMITS.chatMembers} members`);
  }
  if (ids.includes(ownerId)) {
    throw new HttpError(400, "invalid_body", "The chat's own agent is not listed in memberIds");
  }
  for (const id of ids) {
    if (!(await store.agents.get(id))) throw new HttpError(404, "not_found", `Agent ${id} not found`);
  }
  return ids;
}
