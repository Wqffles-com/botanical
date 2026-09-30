import {
  autoCompact,
  AgentNotFoundError,
  BotanicalError,
  ChatNotFoundError,
  ProfileNotFoundError,
  ProfileRequiredError,
  replyIds,
  runAgentTurn,
  type RuntimeDeps,
  type MessageRecord,
  type RuntimeEvent,
  type TurnSteering,
} from "@botanical/agent-runtime";
import { ProviderError } from "@botanical/providers";
import { HttpError } from "../http.ts";
import type { SseEvent } from "../streaming.ts";
import type { Chat, Message, ModelProfile, Store } from "../types.ts";
import { handoffs, isGroupChat, respondersFor } from "./group.ts";

export interface TurnErrorBody {
  code: string;
  message: string;
}

export interface TurnResult {
  userMessage: Message;
  /** The last message the user reads from this turn (see `turnReplies`). */
  assistantMessage: Message | null;
  /** Group chats: the last reply of each agent that answered, in speaking order. */
  replies?: Message[];
  /** Every row the turn stored, in order: messages, notes, and tool results. */
  stored: Message[];
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

export interface ChatTurnInput {
  chat: Chat;
  content: string;
  profile: ModelProfile;
  signal?: AbortSignal;
  /** False when the user messages were stored before the turn (a queued batch). */
  appendUserMessage?: boolean;
  /** Messages sent while the turn runs (the async chat queue). */
  steering?: TurnSteering;
  /** The agent that answers: the owner (default) or a group member. */
  agentId?: string;
}

/**
 * Answer a user message, then compact the chat when it has outgrown the model's context
 * (`autoCompact`). A new summary goes out as a `compacted` event `{ message }` before the
 * last `done`. A failed compaction is logged and leaves the chat as it was.
 */
export async function* streamChatReplies(
  store: Store,
  runtime: RuntimeDeps,
  input: ChatTurnInput,
): AsyncGenerator<SseEvent> {
  let done: SseEvent | null = null;
  for await (const event of streamRound(store, runtime, input)) {
    if (event.event === "done") {
      done = event;
      continue;
    }
    yield event;
  }
  const finish = isRecord(done?.data) ? done.data.finishReason : undefined;
  if (!input.signal?.aborted && finish !== "error" && finish !== "aborted") {
    const summary = await compactAfterTurn(runtime, input);
    if (summary) yield { event: "compacted", data: { type: "compacted", message: summary } };
  }
  if (done) yield done;
}

async function compactAfterTurn(runtime: RuntimeDeps, input: ChatTurnInput): Promise<MessageRecord | null> {
  try {
    return await autoCompact(runtime, {
      chatId: input.chat.id,
      profileId: input.profile.id,
      ...(input.signal ? { signal: input.signal } : {}),
    });
  } catch (error) {
    console.error("[turn] auto-compaction failed", error);
    return null;
  }
}

/**
 * One round of replies to a user message. A one-agent chat runs one turn. A group chat runs one turn per
 * responder, one after another, so each agent reads the replies before its own
 * (`respondersFor`). A reply that @mentions another participant who has not answered
 * yet hands it the floor next. Each turn starts with an `agent` event `{ agentId }`.
 * Only the last `done` is forwarded. An error or a stop ends the round.
 */
async function* streamRound(
  store: Store,
  runtime: RuntimeDeps,
  input: ChatTurnInput,
): AsyncGenerator<SseEvent> {
  const { chat } = input;
  if (!isGroupChat(chat)) {
    yield* streamChatTurn(store, runtime, input);
    return;
  }
  const agents = await store.agents.list();
  const waiting = respondersFor(chat, agents, input.content);
  const answered = new Set<string>();
  let first = true;
  while (waiting.length > 0) {
    const agentId = waiting.shift() as string;
    answered.add(agentId);
    yield { event: "agent", data: { type: "agent", agentId } };
    let done: SseEvent | null = null;
    let replies: Message[] = [];
    for await (const event of streamChatTurn(store, runtime, {
      ...input,
      agentId,
      // Later speakers answer the same stored message. Only the first can be steered.
      ...(first ? {} : { appendUserMessage: false, steering: undefined }),
    })) {
      if (event.event === "done") {
        done = event;
        continue;
      }
      if (!first && event.event === "message.created") continue;
      if (event.event === "message.completed") replies = readReplies(event);
      yield event;
    }
    first = false;
    const finish = isRecord(done?.data) ? done.data.finishReason : undefined;
    if (input.signal?.aborted || finish === "error" || finish === "aborted") {
      if (done) yield done;
      return;
    }
    const said = replies.filter((reply) => reply.agentId === agentId).map((reply) => reply.content).join("\n\n");
    if (said.includes("@")) {
      waiting.push(...handoffs(chat, agents, said, new Set([...answered, ...waiting])));
    }
    if (waiting.length === 0 && done) yield done;
  }
}

export async function* streamChatTurn(
  store: Store,
  runtime: RuntimeDeps,
  input: ChatTurnInput,
): AsyncGenerator<SseEvent> {
  const { chat, content, profile } = input;
  const agentId = input.agentId ?? chat.agentId;
  const before = new Set((await store.messages.listByChat(chat.id)).map((message) => message.id));
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
      ...(input.agentId ? { agentId: input.agentId } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.appendUserMessage === false ? { appendUserMessage: false } : {}),
      ...(input.steering ? { steering: input.steering } : {}),
    })) {
      if (event.type === "step" || event.type === "inbox" || event.type === "a2a-sent") {
        yield* announce();
        continue;
      }
      if (event.type === "done") {
        yield* announce();
        await retitle(store, chat, content);
        const replies = await turnReplies(store, chat, agentId, before);
        // A turn with no reply (tool calls only) still names its last assistant row, as before.
        const assistant = replies.at(-1) ?? (await latest(store, chat.id, "assistant"));
        if (assistant) yield { event: "message.completed", data: { message: assistant, replies } };
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
    if (input.signal?.aborted) {
      await retitle(store, chat, content);
      yield { event: "done", data: { type: "done", finishReason: "aborted" } };
      return;
    }
    const body = publicTurnError(error);
    yield { event: "error", data: { type: "error", error: body.message, code: body.code } };
    await retitle(store, chat, content);
    yield { event: "done", data: { type: "done", finishReason: "error" } };
  }
}

