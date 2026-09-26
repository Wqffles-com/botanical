/** Built-in tool id. Sender is the running agent, never a model argument. */
export const SEND_AGENT_MESSAGE_TOOL = "send_agent_message";

/** Dedicated recipient thread. Must match `@botanical/core` `INBOX_CHAT_TITLE`. */
export const INBOX_CHAT_TITLE = "Inbox";

/** Matches the agent-runtime send schema. */
export const A2A_BODY_MAX = 32_000;
