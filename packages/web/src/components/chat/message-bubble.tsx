"use client";

import type { Agent, ChatMessage } from "@botanical/core";
import { MessageAgentAvatar } from "@/components/chat/message-agent-avatar";
import { Markdown } from "@/components/chat/markdown";
import { ToolCallCard } from "@/components/chat/tool-call-card";
import { agentIdentity } from "@/lib/agent-identity";
import { toolCallsFromMessage, type UiToolCall } from "@/lib/chat-stream";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";

const WORKING_VERBS = ["working", "thinking", "synthesizing", "reasoning", "piecing it together", "tinkering"];

/** Rotating placeholder beside the spinning avatar while a turn runs. */
function WorkingStatus({ name }: { name: string }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setIndex((i) => (i + 1) % WORKING_VERBS.length), 2800);
    return () => clearInterval(timer);
  }, []);
  return (
    <span className="text-xs text-muted-foreground" role="status" aria-live="polite">
      <span key={index} className="agent-working-text inline-block">
        {name} is {WORKING_VERBS[index]}…
      </span>
    </span>
  );
}

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

  const hasBody = Boolean(message.content) || calls.length > 0;

  return (
    <article className="flex gap-3" data-testid={working ? "working-message" : "message"} data-role={message.role}>
      <div className={cn("shrink-0 self-start", working && "agent-working-spin")}>
        <MessageAgentAvatar agent={identity} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col items-start gap-1 pt-0.5">
        <div className="text-xs font-medium text-muted-foreground">{identity.name}</div>
        {hasBody ? (
          <div className="min-w-0 max-w-[min(85%,48rem)] rounded-2xl rounded-tl-md border bg-card px-3.5 py-2.5 text-sm leading-relaxed">
            {/* A step's text comes before the tool calls it makes. */}
            {message.content ? <Markdown>{message.content}</Markdown> : null}
            {calls.map((call) => (
              <ToolCallCard key={call.id || call.name} call={call} />
            ))}
          </div>
        ) : null}
        {working ? <WorkingStatus name={identity.name} /> : null}
        {message.usage ? (
          <p className="text-2xs text-muted-foreground">
            {message.usage.inputTokens} in · {message.usage.outputTokens} out
          </p>
        ) : null}
      </div>
    </article>
  );
}
