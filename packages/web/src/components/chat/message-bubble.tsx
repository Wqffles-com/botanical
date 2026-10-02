"use client";

import { isImageType, splitAttachments, withAttachments, type Agent, type AttachmentRef, type ChatMessage } from "@botanical/core";
import { FileText } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@botanical/ui/components/button";
import { Textarea } from "@botanical/ui/components/textarea";
import { MessageActions, type MessageActionHandlers } from "@/components/chat/message-actions";
import { InboxMessageCard } from "@/components/chat/inbox-message-card";
import { MessageAgentAvatar } from "@/components/chat/message-agent-avatar";
import { Markdown } from "@/components/chat/markdown";
import { ToolCallCard } from "@/components/chat/tool-call-card";
import { api } from "@/lib/api";
import { formatBytes } from "@/lib/attachments";
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
  showName,
  continued,
  uploadAgentId,
}: {
  message: ChatMessage;
  agent?: Agent | null;
  /** Label replies with the agent's name (group chats, where several agents answer). */
  showName?: boolean;
  /** Follows a reply from the same agent: no avatar or name, so a run reads as one turn. */
  continued?: boolean;
  /** Placeholder while the agent is on a turn. Replies arrive whole, so it has no text. */
  working?: boolean;
  /** A sent user message the agent has not picked up yet. */
  queued?: boolean;
  toolCalls?: UiToolCall[];
  /** Copy, edit, retry, and delete. Only stored messages get them. */
  actions?: MessageActionHandlers;
  /** The agent whose workspace holds this message's attachments. */
  uploadAgentId?: string;
}) {
  const [editing, setEditing] = useState(false);
  const inbox = parseInboxMessage(message);
  // Attachments are listed at the end of the text. The bubble shows them as thumbnails and chips instead.
  const { text: bodyText, files } = message.role === "user" ? splitAttachments(message.content) : { text: message.content, files: [] };
  // A user message is resent with the new text. A reply is corrected in place.
  const save = message.role === "user" ? actions?.onResend : actions?.onEdit;
  const canEdit = Boolean(save && message.content && !actions?.disabled);
  const editor =
    editing && save ? (
      <MessageEditor
        initial={bodyText}
        saveLabel={message.role === "user" ? "Send" : "Save"}
        onCancel={() => setEditing(false)}
        onSave={async (content) => {
          const ok = await save(withAttachments(content, files));
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
    return <InboxMessageCard entries={inbox} recipient={agent ? { id: agent.id, name: agent.name } : null} toolbar={actions ? toolbar : null} />;
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
              "max-w-[min(80%,40rem)] rounded-3xl bg-bubble-user px-4 py-2.5 text-sm leading-relaxed",
              queued && "opacity-70",
            )}
          >
            {files.length > 0 ? <AttachmentList files={files} agentId={uploadAgentId ?? agent?.id} /> : null}
            {bodyText ? <div className="whitespace-pre-wrap">{bodyText}</div> : null}
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
      <div className={cn("w-6 shrink-0 self-start", working && "agent-working-spin")}>
        {continued && !working ? null : <MessageAgentAvatar agent={identity} />}
      </div>
      <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
        {showName && !continued ? (
          <div className="pt-1 text-xs font-medium text-muted-foreground">{identity.name}</div>
        ) : null}
        {editor ?? (hasBody ? (
          <div className="min-w-0 max-w-[min(92%,48rem)] rounded-3xl rounded-tl-lg bg-bubble px-4 py-2.5 text-sm leading-relaxed">
            {/* A step's text comes before the tool calls it makes. */}
            {message.content ? <Markdown>{message.content}</Markdown> : null}
            {calls.map((call) => (
              <ToolCallCard key={call.id || call.name} call={call} />
            ))}
          </div>
        ) : null)}
        {working ? (
          <div className="flex h-7 items-center">
            <WorkingStatus name={identity.name} />
          </div>
        ) : null}
        {toolbar || message.usage ? (
          <div className="flex items-center gap-2">
            {toolbar}
            {message.usage ? (
              <span className="text-2xs text-muted-foreground opacity-0 transition-opacity group-hover/message:opacity-100 pointer-coarse:opacity-100">
                {message.usage.inputTokens} in · {message.usage.outputTokens} out
              </span>
            ) : null}
          </div>
        ) : null}
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

/** Image thumbnails and file chips on a user's message. */
function AttachmentList({ files, agentId }: { files: AttachmentRef[]; agentId?: string }) {
  return (
    <ul className="mb-2 flex flex-wrap gap-2 last:mb-0" data-testid="message-attachments">
      {files.map((file) => {
        const href = agentId ? api.agentUploadUrl(agentId, file.path) : null;
        if (href && isImageType(file.mimeType)) {
          return (
            <li key={file.path}>
              <a href={href} target="_blank" rel="noreferrer" title={file.name}>
                {/* eslint-disable-next-line @next/next/no-img-element -- an authenticated API route, not a static asset */}
                <img src={href} alt={file.name} className="max-h-48 max-w-full rounded-xl object-cover" />
              </a>
            </li>
          );
        }
        const chip = (
          <>
            <FileText className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{file.name}</span>
            <span className="shrink-0 text-2xs text-muted-foreground">{formatBytes(file.size)}</span>
          </>
        );
        const className = "flex max-w-56 items-center gap-2 rounded-xl bg-background/60 px-3 py-2 text-xs";
        return (
          <li key={file.path}>
            {href ? (
              <a href={href} download={file.name} className={className}>
                {chip}
              </a>
            ) : (
              <span className={className}>{chip}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
