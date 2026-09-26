"use client";

import type { Agent, ChatMessage } from "@botanical/core";
import { MessageAgentAvatar } from "@/components/chat/message-agent-avatar";
import { Markdown } from "@/components/chat/markdown";
import { ToolCallCard } from "@/components/chat/tool-call-card";
import { agentIdentity } from "@/lib/agent-identity";
import { toolCallsFromMessage, type UiToolCall } from "@/lib/chat-stream";

export function MessageBubble({
  message,
  agent,
  streaming,
  toolCalls,
}: {
  message: ChatMessage;
  agent?: Agent | null;
  streaming?: boolean;
  toolCalls?: UiToolCall[];
}) {
  if (message.role === "user") {
    return (
      <article className="flex justify-end" data-testid="message" data-role="user">
        <div className="max-w-[min(72%,40rem)] rounded-2xl rounded-br-md bg-secondary px-3.5 py-2.5 text-[14.5px] leading-relaxed">
          <div className="whitespace-pre-wrap">{message.content}</div>
        </div>
      </article>
    );
  }

  const calls = toolCalls ?? toolCallsFromMessage(message);
  const identity = agent ? agentIdentity(agent) : agentIdentity({ name: "Assistant" });

  return (
    <article className="flex gap-3" data-testid={streaming ? "streaming-message" : "message"} data-role={message.role}>
      <MessageAgentAvatar agent={identity} />
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="mb-1 text-[11.5px] font-medium uppercase tracking-wide text-muted-foreground">
          {identity.name}
        </div>
        {calls.map((call) => (
          <ToolCallCard key={call.id || call.name} call={call} />
        ))}
        {message.role === "tool" && message.content ? (
          <ToolCallCard
            call={{ id: message.id, name: "tool", arguments: {}, result: message.content, status: "done" }}
          />
        ) : null}
        {message.content ? <Markdown>{message.content}</Markdown> : null}
        {streaming ? <span className="stream-caret" aria-hidden /> : null}
        {message.usage ? (
          <p className="mt-1 text-[11px] text-muted-foreground">
            {message.usage.inputTokens} in · {message.usage.outputTokens} out
          </p>
        ) : null}
      </div>
    </article>
  );
}
