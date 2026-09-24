"use client";

import { BotanicalApiError } from "@botanical/core";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AgentAvatar } from "@/components/agent-avatar";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { useWorkspace } from "@/components/workspace-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { agentIdentity } from "@/lib/agent-identity";
import { relativeTime } from "@/lib/format";

export default function AgentDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { ready, agents, chats, refresh } = useWorkspace();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const agent = agents.find((item) => item.id === params.id) ?? null;
  const identity = agent ? agentIdentity(agent) : null;
  const agentChats = useMemo(
    () => chats.filter((chat) => chat.agentId === params.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [chats, params.id],
  );

  if (!ready) {
    return (
      <div className="p-8">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="mt-6 h-40 w-full" />
      </div>
    );
  }

  if (!agent || !identity) {
    return (
      <EmptyState
        title="Agent not found"
        body="This agent is not in the workspace. Create a new one or pick another from the sidebar."
        action={
          <Button nativeButton={false} render={<Link href="/agents/new" />}>
            New agent
          </Button>
        }
      />
    );
  }

  const agentId = agent.id;

  async function onDelete() {
    setError(null);
    setPending(true);
    try {
      const { api } = await import("@/lib/api");
      await api.deleteAgent(agentId);
      await refresh();
      const next = agents.find((item) => item.id !== agentId);
      router.replace(next ? `/agents/${next.id}` : "/agents/new");
    } catch (cause) {
      setError(cause instanceof BotanicalApiError ? cause.message : "Could not delete the agent.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl p-8">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <AgentAvatar icon={identity.icon} color={identity.color} name={identity.name} size="lg" />
            {identity.name}
          </span>
        }
        description={identity.description || "Prompt and tools. Keys stay on the server."}
        actions={
          <>
            <Button nativeButton={false} render={<Link href={`/agents/${agent.id}?compose=1`} />} variant="outline">
              New chat
            </Button>
            <Button variant="destructive" onClick={() => void onDelete()} disabled={pending}>
              Delete
            </Button>
          </>
        }
      />

      <Card className="mt-8">
        <CardContent className="grid gap-3">
          <h2 className="text-sm font-medium">Prompt</h2>
          <p className="whitespace-pre-wrap font-mono text-[13px] leading-relaxed text-muted-foreground">
            {agent.systemPrompt || "No prompt yet."}
          </p>
          <Separator />
          <p className="text-xs text-muted-foreground">
            Icon, color, and tool allowlist editors land in the identity UI. This page is the shell.
          </p>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </CardContent>
      </Card>

      <section className="mt-8">
        <h2 className="text-sm font-medium">Chats</h2>
        {agentChats.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No chats with this agent yet.</p>
        ) : (
          <ul className="mt-3 divide-y rounded-xl border">
            {agentChats.map((chat) => (
              <li key={chat.id}>
                <Link
                  href={`/chats/${chat.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/50"
                >
                  <span className="truncate text-sm font-medium">{chat.title || "Untitled chat"}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {relativeTime(chat.updatedAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
