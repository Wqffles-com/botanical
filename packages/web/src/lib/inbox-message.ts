import type { AgentMessage, ChatMessage } from "@botanical/core";

/** First line of the transcript row `renderInbox` in `@botanical/agent-runtime` writes. */
const INBOX_HEADER = "[Asynchronous messages from other agents — not the human user]";
const ENTRY_LINE = /^- from (.+) \(([^()\s]+)\) at (\S+), id ([^\s:]+):$/;
const MENTION = /^You were mentioned in the chat "([\s\S]*)" \(chat ([^()\s]+)\)\. The user wrote:\n\n([\s\S]*)$/;

export interface InboxMention {
  chatTitle: string;
  chatId: string;
  /** What the user wrote in that chat. */
  text: string;
}

export interface InboxEntry {
  id: string;
  fromName: string;
  fromAgentId: string;
  createdAt: string;
  body: string;
  /** Set when the mail is an `@Name` mention forwarded from another chat. */
  mention?: InboxMention;
}

/**
 * Agent mail lands in the transcript as a user row so providers keep it.
 * Split it back into messages for the chat view. Anything else returns null.
 */
export function parseInboxMessage(message: Pick<ChatMessage, "role" | "content">): InboxEntry[] | null {
  if (message.role !== "user") return null;
  const lines = message.content.split("\n");
  if (lines[0]?.trim() !== INBOX_HEADER) return null;

  const entries: InboxEntry[] = [];
  let body: string[] = [];
  const flush = () => {
    const last = entries.at(-1);
    if (!last) return;
    last.body = body.join("\n").trim();
    const mention = parseMention(last.body);
    if (mention) last.mention = mention;
    body = [];
  };
  for (const line of lines.slice(1)) {
    const match = ENTRY_LINE.exec(line);
    if (match) {
      flush();
      entries.push({ fromName: match[1]!, fromAgentId: match[2]!, createdAt: match[3]!, id: match[4]!, body: "" });
    } else if (entries.length > 0) {
      body.push(line);
    }
  }
  flush();
  return entries.length > 0 ? entries : null;
}

/** The `@Name` mention agent-runtime forwards from another chat, or null for ordinary mail. */
export function parseMention(body: string): InboxMention | null {
  const match = MENTION.exec(body.trim());
  return match ? { chatTitle: match[1]!, chatId: match[2]!, text: match[3]!.trim() } : null;
}

/** Messages either agent sent the other, oldest first, from both agents' inboxes. */
export function conversationBetween<T extends Pick<AgentMessage, "id" | "fromAgentId" | "toAgentId" | "createdAt">>(
  messages: readonly T[],
  first: string,
  second: string,
): T[] {
  const byId = new Map<string, T>();
  for (const message of messages) {
    const between =
      (message.fromAgentId === first && message.toAgentId === second) ||
      (message.fromAgentId === second && message.toAgentId === first);
    if (between) byId.set(message.id, message);
  }
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** One-line preview for a collapsed mail row. */
export function inboxPreview(entry: Pick<InboxEntry, "body" | "mention">): string {
  const text = entry.mention ? entry.mention.text : entry.body;
  return text.replace(/\s+/g, " ").trim();
}

export function isInboxMessage(message: Pick<ChatMessage, "role" | "content">): boolean {
  return parseInboxMessage(message) !== null;
}
