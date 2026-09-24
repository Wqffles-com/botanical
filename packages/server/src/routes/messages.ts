import type { RuntimeChatMessage } from "@botanical/providers";

import { ensureWorkspaceRoot, runMockTurn, type MockTurnResult } from "../chat/mock-turn.ts";
import {
  emptyTurn,
  fileToolDefinitions,
  providerToHttp,
  streamProviderEvents,
} from "../chat/provider-turn.ts";
import { HttpError, isRecord, json, readJson } from "../http.ts";
import { readRequestedProfileId, resolveProfile } from "../profiles.ts";
import { authed, type Router } from "../router.ts";
import { sseResponse, sseStream, textDeltas, type SseEvent } from "../streaming.ts";
import type { Agent, Chat, Message, Store } from "../types.ts";
import { LIMITS, readBoundedString, requireParam } from "../validate.ts";

export function registerMessages(router: Router): void {
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
        readRequestedProfileId(body.profileId, true),
        undefined,
      );
      if (profile.id !== chat.profileId) {
        const updated = await ctx.store.chats.update(chat.id, { profileId: profile.id });
        if (!updated) throw new HttpError(404, "not_found", "Chat not found");
        chat = updated;
      }

      const userMessage = await ctx.store.messages.create({
        chatId: chat.id,
        role: "user",
        content,
      });

      if (profile.provider === "mock") {
        const mockTurn = await runMockTurn(content, ensureWorkspaceRoot());
        const assistantMessage = await ctx.store.messages.create({
          chatId: chat.id,
          role: "assistant",
          content: mockTurn.text,
        });
        await touchChat(ctx.store, chat, content);
        if (!stream) {
          return json(201, {
            userMessage,
            assistantMessage,
            profileId: profile.id,
            ...(mockTurn.toolCall ? { toolCall: mockTurn.toolCall } : {}),
          });
        }
        return sseResponse(streamEvents(userMessage, assistantMessage, mockTurn.text, mockTurn));
      }

      let resolved;
      try {
        resolved = await ctx.config.providers.runtime.resolve(profile.id);
      } catch (error) {
        throw providerToHttp(error);
      }
      const agent = await ctx.store.agents.get(chat.agentId);
      const history = await ctx.store.messages.listByChat(chat.id);
      const providerMessages = toProviderMessages(agent, history);
      const tools = fileToolDefinitions(agent?.toolIds ?? []);

      if (!stream) {
        const acc = emptyTurn();
        try {
          for await (const event of streamProviderEvents(
            resolved.provider,
            resolved.model,
            providerMessages,
            tools,
            ctx.request.signal,
            acc,
          )) {
            void event;
          }
        } catch (error) {
          throw providerToHttp(error);
        }
        const assistantMessage = await ctx.store.messages.create({
          chatId: chat.id,
          role: "assistant",
          content: acc.text,
        });
        await touchChat(ctx.store, chat, content);
        return json(201, {
          userMessage,
          assistantMessage,
          profileId: profile.id,
          ...(acc.toolCalls.length > 0 ? { toolCalls: acc.toolCalls } : {}),
          ...(acc.usage ? { usage: acc.usage } : {}),
        });
      }

      return sseStream(
        streamLiveTurn(ctx.store, chat, content, userMessage, resolved.provider, resolved.model, providerMessages, tools, ctx.request.signal),
      );
    }),
  );
}

async function* streamLiveTurn(
  store: Store,
  chat: Chat,
  content: string,
  userMessage: Message,
  provider: Parameters<typeof streamProviderEvents>[0],
  model: string,
  providerMessages: RuntimeChatMessage[],
  tools: ReturnType<typeof fileToolDefinitions>,
  signal: AbortSignal | undefined,
): AsyncGenerator<SseEvent> {
  yield { event: "message.created", data: { message: userMessage } };
  const acc = emptyTurn();
  try {
    yield* streamProviderEvents(provider, model, providerMessages, tools, signal, acc);
    const assistantMessage = await store.messages.create({
      chatId: chat.id,
      role: "assistant",
      content: acc.text,
    });
    await touchChat(store, chat, content);
    yield { event: "message.completed", data: { message: assistantMessage } };
    yield { event: "done", data: {} };
  } catch (error) {
    const httpError = providerToHttp(error);
    if (acc.text) {
      const assistantMessage = await store.messages.create({
        chatId: chat.id,
        role: "assistant",
        content: acc.text,
      });
      yield { event: "message.completed", data: { message: assistantMessage } };
    }
    yield { event: "error", data: { type: "error", error: httpError.message } };
    yield { event: "done", data: {} };
  }
}

function toProviderMessages(agent: Agent | null, history: readonly Message[]): RuntimeChatMessage[] {
  const messages: RuntimeChatMessage[] = [];
  const prompt = agent ? agent.systemPrompt.trim() : "";
  if (prompt) messages.push({ role: "system", content: prompt });
  for (const message of history) {
    messages.push({ role: message.role, content: message.content });
  }
  return messages;
}

async function touchChat(store: Store, chat: Chat, content: string): Promise<void> {
  const title = chat.title === "New chat" ? titleFromContent(content) : undefined;
  await store.chats.update(chat.id, title ? { title } : {});
}

async function loadChat(store: Store, id: string): Promise<Chat> {
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

function titleFromContent(content: string): string {
  const oneLine = content.trim().replace(/\s+/g, " ");
  if (oneLine.length <= 80) return oneLine;
  return `${oneLine.slice(0, 77)}...`;
}

function streamEvents(
  userMessage: Message,
  assistantMessage: Message,
  assistantText: string,
  mockTurn: MockTurnResult | null,
): SseEvent[] {
  const toolEvents: SseEvent[] = [];
  if (mockTurn?.toolCall) {
    toolEvents.push({
      event: "tool-call",
      data: {
        type: "tool-call",
        id: mockTurn.toolCall.id,
        name: mockTurn.toolCall.name,
        arguments: mockTurn.toolCall.arguments,
      },
    });
    toolEvents.push({
      event: "tool-result",
      data: {
        type: "tool-result",
        id: mockTurn.toolCall.id,
        content: mockTurn.toolResult ?? "",
      },
    });
  }
  return [
    { event: "message.created", data: { message: userMessage } },
    ...toolEvents,
    ...textDeltas(assistantText).map((text) => ({ event: "text-delta", data: { text } })),
    { event: "message.completed", data: { message: assistantMessage } },
    { event: "done", data: {} },
  ];
}
