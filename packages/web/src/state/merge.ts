import type { ChatMessage } from "@botanical/core";

/**
 * Prefer the server transcript once it contains the turn we just sent.
 * A stub that streams without persisting leaves the local transcript in place.
 */
export function mergeServerMessages(
  local: ChatMessage[],
  server: ChatMessage[],
  userContent: string,
  assistant: ChatMessage | null,
): ChatMessage[] {
  if (server.length === 0) return local;
  const serverHasUser = server.some((message) => message.role === "user" && message.content === userContent);
  if (!serverHasUser) return local;
  if (!assistant?.content) return server;
  const serverHasAssistant = server.some(
    (message) => message.role === "assistant" && message.content === assistant.content,
  );
  if (serverHasAssistant) return server;
  return [...server, assistant];
}
