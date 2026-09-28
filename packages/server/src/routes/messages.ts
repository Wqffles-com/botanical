import { prepareTurn, type RuntimeDeps } from "@botanical/agent-runtime";
import { HttpError, isRecord, json, readJson } from "../http.ts";
import { readRequestedProfileId, resolveProfile } from "../profiles.ts";
import { assertCliProfileReady } from "./profiles.ts";
import { collectChatTurn, streamChatTurn, turnFailure } from "../runtime/turn.ts";
import type { ChatQueue } from "../runtime/chat-queue.ts";
import type { TurnCoordinator } from "../runtime/turns.ts";
import { authed, type Router } from "../router.ts";
import { sseStream, type SseEvent } from "../streaming.ts";
import type { Chat } from "../types.ts";
import { LIMITS, readBoundedString, requireParam } from "../validate.ts";

export function registerMessages(
  router: Router,
  runtime: RuntimeDeps,
  turns: TurnCoordinator,
  queue: ChatQueue,
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
        return json(202, { queued: item, profileId: profile.id });
      }

      const turn = { chat, content, profile, signal: ctx.request.signal };
      if (!stream) {
        const result = await turns.exclusive(chat.id, () => collectChatTurn(ctx.store, runtime, turn));
        return json(201, {
          userMessage: result.userMessage,
          assistantMessage: result.assistantMessage,
          profileId: result.profileId,
          ...(result.toolCall ? { toolCall: result.toolCall } : {}),
          ...(result.toolResult !== undefined ? { toolResult: result.toolResult } : {}),
          ...(result.error ? { error: result.error } : {}),
        });
      }
      return sseStream(turns.stream(chat.id, () => streamChatTurn(ctx.store, runtime, turn)));
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
