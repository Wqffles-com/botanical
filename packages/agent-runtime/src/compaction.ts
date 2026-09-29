import { BotanicalError, ChatNotFoundError, AgentNotFoundError } from "./errors";
import { estimateTokens } from "./context";
import type { MessageRecord } from "./message";
import type { ChatMessage } from "./provider";
import type { RuntimeDeps } from "./loop";

/**
 * Compaction keeps a long chat working. It summarizes the conversation so far into one stored
 * row (role `system`, name `compaction`). From then on the model reads that summary in its
 * system prompt, plus only the messages after the row. Older messages stay in the chat for
 * the user to read; they are just no longer sent to the model.
 */
export const COMPACTION_NAME = "compaction";

/** Auto-compaction runs after a turn once the model's view of the chat passes this share of its context. */
export const AUTO_COMPACT_RATIO = 0.75;

/** Fewer messages than this since the last summary are not worth compacting automatically. */
const AUTO_COMPACT_MIN_MESSAGES = 6;

/** A single tool result or call rendered into the summary request is cut to this many characters. */
const TOOL_TEXT_MAX = 1_500;

/** Share of the model's context the summary request may use. The rest is left for the answer. */
const REQUEST_SHARE = 0.7;

const COMPACT_SYSTEM = [
  "You compact a long chat between a user and an AI agent so the agent can keep working without the full history.",
  "Write a summary the agent will read in place of the messages. Keep what it needs to carry on:",
  "- what the user wants, their preferences, and decisions made",
  "- facts, names, numbers, file paths, links, and results the conversation established",
  "- work done so far, what is still open, and any promises the agent made",
  "Drop greetings, chatter, and anything superseded. Write in plain prose or short bullet points, in the third person (\"The user asked…\", \"The agent found…\"). Output only the summary.",
].join("\n");

type Row = Pick<MessageRecord, "role" | "name">;

export function isCompaction(record: Row): boolean {
  return record.role === "system" && record.name === COMPACTION_NAME;
}

/** The latest summary, if any, and the messages after it: what the model still reads. */
export function sinceCompaction<T extends Row>(records: readonly T[]): { summary: T | null; rest: T[] } {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index] as T;
    if (isCompaction(record)) return { summary: record, rest: records.slice(index + 1) };
  }
  return { summary: null, rest: [...records] };
}

/** True when the model's view of the chat has grown past `ratio` of `maxContext`. */
export function needsCompaction(
  records: readonly MessageRecord[],
  maxContext: number,
  ratio = AUTO_COMPACT_RATIO,
): boolean {
  if (!Number.isFinite(maxContext) || maxContext <= 0) return false;
  const { summary, rest } = sinceCompaction(records);
  if (rest.length < AUTO_COMPACT_MIN_MESSAGES) return false;
  const visible: ChatMessage[] = rest
    .filter((record) => record.role !== "system")
    .map((record) => ({
      role: record.role,
      content: record.content,
      ...(record.toolCalls ? { toolCalls: record.toolCalls } : {}),
    }));
  if (summary) visible.unshift({ role: "system", content: summary.content });
  return estimateTokens(visible) > maxContext * ratio;
}

export interface CompactChatInput {
  chatId: string;
  profileId: string;
  /** The agent that writes the summary. Defaults to the chat's owner. */
  agentId?: string;
  signal?: AbortSignal;
}

export class NothingToCompactError extends BotanicalError {
  constructor() {
    super("There is nothing new to compact in this chat", "NOTHING_TO_COMPACT", 409);
  }
}

export class CompactionFailedError extends BotanicalError {
  constructor(message: string) {
    super(message, "COMPACTION_FAILED", 502);
  }
}

/**
 * Summarize everything the model still reads (the last summary plus the messages after it)
 * with the profile's model, and store the summary as a compaction row. Throws
 * `NothingToCompactError` when no message came after the last summary.
 */
