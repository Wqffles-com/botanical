import type { AgentMessageRecord } from "./a2a";
import { INBOX_INJECT_LIMIT } from "./a2a";
import type { AgentMessageBus } from "./bus";
import type { NewMessage } from "./message";

export interface InjectedInbox {
  messages: AgentMessageRecord[];
  transcript: NewMessage | null;
}

/**
 * Claim delivered mail for this agent and render it as a transcript row.
 * User role is intentional: several providers drop a system message that
 * appears after the conversation has started. The prefix marks it as mail,
 * not as the human.
 */
export async function claimInbox(
  bus: AgentMessageBus,
  agentId: string,
  chatId: string,
  profileId: string,
  names: ReadonlyMap<string, string>,
): Promise<InjectedInbox> {
  const delivered = await bus.deliverPending({ toAgentId: agentId, limit: INBOX_INJECT_LIMIT });
  const already = await bus.listInbox(agentId, {
    status: ["delivered"],
    limit: INBOX_INJECT_LIMIT,
  });
  const byId = new Map<string, AgentMessageRecord>();
  for (const message of [...delivered, ...already]) byId.set(message.id, message);
  const pendingRead = [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (pendingRead.length === 0) return { messages: [], transcript: null };

  const claimed = await bus.markRead(pendingRead.map((message) => message.id));
  claimed.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (claimed.length === 0) return { messages: [], transcript: null };

  return {
    messages: claimed,
    transcript: {
      chatId,
      role: "user",
      name: "a2a-inbox",
      profileId,
      content: renderInbox(claimed, names),
    },
  };
}

export function renderInbox(
  messages: readonly AgentMessageRecord[],
  names: ReadonlyMap<string, string>,
): string {
  const lines = ["[Asynchronous messages from other agents — not the human user]"];
  for (const message of messages) {
    const name = names.get(message.fromAgentId) ?? message.fromAgentId;
    lines.push(
      `- from ${name} (${message.fromAgentId}) at ${message.createdAt}, id ${message.id}:`,
      message.body,
    );
  }
  return lines.join("\n");
}
