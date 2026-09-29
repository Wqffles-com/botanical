import type { ChatMessage } from "@botanical/core";

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
    const mention = MENTION.exec(last.body);
    if (mention) last.mention = { chatTitle: mention[1]!, chatId: mention[2]!, text: mention[3]!.trim() };
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

export function isInboxMessage(message: Pick<ChatMessage, "role" | "content">): boolean {
  return parseInboxMessage(message) !== null;
}
