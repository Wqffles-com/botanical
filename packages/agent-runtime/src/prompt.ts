import type { AgentRecord } from "./agent";
import { renderMemorySection, type MemorySnippet } from "./memories";

/** Default chat style: agents talk like a teammate, not a report writer. */
export const RESPONSE_STYLE =
  "Reply like a teammate in chat: short, plain messages, usually a sentence or two. Lead with the answer or what you did. Skip preamble, recaps, and headings unless asked. Ask one quick question if you're blocked.";

export function buildSystemPrompt(agent: AgentRecord, memories?: readonly MemorySnippet[]): string {
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
  lines.push("", RESPONSE_STYLE);
  const memorySection = renderMemorySection(memories ?? []);
  if (memorySection) lines.push("", memorySection);
  return lines.join("\n");
}
