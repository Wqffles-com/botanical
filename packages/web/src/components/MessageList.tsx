import type { ChatMessage, ToolCall, TokenUsage } from "@botanical/core";
import { useEffect, useRef } from "react";
import type { StreamingState } from "../state/model";

export function MessageList({
  messages,
  streaming,
}: {
  messages: ChatMessage[];
  streaming: StreamingState | null;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, streaming?.text, streaming?.toolCalls.length]);

  return (
    <div className="bc-messages" data-testid="messages">
      <div className="bc-column">
        {messages.length === 0 && !streaming ? <p className="bc-muted">The thread is empty.</p> : null}
        {messages.map((message) => (
          <MessageView key={message.id} message={message} />
        ))}
        {streaming ? (
          <article className="bc-msg bc-msg--assistant" aria-busy="true" data-testid="streaming-message">
            <header>Assistant</header>
            <p>
              {streaming.text}
              <span className="bc-caret" />
            </p>
            <ToolList calls={streaming.toolCalls} />
            {streaming.usage ? <UsageLine usage={streaming.usage} /> : null}
          </article>
        ) : null}
        <p className="bc-sr" aria-live="polite">
          {streaming ? "Assistant is responding" : ""}
        </p>
        <div ref={endRef} />
      </div>
    </div>
  );
}

function MessageView({ message }: { message: ChatMessage }) {
  return (
    <article className={`bc-msg bc-msg--${message.role}`} data-testid="message" data-role={message.role}>
      <header>{labelFor(message.role)}</header>
      {message.content ? <p>{message.content}</p> : null}
      <ToolList calls={message.toolCalls ?? []} />
      {message.usage ? <UsageLine usage={message.usage} /> : null}
    </article>
  );
}

function ToolList({ calls }: { calls: ToolCall[] }) {
  if (calls.length === 0) return null;
  return (
    <ul className="bc-tools">
      {calls.map((call) => (
        <li key={call.id || call.name}>
          <span>{call.name}</span>
          {formatArgs(call.arguments) ? <code>{formatArgs(call.arguments)}</code> : null}
        </li>
      ))}
    </ul>
  );
}

function UsageLine({ usage }: { usage: TokenUsage }) {
  return (
    <p className="bc-usage">
      {usage.inputTokens} in · {usage.outputTokens} out
    </p>
  );
}

function labelFor(role: ChatMessage["role"]): string {
  if (role === "user") return "You";
  if (role === "assistant") return "Assistant";
  if (role === "tool") return "Tool";
  return "System";
}

function formatArgs(value: unknown): string {
  if (value == null || value === "") return "";
  try {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return text.length > 280 ? `${text.slice(0, 280)}…` : text;
  } catch {
    return "";
  }
}
