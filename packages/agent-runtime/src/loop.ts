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
import type { MemorySnippet } from "./memories";
import { selectMemories } from "./memories";
import { toolAccess } from "./permissions";
import { buildSystemPrompt } from "./prompt";
import type { ChatMessage } from "./provider";
import type { AgentMessageBus } from "./bus";
import type { MessageRepository } from "./store";
import type { Store } from "./store";
import type { ProfileResolver } from "./profiles";
import {
  collectTools,
  normalizeToolArguments,
  toolResultToContent,
  type ListedTool,
  type ToolResult,
  type ToolSource,
} from "./tools";

export const DEFAULT_MAX_STEPS = 8;
const MAX_TOOL_CALLS_PER_STEP = 16;

export interface MemoryRecall {
  /** Memories visible to this agent (shared + its own). The loop ranks them. */
  recall(input: { agentId: string; query: string }): Promise<MemorySnippet[]>;
}

export interface RuntimeDeps {
  store: Store;
  bus: AgentMessageBus;
  profiles: ProfileResolver;
  toolSources: ToolSource[];
  maxSteps?: number;
  /** Jail directory for a CLI profile's working directory. */
  workspaceFor?: (agentId: string) => string;
  /** When set, relevant memories are appended to the system prompt at turn start. */
  memories?: MemoryRecall;
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
  const recalled = await recallMemories(deps, agent.id, input.content);
  const cwd = deps.workspaceFor?.(agent.id);

  for (let step = 1; step <= maxSteps; step += 1) {
    if (input.signal?.aborted) {
      yield { type: "done", finishReason: "aborted" };
      return;
    }
    yield { type: "step", step };

    const catalog = await collectTools(deps.toolSources);
    const visibleTools = catalog.filter((tool) => toolAccess(agent, tool).ok);
    const requestMessages = toProviderMessages(agent, transcript, recalled);
    let text = "";
    const toolCalls: ToolCall[] = [];
    let errorMessage: string | null = null;
    const seenIds = new Set<string>();
    const settled = new Map<string, ToolResult>();

    for await (const event of profile.provider.complete({
      model: profile.model,
      messages: requestMessages,
      tools: visibleTools.map(toDefinition),
      signal: input.signal,
      agentId: agent.id,
      chatId: chat.id,
      ...(cwd ? { cwd } : {}),
    })) {
      if (event.type === "text-delta") {
        text += event.text;
        yield event;
      } else if (event.type === "tool-call") {
        // CLI MCP calls are already dispatched. The per-step cap only limits
        // model-requested calls that this loop still has to execute.
        if (!event.settled && toolCalls.length >= MAX_TOOL_CALLS_PER_STEP) continue;
        let id = event.id?.trim() || `call_${newId()}`;
        if (seenIds.has(id)) id = `${id}_${toolCalls.length}`;
        seenIds.add(id);
        const call: ToolCall = { id, name: event.name, arguments: event.arguments };
        toolCalls.push(call);
        yield { type: "tool-call", id, name: event.name, arguments: event.arguments };
        if (event.settled) {
          const result: ToolResult = {
            output: event.settled.output,
            isError: event.settled.isError === true,
          };
          settled.set(id, result);
          yield {
            type: "tool-result",
            id,
            name: event.name,
            result: result.output,
            isError: result.isError === true,
          };
        }
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

    const external = toolCalls.filter((call) => settled.has(call.id));
    const pending = toolCalls.filter((call) => !settled.has(call.id));
    for (const call of external) {
      const result = settled.get(call.id);
      if (!result) continue;
      const sent = a2aSideEffect(call.name, result);
      if (sent) yield { type: "a2a-sent", messageId: sent.messageId, toAgentId: sent.toAgentId };
      const toolMessage = await deps.store.messages.append({
        chatId: chat.id,
        role: "tool",
        name: call.name,
        toolCallId: call.id,
        content: toolResultToContent(result),
        profileId,
      });
      transcript.push(toolMessage);
    }

    if (errorMessage) {
      yield { type: "done", finishReason: "error" };
      return;
    }
    if (pending.length === 0) {
      yield { type: "done", finishReason: "stop" };
      return;
    }

    for (const call of pending) {
      if (input.signal?.aborted) {
        yield { type: "done", finishReason: "aborted" };
        return;
      }
      const executed = await executeCall(deps, agent, catalog, call, {
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

function toDefinition(tool: ListedTool): { name: string; description: string; parameters: Record<string, unknown> } {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  };
}

async function recallMemories(deps: RuntimeDeps, agentId: string, query: string): Promise<MemorySnippet[]> {
  if (!deps.memories) return [];
  const visible = await deps.memories.recall({ agentId, query });
  return selectMemories(visible, query);
}

function toProviderMessages(
  agent: AgentRecord,
  records: readonly MessageRecord[],
  memories: readonly MemorySnippet[],
): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: "system", content: buildSystemPrompt(agent, memories) }];
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

/**
 * The same allowlist and role check the model loop uses, then the tool
 * source's own call (workspace jail, limits, truncation). A denial is a tool
 * result, not a throw. CLI MCP calls this directly so it cannot drift.
 */
export async function dispatchToolCall(
  deps: Pick<RuntimeDeps, "toolSources">,
  agent: AgentRecord,
  catalog: readonly ListedTool[],
  call: { name: string; arguments: unknown },
  ctx: { agentId: string; chatId: string; signal?: AbortSignal },
): Promise<ToolResult> {
  const match = catalog.find((tool) => tool.name === call.name);
  if (!match) {
    return {
      output: { error: `Tool "${call.name}" is not allowed for agent "${agent.name}"` },
      isError: true,
    };
  }
  const access = toolAccess(agent, match);
  if (!access.ok) {
    return { output: { error: access.message }, isError: true };
  }
  let args: unknown;
  try {
    args = normalizeToolArguments(call.arguments);
  } catch (error) {
    const message = error instanceof ValidationError ? error.message : "Invalid tool arguments";
    return { output: { error: message }, isError: true };
  }
  const source = deps.toolSources.find((candidate) => candidate.id === match.sourceId);
  if (!source) {
    return { output: { error: `Tool source "${match.sourceId}" is not registered` }, isError: true };
  }
  try {
    return await source.call(call.name, args, ctx);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { output: { error: message }, isError: true };
  }
}

async function executeCall(
  deps: RuntimeDeps,
  agent: AgentRecord,
  catalog: readonly ListedTool[],
  call: ToolCall,
  ctx: { agentId: string; chatId: string; signal?: AbortSignal },
): Promise<ExecutedCall> {
  const result = await dispatchToolCall(deps, agent, catalog, call, ctx);
  const sent = a2aSideEffect(call.name, result);
  return sent ? { result, sent } : { result };
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
