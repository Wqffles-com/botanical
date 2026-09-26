import type { AgentRecord } from "./agent";
import type { ChatRecord } from "./chat";
import { assertChatAgentBinding } from "./binding";
import {
  AgentNotFoundError,
  ChatNotFoundError,
  ProfileRequiredError,
  ValidationError,
} from "./errors";
import type { RuntimeEvent } from "./events";
import { claimInbox } from "./inbox";
import { newId } from "./ids";
import type { MessageRecord, ToolCall } from "./message";
import type { ResolvedProfile } from "./profiles";
import { buildSystemPrompt } from "./prompt";
import type { ChatMessage } from "./provider";
import type { AgentMessageBus } from "./bus";
import type { MessageRepository } from "./store";
import type { Store } from "./store";
import type { ProfileResolver } from "./profiles";
import {
  collectTools,
  normalizeToolArguments,
  toolAllowed,
  toolResultToContent,
  type ListedTool,
  type ToolResult,
  type ToolSource,
} from "./tools";

export const DEFAULT_MAX_STEPS = 8;
const MAX_TOOL_CALLS_PER_STEP = 16;

export interface RuntimeDeps {
  store: Store;
  bus: AgentMessageBus;
  profiles: ProfileResolver;
  toolSources: ToolSource[];
  maxSteps?: number;
}

export interface RunTurnInput {
  chatId: string;
  content: string;
  profileId: string;
  agentId?: string;
  signal?: AbortSignal;
  maxSteps?: number;
}

export interface PreparedTurn {
  chat: ChatRecord;
  agent: AgentRecord;
  profile: ResolvedProfile;
}

/** Validation that must fail before the response stream starts. */
export async function prepareTurn(deps: RuntimeDeps, input: RunTurnInput): Promise<PreparedTurn> {
  const profileId = input.profileId?.trim() ?? "";
  if (!profileId) throw new ProfileRequiredError();
  const chat = await deps.store.chats.get(input.chatId);
  if (!chat) throw new ChatNotFoundError(input.chatId);
  assertChatAgentBinding(chat, input.agentId);
  const agent = await deps.store.agents.get(chat.agentId);
  if (!agent) throw new AgentNotFoundError(chat.agentId);
  const profile = await deps.profiles.resolve(profileId);
  return { chat, agent, profile };
}

/**
 * One user turn: persist the user message, inject delivered A2A mail,
 * then alternate model and tools until the model stops, the step cap hits,
 * or the request is aborted.
 *
 * Provider `done` events are not forwarded. The client uses the runtime's
 * own `done`, which is emitted only after tool calls from that step finish.
 */
export async function* runAgentTurn(
  deps: RuntimeDeps,
  input: RunTurnInput,
): AsyncGenerator<RuntimeEvent> {
  const prepared = await prepareTurn(deps, input);
  if (input.signal?.aborted) {
    yield { type: "done", finishReason: "aborted" };
    return;
  }

  const { chat, agent, profile } = prepared;
  const profileId = profile.profileId;
  const maxSteps = input.maxSteps ?? deps.maxSteps ?? DEFAULT_MAX_STEPS;

  await deps.store.messages.append({
    chatId: chat.id,
    role: "user",
    content: input.content.trim(),
    profileId,
  });
  if (!chat.title.trim()) {
    await deps.store.chats.updateTitle(chat.id, input.content.trim().slice(0, 80));
  } else {
    await deps.store.chats.touch(chat.id);
  }

  const names = new Map((await deps.store.agents.list(500)).map((row) => [row.id, row.name]));
  const inbox = await claimInbox(deps.bus, agent.id, chat.id, profileId, names);
  if (inbox.transcript) {
    await deps.store.messages.append(inbox.transcript);
    yield {
      type: "inbox",
      messages: inbox.messages.map((message) => ({
        id: message.id,
        fromAgentId: message.fromAgentId,
        body: message.body,
        createdAt: message.createdAt,
      })),
    };
  }

  const transcript = await deps.store.messages.listByChat(chat.id);
  const visibleTools = await visibleToolsFor(agent, deps.toolSources);

  for (let step = 1; step <= maxSteps; step += 1) {
    if (input.signal?.aborted) {
      yield { type: "done", finishReason: "aborted" };
      return;
    }
    yield { type: "step", step };

    const requestMessages = toProviderMessages(agent, transcript);
    let text = "";
    const toolCalls: ToolCall[] = [];
    let errorMessage: string | null = null;
    const seenIds = new Set<string>();

    for await (const event of profile.provider.complete({
      model: profile.model,
      messages: requestMessages,
      tools: visibleTools.map(toDefinition),
      signal: input.signal,
    })) {
      if (event.type === "text-delta") {
        text += event.text;
        yield event;
      } else if (event.type === "tool-call") {
        if (toolCalls.length >= MAX_TOOL_CALLS_PER_STEP) continue;
        let id = event.id?.trim() || `call_${newId()}`;
        if (seenIds.has(id)) id = `${id}_${toolCalls.length}`;
        seenIds.add(id);
        const call: ToolCall = { id, name: event.name, arguments: event.arguments };
        toolCalls.push(call);
        yield { type: "tool-call", id, name: event.name, arguments: event.arguments };
      } else if (event.type === "usage") {
        yield event;
      } else if (event.type === "error") {
        errorMessage = event.error instanceof Error ? event.error.message : String(event.error);
        yield { type: "error", error: errorMessage };
      }
    }

    const assistant = await deps.store.messages.append({
      chatId: chat.id,
      role: "assistant",
      content: text,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      profileId,
    });
    transcript.push(assistant);

    if (errorMessage) {
      yield { type: "done", finishReason: "error" };
      return;
    }
    if (toolCalls.length === 0) {
      yield { type: "done", finishReason: "stop" };
      return;
    }

    for (const call of toolCalls) {
      if (input.signal?.aborted) {
        yield { type: "done", finishReason: "aborted" };
        return;
      }
      const executed = await executeCall(deps, agent, visibleTools, call, {
        agentId: agent.id,
        chatId: chat.id,
        signal: input.signal,
      });
      yield {
        type: "tool-result",
        id: call.id,
        name: call.name,
        result: executed.result.output,
        isError: executed.result.isError ?? false,
      };
      if (executed.sent) {
        yield { type: "a2a-sent", messageId: executed.sent.messageId, toAgentId: executed.sent.toAgentId };
      }
      const toolMessage = await deps.store.messages.append({
        chatId: chat.id,
        role: "tool",
        name: call.name,
        toolCallId: call.id,
        content: toolResultToContent(executed.result),
        profileId,
      });
      transcript.push(toolMessage);
    }
  }

  yield { type: "done", finishReason: "max_steps" };
}