export async function collectChatTurn(
  store: Store,
  runtime: RuntimeDeps,
  input: ChatTurnInput,
): Promise<TurnResult> {
  let toolCall: TurnResult["toolCall"];
  let toolResult: string | undefined;
  let error: TurnErrorBody | undefined;
  const before = new Set((await store.messages.listByChat(input.chat.id)).map((message) => message.id));
  const replies: Message[] = [];
  let assistantMessage: Message | null = null;
  for await (const event of streamChatReplies(store, runtime, input)) {
    if (event.event === "message.completed") {
      const reply = readMessage(event);
      if (reply) {
        replies.push(reply);
        assistantMessage = reply;
      }
    }
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
  assistantMessage ??= await latest(store, input.chat.id, "assistant");
  const stored = (await store.messages.listByChat(input.chat.id)).filter(
    (message) => !before.has(message.id) && message.id !== userMessage.id,
  );
  return {
    userMessage,
    assistantMessage,
    stored,
    ...(isGroupChat(input.chat) ? { replies } : {}),
    profileId: input.profile.id,
    ...(toolCall ? { toolCall } : {}),
    ...(toolResult !== undefined ? { toolResult } : {}),
    ...(error ? { error } : {}),
  };
}

function mapRuntimeEvent(event: RuntimeEvent): SseEvent | null {
  switch (event.type) {
    case "steer":
      return { event: "steer", data: { type: "steer", messages: event.messages } };
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

/**
 * What the user reads from one agent's turn: the messages it stored since `before` that count
 * as replies (`replyIds`: its `send_message` rows, or its text output when it sent none).
 */
async function turnReplies(store: Store, chat: Chat, agentId: string, before: ReadonlySet<string>): Promise<Message[]> {
  const messages = await store.messages.listByChat(chat.id);
  const ids = replyIds(messages, chat.agentId);
  return messages.filter(
    (message) => !before.has(message.id) && ids.has(message.id) && (message.agentId ?? chat.agentId) === agentId,
  );
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

function readMessage(event: SseEvent): Message | null {
  if (!isRecord(event.data) || !isRecord(event.data.message)) return null;
  return event.data.message as unknown as Message;
}

function readReplies(event: SseEvent): Message[] {
  if (!isRecord(event.data)) return [];
  if (Array.isArray(event.data.replies)) return event.data.replies as Message[];
  const message = readMessage(event);
  return message ? [message] : [];
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
