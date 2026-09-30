"use client";

import { AtSign, ChevronRight, Mail } from "lucide-react";
import { useState } from "react";
import { useWorkspace } from "@/components/workspace-provider";
import { AgentConversationDialog, type AgentConversationTarget } from "@/components/chat/agent-conversation-dialog";
import { MessageAgentAvatar } from "@/components/chat/message-agent-avatar";
import { agentIdentity } from "@/lib/agent-identity";
import { relativeTime } from "@/lib/format";
import { inboxPreview, type InboxEntry } from "@/lib/inbox-message";

/**
 * Mail from other agents, collapsed to one row per message so it does not crowd the human's chat.
 * A row opens every message between the sender and the recipient.
 */
export function InboxMessageCard({
  entries,
  recipient,
  toolbar,
}: {
  entries: InboxEntry[];
  /** The agent that received the mail, usually the chat's owner. */
  recipient?: { id: string; name: string } | null;
  toolbar?: React.ReactNode;
}) {
  const { agents } = useWorkspace();
  const [open, setOpen] = useState<AgentConversationTarget | null>(null);
  return (
    <article className="group/message flex flex-col gap-1.5" data-testid="message" data-role="inbox">
      {entries.map((entry) => {
        const sender = agents.find((agent) => agent.id === entry.fromAgentId);
        const identity = agentIdentity(sender ?? { name: entry.fromName });
        const when = new Date(entry.createdAt);
        return (
          <button
            key={entry.id}
            type="button"
            data-testid="inbox-entry"
            onClick={() =>
              setOpen({
                fromAgentId: entry.fromAgentId,
                fromName: identity.name,
                ...(recipient ? { toAgentId: recipient.id, toName: recipient.name } : {}),
                messageId: entry.id,
              })
            }
            className="flex w-full min-w-0 max-w-[min(85%,48rem)] items-center gap-2.5 rounded-2xl border border-dashed bg-muted/40 px-2.5 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <MessageAgentAvatar agent={identity} />
            {entry.mention ? <AtSign className="size-3 shrink-0" aria-hidden /> : <Mail className="size-3 shrink-0" aria-hidden />}
            <span className="shrink-0 font-medium text-foreground">{identity.name}</span>
            <span className="shrink-0">
              {entry.mention ? `mentioned ${recipient?.name || "this agent"}` : "sent a message"}
            </span>
            <span className="min-w-0 flex-1 truncate">{inboxPreview(entry)}</span>
            {Number.isNaN(when.getTime()) ? null : (
              <time className="shrink-0" dateTime={entry.createdAt} title={when.toLocaleString()}>
                {relativeTime(entry.createdAt)}
              </time>
            )}
            <ChevronRight className="size-3.5 shrink-0" aria-hidden />
          </button>
        );
      })}
      {toolbar ? <div className="ml-9">{toolbar}</div> : null}
      <AgentConversationDialog target={open} onClose={() => setOpen(null)} />
    </article>
  );
}