async function visibleToolsFor(agent: AgentRecord, sources: readonly ToolSource[]): Promise<ListedTool[]> {
  const listed = await collectTools(sources);
  return listed.filter((tool) => {
    if (tool.origin === "runtime" || tool.sourceId === "runtime") return agent.a2aEnabled;
    return toolAllowed(agent.toolAllowlist, tool.name);
  });
}

function toDefinition(tool: ListedTool): { name: string; description: string; parameters: Record<string, unknown> } {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  };
}

function toProviderMessages(agent: AgentRecord, records: readonly MessageRecord[]): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: "system", content: buildSystemPrompt(agent) }];
  for (const record of records) {
    const message: ChatMessage = { role: record.role, content: record.content };
    if (record.toolCallId) message.toolCallId = record.toolCallId;
    if (record.toolCalls) message.toolCalls = record.toolCalls;
    if (record.name) message.name = record.name;
    messages.push(message);
  }
  return messages;
}

interface ExecutedCall {
  result: ToolResult;
  sent?: { messageId: string; toAgentId: string };
}

async function executeCall(
  deps: RuntimeDeps,
  agent: AgentRecord,
  visible: readonly ListedTool[],
  call: ToolCall,
  ctx: { agentId: string; chatId: string; signal?: AbortSignal },
): Promise<ExecutedCall> {
  const match = visible.find((tool) => tool.name === call.name);
  if (!match) {
    return {
      result: {
        output: { error: `Tool "${call.name}" is not allowed for agent "${agent.name}"` },
        isError: true,
      },
    };
  }
  let args: unknown;
  try {
    args = normalizeToolArguments(call.arguments);
  } catch (error) {
    const message = error instanceof ValidationError ? error.message : "Invalid tool arguments";
    return { result: { output: { error: message }, isError: true } };
  }
  const source = deps.toolSources.find((candidate) => candidate.id === match.sourceId);
  if (!source) {
    return { result: { output: { error: `Tool source "${match.sourceId}" is not registered` }, isError: true } };
  }
  try {
    const result = await source.call(call.name, args, ctx);
    const sent = a2aSideEffect(call.name, result);
    return sent ? { result, sent } : { result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { result: { output: { error: message }, isError: true } };
  }
}

function a2aSideEffect(
  name: string,
  result: ToolResult,
): { messageId: string; toAgentId: string } | undefined {
  if (name !== "agent_send" || result.isError) return undefined;
  if (!result.output || typeof result.output !== "object") return undefined;
  const output = result.output as Record<string, unknown>;
  if (typeof output.messageId !== "string" || typeof output.toAgentId !== "string") return undefined;
  return { messageId: output.messageId, toAgentId: output.toAgentId };
}

/** Test/helper: read the persisted transcript after a turn. */
export async function readTranscript(
  messages: MessageRepository,
  chatId: string,
): Promise<MessageRecord[]> {
  return messages.listByChat(chatId);
}
