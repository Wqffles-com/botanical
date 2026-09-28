"use client";

import type { Agent, ChatMessage } from "@botanical/core";
import { MessageAgentAvatar } from "@/components/chat/message-agent-avatar";
import { Markdown } from "@/components/chat/markdown";
import { ToolCallCard } from "@/components/chat/tool-call-card";
import { agentIdentity } from "@/lib/agent-identity";
import { toolCallsFromMessage, type UiToolCall } from "@/lib/chat-stream";
import { cn } from "@/lib/utils";

export function MessageBubble({
  message,
  agent,
  working,
  queued,
  toolCalls,
}: {
  message: ChatMessage;
  agent?: Agent | null;
  /** Placeholder while the agent is on a turn. Replies arrive whole, so it has no text. */
  working?: boolean;
  /** A sent user message the agent has not picked up yet. */
  queued?: boolean;
  toolCalls?: UiToolCall[];
}) {
  if (message.role === "user") {
    return (
      <article
        className="flex flex-col items-end gap-1"
        data-testid={queued ? "queued-message" : "message"}
        data-role="user"
      >
        <div
          className={cn(
            "max-w-[min(72%,40rem)] rounded-2xl rounded-br-md bg-secondary px-3.5 py-2.5 text-sm leading-relaxed",
            queued && "opacity-70",
          )}
        >
          <div className="whitespace-pre-wrap">{message.content}</div>
        </div>
        {queued ? <span className="text-2xs text-muted-foreground">Queued</span> : null}
      </article>
    );
  }

  const calls = toolCalls ?? toolCallsFromMessage(message);
  const identity = agent ? agentIdentity(agent) : agentIdentity({ name: "Assistant" });

  return (
    <article className="flex gap-3" data-testid={working ? "working-message" : "message"} data-role={message.role}>
      <MessageAgentAvatar agent={identity} />
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="mb-1 text-xs font-medium text-muted-foreground">
          {identity.name}
        </div>
        {/* A step's text comes before the tool calls it makes. */}
        {message.content ? <Markdown>{message.content}</Markdown> : null}
        {calls.map((call) => (
          <ToolCallCard key={call.id || call.name} call={call} />
        ))}
        {working ? (
          <span className="stream-dots text-muted-foreground" aria-hidden>
            <span />
            <span />
            <span />
          </span>
        ) : null}
        {message.usage ? (
          <p className="mt-1 text-2xs text-muted-foreground">
            {message.usage.inputTokens} in · {message.usage.outputTokens} out
          </p>
        ) : null}
      </div>
    </article>
  );
}
