import {
  AgentNotFoundError,
  BotanicalError,
  ChatNotFoundError,
  ProfileNotFoundError,
  ProfileRequiredError,
  runAgentTurn,
  type RuntimeDeps,
  type RuntimeEvent,
} from "@botanical/agent-runtime";
import { ProviderError } from "@botanical/providers";
import { HttpError } from "../http.ts";
import type { SseEvent } from "../streaming.ts";
import type { Chat, Message, ModelProfile, Store } from "../types.ts";

export interface TurnErrorBody {
  code: string;
  message: string;
}

export interface TurnResult {
  userMessage: Message;
  assistantMessage: Message | null;
  profileId: string;
  toolCall?: { id: string; name: string; arguments: unknown };
  toolResult?: string;
  error?: TurnErrorBody;
}

export function turnFailure(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  if (error instanceof ProfileRequiredError) {
    return new HttpError(422, "profile_required", "Choose a model profile. Botanical has no default model.");
  }
  if (error instanceof ProfileNotFoundError) {
    return new HttpError(
      422,
      "unknown_profile",
      "Unknown model profile. Choose one from GET /api/profiles. There is no default model.",
    );
  }
  if (error instanceof ChatNotFoundError) return new HttpError(404, "not_found", "Chat not found");
  if (error instanceof AgentNotFoundError) return new HttpError(404, "not_found", "Agent not found");
  if (error instanceof BotanicalError) return new HttpError(error.status, error.code.toLowerCase(), error.message);
  console.error(error);
  return new HttpError(500, "internal_error", "Internal server error");
}

export async function* streamChatTurn(
  store: Store,
  runtime: RuntimeDeps,
  input: { chat: Chat; content: string; profile: ModelProfile; signal?: AbortSignal },
): AsyncGenerator<SseEvent> {
  const { chat, content, profile } = input;
  let announced = false;
  const announce = async function* (): AsyncGenerator<SseEvent> {
    if (announced) return;
    announced = true;
    const user = await latest(store, chat.id, "user");
    if (user) yield { event: "message.created", data: { message: user } };
  };

  try {
    for await (const event of runAgentTurn(runtime, {
      chatId: chat.id,
      content,
      profileId: profile.id,
      ...(input.signal ? { signal: input.signal } : {}),
    })) {
      if (event.type === "step" || event.type === "inbox" || event.type === "a2a-sent") {
        yield* announce();
        continue;
      }
      if (event.type === "done") {
        yield* announce();
        await retitle(store, chat, content);
        const assistant = await latest(store, chat.id, "assistant");
        if (assistant) yield { event: "message.completed", data: { message: assistant } };
        yield {
          event: "done",
          data: {
            type: "done",
            finishReason: event.finishReason,
            ...(assistant ? { messageId: assistant.id } : {}),
          },
        };
        return;
      }
      yield* announce();
      const mapped = mapRuntimeEvent(event);
      if (mapped) yield mapped;
    }
    yield* announce();
    await retitle(store, chat, content);
    yield { event: "done", data: { type: "done" } };
  } catch (error) {
    yield* announce();
    const body = publicTurnError(error);
    yield { event: "error", data: { type: "error", error: body.message, code: body.code } };
    await retitle(store, chat, content);
    yield { event: "done", data: { type: "done", finishReason: "error" } };
  }
}

export async function collectChatTurn(
  store: Store,
  runtime: RuntimeDeps,
  input: { chat: Chat; content: string; profile: ModelProfile; signal?: AbortSignal },
): Promise<TurnResult> {
  let toolCall: TurnResult["toolCall"];
  let toolResult: string | undefined;
  let error: TurnErrorBody | undefined;
  for await (const event of streamChatTurn(store, runtime, input)) {
    if (!toolCall) {
      const call = readToolCall(event);
      if (call) toolCall = call;
    }
    if (toolResult === undefined && event.event === "tool-result") {
      toolResult = readToolResult(event);
    }
    if (!error && event.event === "error") error = readError(event);
  }
  const userMessage = await latest(store, input.chat.id, "user");
  if (!userMessage) throw new HttpError(500, "internal_error", "Internal server error");
  const assistantMessage = await latest(store, input.chat.id, "assistant");
  return {
    userMessage,
    assistantMessage,
    profileId: input.profile.id,
    ...(toolCall ? { toolCall } : {}),
    ...(toolResult !== undefined ? { toolResult } : {}),
    ...(error ? { error } : {}),
  };
}

function mapRuntimeEvent(event: RuntimeEvent): SseEvent | null {
  switch (event.type) {
    case "text-delta":
      return { event: "text-delta", data: { type: "text-delta", text: event.text } };
    case "tool-call":
      return {
        event: "tool-call",
        data: { type: "tool-call", id: event.id, name: event.name, arguments: event.arguments },
      };
    case "tool-result":
      return {
        event: "tool-result",
        data: {
          type: "tool-result",
          id: event.id,
          name: event.name,
          content: typeof event.result === "string" ? event.result : JSON.stringify(event.result ?? ""),
          isError: event.isError,
        },
      };
    case "usage":
      return {
        event: "usage",
        data: { type: "usage", inputTokens: event.inputTokens, outputTokens: event.outputTokens },
      };
    case "error":
      return { event: "error", data: { type: "error", error: event.error, code: event.code ?? "error" } };
    default:
      return null;
  }
}

function publicTurnError(error: unknown): TurnErrorBody {
  if (error instanceof ProviderError) return { code: error.code, message: error.message };
  if (error instanceof BotanicalError) return { code: error.code.toLowerCase(), message: error.message };
  if (error instanceof HttpError) return { code: error.code, message: error.message };
  console.error(error);
  return { code: "internal_error", message: "The model request failed" };
}

async function latest(store: Store, chatId: string, role: Message["role"]): Promise<Message | null> {
  const messages = await store.messages.listByChat(chatId);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === role) return message;
  }
  return null;
}

async function retitle(store: Store, chat: Chat, content: string): Promise<void> {
  if (chat.title !== "New chat") return;
  await store.chats.update(chat.id, { title: titleFromContent(content) });
}

function titleFromContent(content: string): string {
  const oneLine = content.trim().replace(/\s+/g, " ");
  if (oneLine.length <= 80) return oneLine;
  return `${oneLine.slice(0, 77)}...`;
}

function readToolCall(event: SseEvent): TurnResult["toolCall"] | null {
  if (event.event !== "tool-call" || !isRecord(event.data) || typeof event.data.name !== "string") return null;
  return {
    id: typeof event.data.id === "string" ? event.data.id : "",
    name: event.data.name,
    arguments: event.data.arguments ?? {},
  };
}

function readToolResult(event: SseEvent): string | undefined {
  if (!isRecord(event.data)) return undefined;
  return typeof event.data.content === "string" ? event.data.content : undefined;
}

function readError(event: SseEvent): TurnErrorBody | undefined {
  if (!isRecord(event.data)) return undefined;
  const message = typeof event.data.error === "string" ? event.data.error : "The model request failed";
  const code = typeof event.data.code === "string" ? event.data.code : "error";
  return { code, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
