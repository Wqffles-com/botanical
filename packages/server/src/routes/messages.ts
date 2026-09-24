import { createSendAgentMessageTool } from "../a2a/tool.ts";
import type { A2AService } from "../a2a/service.ts";
import { ensureWorkspaceRoot, runMockTurn, type MockTurnResult } from "../chat/mock-turn.ts";
import { HttpError, isRecord, json, readJson } from "../http.ts";
import { readRequestedProfileId, resolveProfile } from "../profiles.ts";
import { authed, type Router } from "../router.ts";
import { sseResponse, textDeltas, type SseEvent } from "../streaming.ts";
import type { Chat, Message, ModelProfile } from "../types.ts";
import { LIMITS, readBoundedString, requireParam } from "../validate.ts";

export function registerMessages(router: Router, a2a: A2AService): void {
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

      const userMessage = await ctx.store.messages.create({
        chatId: chat.id,
        role: "user",
        content,
      });
      // Profiles other than `mock` stay on the explicit stub until those
      // providers are called with server-side keys. `mock` runs the echo
      // provider plus the built-in file_list tool. There is no default profile.
      const mockTurn =
        profile.provider === "mock"
          ? await runMockTurn(content, ensureWorkspaceRoot(), {
              extraTools: [createSendAgentMessageTool(a2a)],
              agentId: chat.agentId,
              chatId: chat.id,
            })
          : null;
      const assistantText = mockTurn ? mockTurn.text : stubAssistantText(profile);
      const assistantMessage = await ctx.store.messages.create({
        chatId: chat.id,
        role: "assistant",
        content: assistantText,
      });

      const title = chat.title === "New chat" ? titleFromContent(content) : undefined;
      await ctx.store.chats.update(chat.id, title ? { title } : {});

      if (!stream) {
        return json(201, {
          userMessage,
          assistantMessage,
          profileId: profile.id,
          ...(mockTurn?.toolCall ? { toolCall: mockTurn.toolCall } : {}),
        });
      }
      return sseResponse(streamEvents(userMessage, assistantMessage, assistantText, mockTurn));
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

function stubAssistantText(profile: ModelProfile): string {
  return `Stub reply. Model streaming is not wired yet. Profile ${profile.id} (${profile.provider}/${profile.model}) was selected explicitly.`;
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
