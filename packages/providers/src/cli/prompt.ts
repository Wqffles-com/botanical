export interface CliPromptMessage {
  role: string;
  content: string | Array<{ type?: string; text?: string }>;
  name?: string;
}

/** Longer tool lists are cut here so a large MCP catalog does not swamp the prompt. */
const NAMED_TOOLS_MAX = 40;

/**
 * One prompt for a headless CLI. Prior turns are rendered compactly.
 * When Botanical tools are wired, the CLI reaches them through the MCP server
 * named `botanical` (its own tools still run in the working directory). The
 * prompt names only `toolNames`, the tools that server will list (issue #92).
 */
export function renderCliPrompt(
  messages: readonly CliPromptMessage[],
  options?: { botanicalTools?: boolean; toolNames?: readonly string[] },
): string {
  const parts: string[] = [
    options?.botanicalTools
      ? botanicalToolsPreamble(options.toolNames ?? [])
      : "You are running headless inside Botanical. Use your own tools in this working directory. Botanical does not call tools for you and will not answer permission prompts. Botanical tools such as memory and messages to other agents are not enabled for you. If the task needs them, say so in your reply instead of looking for a workaround.",
  ];
  for (const message of messages) {
    const text = messageText(message);
    if (!text.trim()) continue;
    const label = message.role === "tool" && message.name ? `Tool ${message.name}` : capitalize(message.role);
    parts.push(`${label}:\n${text.trim()}`);
  }
  return parts.join("\n\n");
}

function botanicalToolsPreamble(toolNames: readonly string[]): string {
  const names = [...new Set(toolNames.map((name) => name.trim()).filter(Boolean))];
  let available: string;
  if (names.length === 0) {
    available = 'Botanical tools are available from the MCP server named "botanical".';
  } else {
    const shown = names.slice(0, NAMED_TOOLS_MAX).join(", ");
    const more = names.length > NAMED_TOOLS_MAX ? `, and ${names.length - NAMED_TOOLS_MAX} more` : "";
    available = `The MCP server named "botanical" has these Botanical tools: ${shown}${more}. Claude Code names them with an mcp__botanical__ prefix (for example mcp__botanical__${names[0]}).`;
  }
  return `You are running headless inside Botanical. ${available} Use those, not local files, when the task needs Botanical state. If the task needs a Botanical tool that is not listed, say so in your reply instead of looking for a workaround. Your own tools still run in this working directory. Botanical will not answer permission prompts.`;
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
