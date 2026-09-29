"use client";

import { AtSign, Mail } from "lucide-react";
import Link from "next/link";
import { useWorkspace } from "@/components/workspace-provider";
import { Markdown } from "@/components/chat/markdown";
import { MessageAgentAvatar } from "@/components/chat/message-agent-avatar";
import { agentIdentity } from "@/lib/agent-identity";
import { relativeTime } from "@/lib/format";
import type { InboxEntry } from "@/lib/inbox-message";

/** Mail from other agents, shown as notes from each sender rather than as the human's words. */
export function InboxMessageCard({
  entries,
  recipient,
  toolbar,
}: {
  entries: InboxEntry[];
  /** The agent that received the mail, usually the chat's owner. */
  recipient?: string;
  toolbar?: React.ReactNode;
}) {
  const { agents } = useWorkspace();
  return (
    <article className="group/message flex flex-col gap-2" data-testid="message" data-role="inbox">
      {entries.map((entry) => {
        const sender = agents.find((agent) => agent.id === entry.fromAgentId);
        const identity = agentIdentity(sender ?? { name: entry.fromName });
        const when = new Date(entry.createdAt);
        return (
          <div key={entry.id} className="flex gap-3" data-testid="inbox-entry">
            <div className="shrink-0 self-start">
              <MessageAgentAvatar agent={identity} />
            </div>
            <div className="flex min-w-0 flex-1 flex-col items-start gap-1 pt-0.5">
              <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                {entry.mention ? <AtSign className="size-3" aria-hidden /> : <Mail className="size-3" aria-hidden />}
                <span className="font-medium text-foreground">{identity.name}</span>
                {entry.mention ? (
                  <span>
                    mentioned {recipient || "this agent"} in{" "}
                    <Link href={`/chats/${entry.mention.chatId}`} className="font-medium text-foreground underline-offset-2 hover:underline">
                      {entry.mention.chatTitle || "a chat"}
                    </Link>
                  </span>
                ) : (
                  <span>sent a message</span>
                )}
                {Number.isNaN(when.getTime()) ? null : (
                  <time dateTime={entry.createdAt} title={when.toLocaleString()}>
                    · {relativeTime(entry.createdAt)}
                  </time>
                )}
              </div>
              <div className="min-w-0 max-w-[min(85%,48rem)] rounded-2xl rounded-tl-md border border-dashed bg-muted/40 px-3.5 py-2.5 text-sm leading-relaxed">
                {entry.mention ? (
                  <blockquote className="whitespace-pre-wrap border-l-2 pl-3 text-muted-foreground">
                    {entry.mention.text}
                  </blockquote>
                ) : (
                  <Markdown>{entry.body}</Markdown>
                )}
              </div>
            </div>
          </div>
        );
      })}
      {toolbar ? <div className="ml-9">{toolbar}</div> : null}
    </article>
  );
}
