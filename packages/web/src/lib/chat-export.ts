import { isCompactionMessage, type Chat, type ChatMessage } from "@botanical/core";

export const CHAT_EXPORT_FORMAT = "botanical-chat";

type ExportContext = {
  chat: Pick<Chat, "id" | "title" | "agentId" | "memberIds" | "createdAt" | "updatedAt">;
  messages: ChatMessage[];
  /** Agent names by id, used to label who wrote a reply. */
  agentNames: Record<string, string>;
  exportedAt?: string;
};

function author(message: ChatMessage, context: ExportContext): string {
  if (message.role === "user") return "You";
  const id = message.agentId ?? context.chat.agentId;
  return context.agentNames[id] ?? "Agent";
}

function fence(text: string, lang = ""): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  const ticks = "`".repeat(longest + 1);
  return `${ticks}${lang}\n${text}\n${ticks}`;
}

/** Messages, tool calls, and compaction summaries as JSON. */
export function chatToJson(context: ExportContext): string {
  return JSON.stringify(
    {
      format: CHAT_EXPORT_FORMAT,
      version: 1,
      exportedAt: context.exportedAt ?? new Date().toISOString(),
      chat: context.chat,
      messages: context.messages.map((message) => ({
        ...message,
        author: author(message, context),
        compaction: isCompactionMessage(message) || undefined,
      })),
    },
    null,
    2,
  );
}

/** A readable transcript: replies as sections, tool calls and results as code blocks. */
export function chatToMarkdown(context: ExportContext): string {
  const lines = [`# ${context.chat.title.trim() || "Chat"}`, ""];
  const meta = [`Exported ${context.exportedAt ?? new Date().toISOString()}`];
  lines.push(`_${meta.join(" · ")}_`, "");
  for (const message of context.messages) {
    if (isCompactionMessage(message)) {
      lines.push("---", "", "## Conversation compacted", "", message.content.trim(), "", "---", "");
      continue;
    }
    if (message.role === "tool") {
      lines.push(`**Tool result${message.name ? ` (${message.name})` : ""}**`, "", fence(message.content), "");
      continue;
    }
    const heading = `## ${author(message, context)}`;
    lines.push(message.createdAt ? `${heading} · ${message.createdAt}` : heading, "");
    if (message.content.trim()) lines.push(message.content.trim(), "");
    for (const call of message.toolCalls ?? []) {
      lines.push(`**Tool call: ${call.name}**`, "", fence(JSON.stringify(call.arguments, null, 2) ?? "", "json"), "");
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
