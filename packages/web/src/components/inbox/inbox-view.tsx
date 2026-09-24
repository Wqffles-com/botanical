"use client";

import { isUnauthorized } from "@botanical/core";
import { ArrowRight, Inbox } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { AgentAvatar } from "@/components/agent-avatar";
import { PageHeader } from "@/components/page-header";
import { useWorkspace } from "@/components/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { agentIdentity } from "@/lib/agent-identity";
import { relativeTime } from "@/lib/format";
import { fetchAgentMessages, patchAgentMessageStatus, sendAgentMessage } from "@/lib/mvp-api";
import { filterMessagesByAgent } from "@/lib/parse";
import type { AgentIdentity, AgentMessage, AgentMessageStatus } from "@/lib/mvp-types";

export function InboxView() {
  const router = useRouter();
  const { agents: workspaceAgents, ready } = useWorkspace();
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const agents: AgentIdentity[] = useMemo(
    () =>
      workspaceAgents.map((agent) => {
        const identity = agentIdentity(agent);
        return {
          id: agent.id,
          name: identity.name,
          description: identity.description,
          icon: identity.icon,
          color: identity.color,
        };
      }),
    [workspaceAgents],
  );

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    fetchAgentMessages(
      "all",
      workspaceAgents.map((agent) => agent.id),
    )
      .then((next) => {
        if (cancelled) return;
        setMessages(next);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (isUnauthorized(err)) {
          router.replace("/login");
          return;
        }
        setError(err instanceof Error ? err.message : "Could not load inbox.");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ready, router, workspaceAgents]);

  const agentMap = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);
  const visible = filterMessagesByAgent(messages, filter);

  async function onFilter(next: string | null) {
    if (!next) return;
    setFilter(next);
    try {
      const nextMessages = await fetchAgentMessages(
        next === "all" ? "all" : next,
        workspaceAgents.map((agent) => agent.id),
      );
      setMessages(nextMessages);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not filter inbox.");
    }
  }

  async function onStatus(id: string, status: AgentMessageStatus) {
    const current = messages.find((message) => message.id === id)?.status;
    try {
      const updated = await patchAgentMessageStatus(id, status, current);
      setMessages((rows) => rows.map((message) => (message.id === id ? updated : message)));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update message.");
    }
  }

  async function onCompose(input: { fromAgentId: string; toAgentId: string; body: string }) {
    const created = await sendAgentMessage(input);
    setMessages((current) => [created, ...current]);
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-10">
      <PageHeader
        title="Inbox"
        description="Async agent-to-agent notes. They never merge into the user thread."
        actions={
          <div className="w-56">
            <Label className="text-xs text-muted-foreground">Filter by agent</Label>
            <Select value={filter} onValueChange={(value) => void onFilter(value)}>
              <SelectTrigger className="mt-1 w-full" aria-label="Filter by agent">
                <SelectValue placeholder="All agents" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All agents</SelectItem>
                {agents.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    {agent.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      />

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <Inbox className="size-4" />
              Messages
              <Badge variant="secondary">{visible.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading || !ready ? (
              <div className="space-y-2">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : visible.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">Inbox is empty.</p>
            ) : (
              <ScrollArea className="h-[min(28rem,60vh)] pr-3">
                <ul className="space-y-2">
                  {visible.map((message) => (
                    <MessageRow
                      key={message.id}
                      message={message}
                      from={agentMap.get(message.fromAgentId)}
                      to={agentMap.get(message.toAgentId)}
                      onStatus={onStatus}
                    />
                  ))}
                </ul>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
        <ComposeCard agents={agents} onSend={onCompose} />
      </div>
    </div>
  );
}

function MessageRow({
  message,
  from,
  to,
  onStatus,
}: {
  message: AgentMessage;
  from?: AgentIdentity;
  to?: AgentIdentity;
  onStatus: (id: string, status: AgentMessageStatus) => Promise<void>;
}) {
  const unread = message.status === "pending" || message.status === "delivered";
  return (
    <li className="rounded-lg border px-3 py-3">
      <div className="flex items-start gap-3">
        <div className="flex items-center gap-1.5">
          <AgentAvatar name={from?.name ?? "Agent"} icon={from?.icon} color={from?.color} size="sm" />
          <ArrowRight className="size-3 text-muted-foreground" />
          <AgentAvatar name={to?.name ?? "Agent"} icon={to?.icon} color={to?.color} size="sm" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-medium">
              {from?.name ?? "Agent"} → {to?.name ?? "Agent"}
            </p>
            <span className="font-mono text-[10.5px] text-muted-foreground">
              {relativeTime(message.createdAt)}
            </span>
          </div>
          <p className="mt-1 whitespace-pre-wrap text-[13px] text-muted-foreground">{message.body}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={message.status} />
            {unread ? (
              <Button variant="ghost" size="sm" onClick={() => void onStatus(message.id, "read")}>
                Mark read
              </Button>
            ) : null}
            {message.status !== "read" && message.status !== "failed" ? (
              <Button variant="ghost" size="sm" onClick={() => void onStatus(message.id, "read")}>
                Done
              </Button>
            ) : null}
          </div>
        </div>
        {unread ? <span className="mt-1.5 size-1.5 rounded-full bg-primary" /> : null}
      </div>
    </li>
  );
}

function StatusBadge({ status }: { status: AgentMessageStatus }) {
  const variant =
    status === "failed" ? "destructive" : status === "read" ? "secondary" : "default";
  return <Badge variant={variant}>{status}</Badge>;
}

function ComposeCard({
  agents,
  onSend,
}: {
  agents: AgentIdentity[];
  onSend: (input: { fromAgentId: string; toAgentId: string; body: string }) => Promise<void>;
}) {
  const [fromAgentId, setFromAgentId] = useState<string>("");
  const [toAgentId, setToAgentId] = useState<string>("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!fromAgentId && agents[0]) setFromAgentId(agents[0].id);
    if (!toAgentId && agents[1]) setToAgentId(agents[1].id);
    else if (!toAgentId && agents[0] && agents[0].id !== fromAgentId) setToAgentId(agents[0].id);
  }, [agents, fromAgentId, toAgentId]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const text = body.trim();
    if (!fromAgentId || !toAgentId) {
      setError("Pick a sender and a recipient.");
      return;
    }
    if (fromAgentId === toAgentId) {
      setError("Pick two different agents.");
      return;
    }
    if (!text) {
      setError("Write a message.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await onSend({ fromAgentId, toAgentId, body: text });
      setBody("");
      toast.success("Message sent.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send.");
    } finally {
      setBusy(false);
    }
  }

  const recipients = agents.filter((agent) => agent.id !== fromAgentId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Compose</CardTitle>
        <CardDescription>Send a note from one agent to another.</CardDescription>
      </CardHeader>
      <CardContent>
        {agents.length < 2 ? (
          <p className="text-sm text-muted-foreground">Create at least two agents before sending mail.</p>
        ) : (
          <form className="space-y-3" onSubmit={(event) => void onSubmit(event)}>
            <div>
              <Label>From</Label>
              <Select value={fromAgentId || null} onValueChange={(value) => value && setFromAgentId(value)}>
                <SelectTrigger className="mt-1 w-full" aria-label="From agent">
                  <SelectValue placeholder="Sender" />
                </SelectTrigger>
                <SelectContent>
                  {agents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>To</Label>
              <Select value={toAgentId || null} onValueChange={(value) => value && setToAgentId(value)}>
                <SelectTrigger className="mt-1 w-full" aria-label="To agent">
                  <SelectValue placeholder="Recipient" />
                </SelectTrigger>
                <SelectContent>
                  {recipients.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="a2a-body">Message</Label>
              <Textarea
                id="a2a-body"
                className="mt-1"
                rows={5}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder="What should the other agent know?"
              />
            </div>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Sending…" : "Send"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
