import { prepareTurn, type RuntimeDeps } from "@botanical/agent-runtime";
import { HttpError, isRecord, json, readJson } from "../http.ts";
import { readRequestedProfileId, resolveProfile } from "../profiles.ts";
import { collectChatTurn, streamChatTurn, turnFailure } from "../runtime/turn.ts";
import { authed, type Router } from "../router.ts";
import { sseStream } from "../streaming.ts";
import type { Chat } from "../types.ts";
import { LIMITS, readBoundedString, requireParam } from "../validate.ts";

export function registerMessages(router: Router, runtime: RuntimeDeps): void {
  router.add(
    "GET",
    "/api/chats/:id/messages",
    authed(async (ctx) => {
      const chat = await loadChat(ctx.store, requireParam(ctx.params, "id"));
      const messages = await ctx.store.messages.listByChat(chat.id);
      return json(200, { messages });
    }),
  );

  router.add(
    "POST",
    "/api/chats/:id/messages",
    authed(async (ctx) => {
      let chat = await loadChat(ctx.store, requireParam(ctx.params, "id"));
      const body = await readJson(ctx.request, ctx.config);
      if (!isRecord(body)) throw new HttpError(400, "invalid_body", "JSON object expected");
      const content = readBoundedString(body.content, "content", {
        required: true,
        max: LIMITS.content,
      });
      if (!content) throw new HttpError(400, "invalid_body", "content is required");
      const stream = wantsStream(ctx.request, body);

      const profile = resolveProfile(
        ctx.config,
        readRequestedProfileId(body.profileId, false),
        chat.profileId,
      );
      if (profile.id !== chat.profileId) {
        const updated = await ctx.store.chats.update(chat.id, { profileId: profile.id });
        if (!updated) throw new HttpError(404, "not_found", "Chat not found");
        chat = updated;
      }

      try {
        await prepareTurn(runtime, { chatId: chat.id, content, profileId: profile.id, signal: ctx.request.signal });
      } catch (error) {
        throw turnFailure(error);
      }

      const turn = { chat, content, profile, signal: ctx.request.signal };
      if (!stream) {
        const result = await collectChatTurn(ctx.store, runtime, turn);
        return json(201, {
          userMessage: result.userMessage,
          assistantMessage: result.assistantMessage,
          profileId: result.profileId,
          ...(result.toolCall ? { toolCall: result.toolCall } : {}),
          ...(result.toolResult !== undefined ? { toolResult: result.toolResult } : {}),
          ...(result.error ? { error: result.error } : {}),
        });
      }
      return sseStream(streamChatTurn(ctx.store, runtime, turn));
    }),
  );
}

async function loadChat(store: { chats: { get(id: string): Promise<Chat | null> } }, id: string): Promise<Chat> {
  const chat = await store.chats.get(id);
  if (!chat) throw new HttpError(404, "not_found", "Chat not found");
  return chat;
}

function wantsStream(request: Request, body: Record<string, unknown>): boolean {
  if (body.stream !== undefined && typeof body.stream !== "boolean") {
    throw new HttpError(400, "invalid_body", "stream must be a boolean");
  }
  if (typeof body.stream === "boolean") return body.stream;
  const accept = request.headers.get("accept") ?? "";
  return accept.includes("text/event-stream");
}
