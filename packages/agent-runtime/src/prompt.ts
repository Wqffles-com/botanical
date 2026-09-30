import type { AgentRecord } from "./agent";
import { renderCompactionSection } from "./compaction";
import { renderMemorySection, type MemorySnippet } from "./memories";

/** How an agent reaches the user: `send_message`, not its text output. */
export const MESSAGING =
  "The user does not see your text output. It is kept as a collapsed note beside the chat. To talk to the user, call the send_message tool. You can send several messages in one turn, for example a quick note on what you are starting and then the result. Do not repeat a message in your text output.";

/** Default chat style: agents talk like a teammate, not a report writer. */
export const RESPONSE_STYLE =
  "Write like a teammate in chat: short, plain messages, usually a sentence or two. Lead with the answer or what you did. Skip preamble, recaps, and headings unless asked. Ask one quick question if you're blocked.";

/** Who else is in a group chat. Absent for a one-agent chat. */
export interface GroupContext {
  others: readonly string[];
}

export function buildSystemPrompt(
  agent: AgentRecord,
  memories?: readonly MemorySnippet[],
  group?: GroupContext,
  /** Summary of compacted messages, which the model no longer reads one by one. */
  summary?: string,
): string {
  const lines = [agent.prompt.trim()];
  if (agent.description.trim()) {
    lines.push("", `Description: ${agent.description.trim()}`);
  }
  if (agent.a2aEnabled) {
    lines.push(
      "",
      "You can message other agents with the agent_send tool. Delivery is asynchronous: do not expect a reply in this turn. Unread messages from other agents are injected into the conversation when they arrive, and agent_inbox lists anything still unread.",
    );
  }
  if (group && group.others.length > 0) {
    lines.push(
      "",
      `You are ${agent.name} in a group chat with the user and these agents: ${group.others.join(", ")}. Their messages reach you as user messages that start with their name in brackets, like "[${group.others[0]}] ...". Speak only for yourself, add what the others have not said, and do not repeat them. Mention an agent as @Name in a message to ask it for a reply.`,
    );
  }
  lines.push("", MESSAGING, "", RESPONSE_STYLE);
  const memorySection = renderMemorySection(memories ?? []);
  if (memorySection) lines.push("", memorySection);
  if (summary?.trim()) lines.push("", renderCompactionSection(summary));
  return lines.join("\n");
}
