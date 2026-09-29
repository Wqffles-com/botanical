import { prepareTurn, type RuntimeDeps } from "@botanical/agent-runtime";
import { deliverMentions } from "../a2a/mentions.ts";
import type { A2AService } from "../a2a/service.ts";
import { HttpError, isRecord, json, readJson } from "../http.ts";
import { readRequestedProfileId, resolveProfile } from "../profiles.ts";
import { assertCliProfileReady } from "./profiles.ts";
import { collectChatTurn, streamChatReplies, turnFailure } from "../runtime/turn.ts";
import type { ChatQueue } from "../runtime/chat-queue.ts";
import type { TurnCoordinator } from "../runtime/turns.ts";
import { authed, type Router } from "../router.ts";
import { sseStream, type SseEvent } from "../streaming.ts";
import type { Chat, Message } from "../types.ts";
import { LIMITS, readBoundedString, requireParam } from "../validate.ts";

export function registerMessages(
  router: Router,
  runtime: RuntimeDeps,
  turns: TurnCoordinator,
  queue: ChatQueue,
  a2a: Pick<A2AService, "send">,
): void {
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
      const queued = wantsQueue(body);
      const stream = queued ? false : wantsStream(ctx.request, body);

      const profile = await resolveProfile(
        ctx.store,
        readRequestedProfileId(body.profileId, true),
        chat.profileId,
      );
      await assertCliProfileReady(profile);
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

      const mentions = await deliverMentions(ctx.store, a2a, chat, content);

      if (queued) {
        const userId = ctx.user?.id;
        if (!userId) throw new HttpError(401, "unauthorized", "Authentication required");
        const clientId = readBoundedString(body.clientId, "clientId", { required: false, max: 64 });
        const item = queue.enqueue({
          chatId: chat.id,
          userId,
          content,
          profileId: profile.id,
          ...(clientId ? { id: clientId } : {}),
        });
        return json(202, { queued: item, profileId: profile.id, mentions });
      }

      const turn = { chat, content, profile, signal: ctx.request.signal };
      if (!stream) {
        const result = await turns.exclusive(chat.id, () => collectChatTurn(ctx.store, runtime, turn));
        return json(201, {
          userMessage: result.userMessage,
          assistantMessage: result.assistantMessage,
          ...(result.replies ? { replies: result.replies } : {}),
          profileId: result.profileId,
          mentions,
          ...(result.toolCall ? { toolCall: result.toolCall } : {}),
          ...(result.toolResult !== undefined ? { toolResult: result.toolResult } : {}),
          ...(result.error ? { error: result.error } : {}),
        });
      }
      return sseStream(turns.stream(chat.id, () => streamChatReplies(ctx.store, runtime, turn)));
    }),
  );

  router.add(
    "PATCH",
    "/api/chats/:id/messages/:messageId",
    authed(async (ctx) => {
      const chat = await loadChat(ctx.store, requireParam(ctx.params, "id"));
      const messageId = requireParam(ctx.params, "messageId");
      const body = await readJson(ctx.request, ctx.config);
      if (!isRecord(body)) throw new HttpError(400, "invalid_body", "JSON object expected");
      const content = readBoundedString(body.content, "content", { required: true, max: LIMITS.content });
      if (!content) throw new HttpError(400, "invalid_body", "content is required");
      assertIdle(queue, chat.id);
      const message = await turns.exclusive(chat.id, async () => {
        const current = (await ctx.store.messages.listByChat(chat.id)).find((row) => row.id === messageId);
        if (!current) throw new HttpError(404, "not_found", "Message not found");
        if (current.role !== "user" && current.role !== "assistant") {
          throw new HttpError(400, "invalid_body", "Only user and assistant messages can be edited");
        }
        const updated = await ctx.store.messages.updateContent(chat.id, messageId, content);
        if (!updated) throw new HttpError(404, "not_found", "Message not found");
        return updated;
      });
      queue.broadcast(chat.id, { event: "message-updated", data: { message } });
      return json(200, { message });
    }),
  );

  router.add(
    "DELETE",
    "/api/chats/:id/messages/:messageId",
    authed(async (ctx) => {
      const chat = await loadChat(ctx.store, requireParam(ctx.params, "id"));
      const messageId = requireParam(ctx.params, "messageId");
      const following = readFlag(ctx.url.searchParams.get("following"), "following");
      assertIdle(queue, chat.id);
      const ids = await turns.exclusive(chat.id, async () => {
        const doomed = messagesToDelete(await ctx.store.messages.listByChat(chat.id), messageId, following);
        if (!doomed) throw new HttpError(404, "not_found", "Message not found");
        await ctx.store.messages.deleteMany(chat.id, doomed);
        return doomed;
      });
      queue.broadcast(chat.id, { event: "messages-deleted", data: { ids } });
      return json(200, { deleted: ids });
    }),
  );

  router.add(
    "GET",
    "/api/chats/:id/events",
    authed(async (ctx) => {
      const chat = await loadChat(ctx.store, requireParam(ctx.params, "id"));
      return sseStream(chatEvents(queue, chat.id, ctx.request.signal));
    }),
  );

  router.add(
    "POST",
    "/api/chats/:id/stop",
    authed(async (ctx) => {
      const chat = await loadChat(ctx.store, requireParam(ctx.params, "id"));
      return json(200, { stopped: queue.stop(chat.id) });
    }),
  );
}

