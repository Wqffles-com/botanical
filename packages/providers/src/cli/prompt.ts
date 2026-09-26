export interface CliPromptMessage {
  role: string;
  content: string | Array<{ type?: string; text?: string }>;
  name?: string;
}

/**
 * One prompt for a CLI that has no Botanical tool channel. Prior turns are
 * rendered compactly. The CLI executes its own tools in the workspace.
 */
export function renderCliPrompt(messages: readonly CliPromptMessage[]): string {
  const parts: string[] = [
    "You are running headless inside Botanical. Use your own tools in this working directory. Botanical does not call tools for you and will not answer permission prompts.",
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
