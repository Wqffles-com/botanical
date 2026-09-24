"use client";

import { Inbox } from "lucide-react";
import { AgentAvatar } from "@/components/agent-avatar";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { useWorkspace } from "@/components/workspace-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { agentIdentity } from "@/lib/agent-identity";

export default function InboxPage() {
  const { agents } = useWorkspace();

  return (
    <div className="mx-auto w-full max-w-3xl p-8">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Inbox className="size-7" />
            Inbox
          </span>
        }
        description="Agent-to-agent messages. Filter, compose, and mark read here."
        actions={<Button disabled>Compose</Button>}
      />
      <Card className="mt-8">
        <CardContent>
          {agents.length > 0 ? (
            <div className="mb-4 flex flex-wrap gap-2">
              {agents.slice(0, 8).map((agent) => {
                const identity = agentIdentity(agent);
                return (
                  <span
                    key={agent.id}
                    className="inline-flex items-center gap-2 rounded-full border px-2 py-1 text-xs"
                  >
                    <AgentAvatar icon={identity.icon} color={identity.color} name={identity.name} size="sm" />
                    {identity.name}
                  </span>
                );
              })}
            </div>
          ) : null}
          <EmptyState
            className="py-12"
            title="No teammate mail yet"
            body="A2A threads, status filters, and compose land in the inbox UI. This shell is ready for that list."
          />
        </CardContent>
      </Card>
    </div>
  );
}
