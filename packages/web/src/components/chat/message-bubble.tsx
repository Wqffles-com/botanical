"use client";

import type { Agent, ChatMessage } from "@botanical/core";
import { useState } from "react";
import { Button } from "@botanical/ui/components/button";
import { Textarea } from "@botanical/ui/components/textarea";
import { MessageActions, type MessageActionHandlers } from "@/components/chat/message-actions";
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
        align={message.role === "user" ? "end" : "start"}
        onStartEdit={canEdit ? () => setEditing(true) : undefined}
      />
    ) : null;

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

  return (
    <article className="group/message flex gap-3" data-testid={working ? "working-message" : "message"} data-role={message.role}>
      <MessageAgentAvatar agent={identity} />
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="mb-1 text-xs font-medium text-muted-foreground">
          {identity.name}
        </div>
        {/* A step's text comes before the tool calls it makes. */}
        {editor ?? (message.content ? <Markdown>{message.content}</Markdown> : null)}
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