export async function compactChat(deps: RuntimeDeps, input: CompactChatInput): Promise<MessageRecord> {
  const chat = await deps.store.chats.get(input.chatId);
  if (!chat) throw new ChatNotFoundError(input.chatId);
  const agentId = input.agentId || chat.agentId;
  const agent = await deps.store.agents.get(agentId);
  if (!agent) throw new AgentNotFoundError(agentId);
  const profile = await deps.profiles.resolve(input.profileId);

  const records = await deps.store.messages.listByChat(chat.id);
  const { summary, rest } = sinceCompaction(records);
  const messages = rest.filter((record) => record.role !== "system");
  if (messages.length === 0) throw new NothingToCompactError();

  const names = new Map((await deps.store.agents.list(500)).map((row) => [row.id, row.name]));
  const budget = profile.provider.capabilities(profile.model).maxContext;
  const request = compactionRequest(summary?.content ?? null, messages, names, chat.agentId, budget);

  let text = "";
  const cwd = deps.workspaceFor?.(agent.id);
  for await (const event of profile.provider.complete({
    model: profile.model,
    messages: request,
    tools: [],
    signal: input.signal,
    agentId: agent.id,
    chatId: chat.id,
    ...(cwd ? { cwd } : {}),
  })) {
    if (event.type === "text-delta") text += event.text;
    else if (event.type === "error") {
      throw new CompactionFailedError(`Compaction failed: ${event.error.message}`);
    }
  }
  if (input.signal?.aborted) throw new CompactionFailedError("Compaction was stopped");
  const content = text.trim();
  if (!content) throw new CompactionFailedError("Compaction failed: the model returned an empty summary");

  return deps.store.messages.append({
    chatId: chat.id,
    role: "system",
    name: COMPACTION_NAME,
    content,
    profileId: profile.profileId,
    agentId: agent.id,
  });
}

/**
 * After a turn: compact when the chat has outgrown `AUTO_COMPACT_RATIO` of the profile's context.
 * Returns the new summary row, or null when none was needed.
 */
export async function autoCompact(
  deps: RuntimeDeps,
  input: CompactChatInput,
): Promise<MessageRecord | null> {
  const profile = await deps.profiles.resolve(input.profileId);
  const budget = profile.provider.capabilities(profile.model).maxContext;
  const records = await deps.store.messages.listByChat(input.chatId);
  if (!needsCompaction(records, budget)) return null;
  return compactChat(deps, input);
}

/** The system prompt section that stands in for compacted messages. */
export function renderCompactionSection(summary: string): string {
  return [
    "## Earlier in this chat",
    "Older messages in this chat were compacted. This summary replaces them:",
    "",
    summary.trim(),
  ].join("\n");
}

function compactionRequest(
  previous: string | null,
  records: readonly MessageRecord[],
  names: ReadonlyMap<string, string>,
  ownerId: string,
  maxContext: number,
): ChatMessage[] {
  const lines = records.map((record) => renderRecord(record, names, ownerId)).filter((line) => line.length > 0);
  // Keep the request inside the model's context: the oldest lines give way first.
  const limit = Number.isFinite(maxContext) && maxContext > 0 ? maxContext * REQUEST_SHARE * 4 : Infinity;
  const head = previous ? `Summary of the chat before these messages:\n${previous.trim()}\n\n` : "";
  let used = head.length + COMPACT_SYSTEM.length;
  const kept: string[] = [];
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index] as string;
    if (kept.length > 0 && used + line.length > limit) {
      kept.push("[Older messages were too long to include.]");
      break;
    }
    kept.push(line);
    used += line.length + 2;
  }
  kept.reverse();
  return [
    { role: "system", content: COMPACT_SYSTEM },
    {
      role: "user",
      content: `${head}Messages to compact:\n\n${kept.join("\n\n")}\n\nWrite the summary now.`,
    },
  ];
}

function renderRecord(record: MessageRecord, names: ReadonlyMap<string, string>, ownerId: string): string {
  const author = names.get(record.agentId ?? ownerId) ?? "Agent";
  if (record.role === "user") return `User: ${record.content.trim()}`;
  if (record.role === "assistant") {
    const parts: string[] = [];
    if (record.content.trim()) parts.push(`${author}: ${record.content.trim()}`);
    for (const call of record.toolCalls ?? []) {
      parts.push(`${author} called ${call.name}(${clip(JSON.stringify(call.arguments ?? {}))})`);
    }
    return parts.join("\n");
  }
  if (record.role === "tool") return `Result of ${record.name ?? "tool"}: ${clip(record.content.trim())}`;
  return "";
}

function clip(text: string): string {
  return text.length <= TOOL_TEXT_MAX ? text : `${text.slice(0, TOOL_TEXT_MAX - 1)}…`;
}
