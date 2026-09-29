"use client";

import type { Agent, ChatMessage } from "@botanical/core";
import { useEffect, useState } from "react";
import { Button } from "@botanical/ui/components/button";
import { Textarea } from "@botanical/ui/components/textarea";
import { MessageActions, type MessageActionHandlers } from "@/components/chat/message-actions";
import { InboxMessageCard } from "@/components/chat/inbox-message-card";
import { MessageAgentAvatar } from "@/components/chat/message-agent-avatar";
import { Markdown } from "@/components/chat/markdown";
import { ToolCallCard } from "@/components/chat/tool-call-card";
import { agentIdentity } from "@/lib/agent-identity";
import { parseInboxMessage } from "@/lib/inbox-message";
import { toolCallsFromMessage, type UiToolCall } from "@/lib/chat-stream";
import { cn } from "@/lib/utils";

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
  actions,
}: {
  message: ChatMessage;
  agent?: Agent | null;
  /** Placeholder while the agent is on a turn. Replies arrive whole, so it has no text. */
  working?: boolean;
  /** A sent user message the agent has not picked up yet. */
  queued?: boolean;
  toolCalls?: UiToolCall[];
  /** Copy, edit, retry, and delete. Only stored messages get them. */
  actions?: MessageActionHandlers;
}) {
  const [editing, setEditing] = useState(false);
  const inbox = parseInboxMessage(message);
  // A user message is resent with the new text. A reply is corrected in place.
  const save = message.role === "user" ? actions?.onResend : actions?.onEdit;
  const canEdit = Boolean(save && message.content && !actions?.disabled);
  const editor =
    editing && save ? (
      <MessageEditor
        initial={message.content}
        saveLabel={message.role === "user" ? "Send" : "Save"}
        onCancel={() => setEditing(false)}
        onSave={async (content) => {
          const ok = await save(content);
          if (ok) setEditing(false);
        }}
      />
    ) : null;
  const toolbar =
    actions && !editing ? (
      <MessageActions
        content={message.content}
        actions={actions}
        align={message.role === "user" && !inbox ? "end" : "start"}
        onStartEdit={canEdit ? () => setEditing(true) : undefined}
      />
    ) : null;

  if (inbox) {
    return <InboxMessageCard entries={inbox} recipient={agent?.name} toolbar={actions ? toolbar : null} />;
  }

  if (message.role === "user") {
    return (
      <article
        className="group/message flex flex-col items-end gap-1"
        data-testid={queued ? "queued-message" : "message"}
        data-role="user"
      >
        {editor ?? (
          <div
            className={cn(
              "max-w-[min(72%,40rem)] rounded-2xl rounded-br-md bg-secondary px-3.5 py-2.5 text-sm leading-relaxed",
              queued && "opacity-70",
            )}
          >
            <div className="whitespace-pre-wrap">{message.content}</div>
          </div>
        )}
        {toolbar}
        {queued ? <span className="text-2xs text-muted-foreground">Queued</span> : null}
      </article>
    );
  }

  const calls = toolCalls ?? toolCallsFromMessage(message);
  const identity = agent ? agentIdentity(agent) : agentIdentity({ name: "Assistant" });

  const hasBody = Boolean(message.content) || calls.length > 0;

  return (
    <article className="group/message flex gap-3" data-testid={working ? "working-message" : "message"} data-role={message.role}>
      <div className={cn("shrink-0 self-start", working && "agent-working-spin")}>
        <MessageAgentAvatar agent={identity} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col items-start gap-1 pt-0.5">
        <div className="text-xs font-medium text-muted-foreground">{identity.name}</div>
        {editor ?? (hasBody ? (
          <div className="min-w-0 max-w-[min(85%,48rem)] rounded-2xl rounded-tl-md border bg-card px-3.5 py-2.5 text-sm leading-relaxed">
            {/* A step's text comes before the tool calls it makes. */}
            {message.content ? <Markdown>{message.content}</Markdown> : null}
            {calls.map((call) => (
              <ToolCallCard key={call.id || call.name} call={call} />
            ))}
          </div>
        ) : null)}
        {working ? <WorkingStatus name={identity.name} /> : null}
        {message.usage ? (
          <p className="text-2xs text-muted-foreground">
            {message.usage.inputTokens} in · {message.usage.outputTokens} out
          </p>
        ) : null}
        {toolbar ? <div className="mt-1">{toolbar}</div> : null}
      </div>
    </article>
  );
}

function MessageEditor({
  initial,
  saveLabel,
  onCancel,
  onSave,
}: {
  initial: string;
  saveLabel: string;
  onCancel: () => void;
  onSave: (content: string) => Promise<void>;
}) {
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const text = value.trim();
  const submit = async () => {
    if (!text || saving) return;
    setSaving(true);
    try {
      await onSave(text);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="flex w-full max-w-[min(100%,40rem)] flex-col gap-2" data-testid="message-editor">
      <Textarea
        autoFocus
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void submit();
          }
        }}
        aria-label="Edit message"
        className="min-h-20 text-sm"
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={() => void submit()} disabled={!text || saving || text === initial.trim()}>
          {saveLabel}
        </Button>
      </div>
    </div>
  );
}
