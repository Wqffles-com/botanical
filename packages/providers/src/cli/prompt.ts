export interface CliPromptMessage {
  role: string;
  content: string | Array<{ type?: string; text?: string }>;
  name?: string;
}

/**
 * One prompt for a headless CLI. Prior turns are rendered compactly.
 * When Botanical tools are wired, the CLI reaches them through the MCP server
 * named `botanical` (its own tools still run in the working directory).
 */
export function renderCliPrompt(
  messages: readonly CliPromptMessage[],
  options?: { botanicalTools?: boolean },
): string {
  const parts: string[] = [
    options?.botanicalTools
      ? 'You are running headless inside Botanical. Botanical tools and the user\'s MCP servers are available from the MCP server named "botanical" (for example memory_write). Use those when the task needs Botanical state. Your own tools still run in this working directory. Botanical will not answer permission prompts.'
      : "You are running headless inside Botanical. Use your own tools in this working directory. Botanical does not call tools for you and will not answer permission prompts.",
  ];
  for (const message of messages) {
    const text = messageText(message);
    if (!text.trim()) continue;
    const label = message.role === "tool" && message.name ? `Tool ${message.name}` : capitalize(message.role);
    parts.push(`${label}:\n${text.trim()}`);
  }
  return parts.join("\n\n");
}

function messageText(message: CliPromptMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .map((part) => (part.type === undefined || part.type === "text" ? (part.text ?? "") : ""))
    .filter((part) => part.length > 0)
    .join("\n");
}

function capitalize(role: string): string {
  if (!role) return "Message";
  return role.slice(0, 1).toUpperCase() + role.slice(1);
}
