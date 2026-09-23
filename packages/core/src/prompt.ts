import type { AgentRecord } from "./agent";

export function buildSystemPrompt(agent: AgentRecord): string {
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
  return lines.join("\n");
}
