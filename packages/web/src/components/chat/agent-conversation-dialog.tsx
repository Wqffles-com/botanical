"use client";

import { AtSign, Mail } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@botanical/ui/components/dialog";
import { EmptyState } from "@botanical/ui/components/empty-state";
import { Skeleton } from "@botanical/ui/components/skeleton";
import { useWorkspace } from "@/components/workspace-provider";
import { Markdown } from "@/components/chat/markdown";
import { MessageAgentAvatar } from "@/components/chat/message-agent-avatar";
import { agentIdentity } from "@/lib/agent-identity";
import { relativeTime } from "@/lib/format";
import { conversationBetween, parseMention } from "@/lib/inbox-message";
import { fetchAgentMessages } from "@/lib/mvp-api";
import type { AgentMessage } from "@/lib/mvp-types";
import { cn } from "@/lib/utils";

export interface AgentConversationTarget {
  /** The agent that sent the clicked message. */
  fromAgentId: string;
  fromName: string;
  /** The agent that received it; unknown when the chat has no owner. */
  toAgentId?: string;
  toName?: string;
  /** The clicked message, scrolled into view and marked. */
  messageId: string;
}

/** Every message between two agents, in a dialog shaped like settings. */
export function AgentConversationDialog({
  target,
  onClose,
}: {
  target: AgentConversationTarget | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        data-testid="agent-conversation-dialog"
        className="flex h-[min(88svh,760px)] flex-col gap-0 overflow-hidden rounded-2xl bg-background p-0 sm:max-w-3xl"
      >
        {target ? (
          <Conversation key={`${target.fromAgentId}:${target.toAgentId ?? ""}`} target={target} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Conversation({ target }: { target: AgentConversationTarget }) {
  const { agents } = useWorkspace();
  const [messages, setMessages] = useState<AgentMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selected = useRef<HTMLDivElement | null>(null);

  const { fromAgentId, toAgentId, messageId } = target;
  useEffect(() => {
    let cancelled = false;
    const ids = toAgentId ? [fromAgentId, toAgentId] : [fromAgentId];
    fetchAgentMessages(undefined, ids)
      .then((listed) => {
        if (cancelled) return;
        setMessages(
          toAgentId
            ? conversationBetween(listed, fromAgentId, toAgentId)
            : listed.filter((message) => message.fromAgentId === fromAgentId).reverse(),
        );
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load messages.");
      });
    return () => {
      cancelled = true;
    };
  }, [fromAgentId, toAgentId]);

  useEffect(() => {
    selected.current?.scrollIntoView({ block: "center" });
  }, [messages, messageId]);

  const identityOf = (id: string, fallback: string) =>
    agentIdentity(agents.find((agent) => agent.id === id) ?? { name: fallback });
  const from = identityOf(fromAgentId, target.fromName);
  const to = toAgentId ? identityOf(toAgentId, target.toName ?? "Agent") : null;

  return (
    <>
      <div className="flex shrink-0 items-center gap-3 border-b px-5 py-4 pr-12">
        <div className="flex -space-x-1.5">
          <MessageAgentAvatar agent={from} size="md" />
          {to ? <MessageAgentAvatar agent={to} size="md" /> : null}
        </div>
        <div className="min-w-0">
          <DialogTitle className="truncate text-lg font-semibold">
            {to ? `${from.name} and ${to.name}` : `Messages from ${from.name}`}
          </DialogTitle>
          <DialogDescription className="mt-1 text-xs">
            Mail the agents sent each other, oldest first. The human user did not write these.
          </DialogDescription>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4" data-testid="agent-conversation">
        {error ? (
          <EmptyState icon={Mail} title="Could not load messages" body={error} />
        ) : messages === null ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-16 w-2/3" />
            <Skeleton className="ml-auto h-16 w-2/3" />
            <Skeleton className="h-16 w-1/2" />
          </div>
        ) : messages.length === 0 ? (
          <EmptyState icon={Mail} title="No messages" body="These agents have no mail between them yet." />
        ) : (
          <div className="flex flex-col gap-4">
            {messages.map((message) => {
              const sender = message.fromAgentId === fromAgentId ? from : (to ?? identityOf(message.fromAgentId, "Agent"));
              // The receiving agent's replies sit on the right, like the human's side of a chat.
              const outgoing = Boolean(to) && message.fromAgentId === toAgentId;
              const isSelected = message.id === messageId;
              return (
                <div
                  key={message.id}
                  ref={isSelected ? selected : undefined}
                  data-testid="agent-conversation-message"
                  data-selected={isSelected || undefined}
                  className={cn("flex gap-3", outgoing && "flex-row-reverse")}
                >
                  <div className="shrink-0 self-start">
                    <MessageAgentAvatar agent={sender} />
                  </div>
                  <div className={cn("flex min-w-0 flex-1 flex-col gap-1 pt-0.5", outgoing ? "items-end" : "items-start")}>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{sender.name}</span>
                      <time dateTime={message.createdAt} title={new Date(message.createdAt).toLocaleString()}>
                        · {relativeTime(message.createdAt)}
                      </time>
                    </div>
                    <div
                      className={cn(
                        "min-w-0 max-w-[min(85%,40rem)] rounded-2xl border border-dashed bg-muted/40 px-3.5 py-2.5 text-sm leading-relaxed",
                        outgoing ? "rounded-tr-md" : "rounded-tl-md",
                        isSelected && "border-solid border-ring",
                      )}
                    >
                      <MailBody body={message.body} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

function MailBody({ body }: { body: string }) {
  const mention = parseMention(body);
  if (!mention) return <Markdown>{body}</Markdown>;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <AtSign className="size-3" aria-hidden />
        <span>
          Mentioned in{" "}
          <Link href={`/chats/${mention.chatId}`} className="font-medium text-foreground underline-offset-2 hover:underline">
            {mention.chatTitle || "a chat"}
          </Link>
        </span>
      </div>
      <blockquote className="whitespace-pre-wrap border-l-2 pl-3 text-muted-foreground">{mention.text}</blockquote>
    </div>
  );
}