/** Queue events for one chat until the client disconnects. */
async function* chatEvents(queue: ChatQueue, chatId: string, signal: AbortSignal): AsyncGenerator<SseEvent> {
  const pending: SseEvent[] = [];
  let wake: (() => void) | null = null;
  const notify = () => {
    wake?.();
    wake = null;
  };
  const unsubscribe = queue.subscribe(chatId, (event) => {
    pending.push(event);
    notify();
  });
  signal.addEventListener("abort", notify, { once: true });
  try {
    while (!signal.aborted) {
      const next = pending.shift();
      if (next) {
        yield next;
        continue;
      }
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  } finally {
    unsubscribe();
    signal.removeEventListener("abort", notify);
  }
}

/**
 * Ids removed by deleting one message. An assistant message takes its tool results
 * with it, so no result is left without its call. With `following`, every later
 * message goes too. Null when the message is not in the transcript.
 */
export function messagesToDelete(messages: readonly Message[], id: string, following: boolean): string[] | null {
  const index = messages.findIndex((message) => message.id === id);
  if (index === -1) return null;
  if (following) return messages.slice(index).map((message) => message.id);
  const target = messages[index] as Message;
  const calls = new Set((target.toolCalls ?? []).map((call) => call.id));
  const results = messages.filter(
    (message) => message.role === "tool" && message.toolCallId !== undefined && calls.has(message.toolCallId),
  );
  return [target.id, ...results.map((message) => message.id)];
}

/** Edits wait for the agent: a running turn is still reading and writing the transcript. */
function assertIdle(queue: ChatQueue, chatId: string): void {
  const status = queue.status(chatId);
  if (status.running || status.queued.length > 0) {
    throw new HttpError(409, "chat_busy", "Wait for the agent to finish before changing messages");
  }
}

function readFlag(value: string | null, field: string): boolean {
  if (value === null || value === "" || value === "false" || value === "0") return false;
  if (value === "true" || value === "1") return true;
  throw new HttpError(400, "invalid_query", `${field} must be true or false`);
}

async function loadChat(store: { chats: { get(id: string): Promise<Chat | null> } }, id: string): Promise<Chat> {
  const chat = await store.chats.get(id);
  if (!chat) throw new HttpError(404, "not_found", "Chat not found");
  return chat;
}

function wantsQueue(body: Record<string, unknown>): boolean {
  if (body.async === undefined) return false;
  if (typeof body.async !== "boolean") throw new HttpError(400, "invalid_body", "async must be a boolean");
  if (body.async && body.stream === true) {
    throw new HttpError(400, "invalid_body", "async and stream cannot both be true");
  }
  return body.async;
}

function wantsStream(request: Request, body: Record<string, unknown>): boolean {
  if (body.stream !== undefined && typeof body.stream !== "boolean") {
    throw new HttpError(400, "invalid_body", "stream must be a boolean");
  }
  if (typeof body.stream === "boolean") return body.stream;
  const accept = request.headers.get("accept") ?? "";
  return accept.includes("text/event-stream");
}
