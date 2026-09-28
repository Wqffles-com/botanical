"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { AgentPicker } from "@/components/agents/agent-picker";
import { useWorkspace } from "@/components/workspace-provider";
import { Button } from "@botanical/ui/components/button";
import { pageContainerVariants } from "@botanical/ui/components/page-container";
import { PageHeader } from "@botanical/ui/components/page-header";
import { Skeleton } from "@botanical/ui/components/skeleton";
import { identityFromUnknown } from "@/lib/agent-identity";

export function AgentsIndex() {
  const { ready, agents, error } = useWorkspace();
  const identities = useMemo(() => agents.map((agent) => identityFromUnknown(agent)), [agents]);

  return (
    <div className={pageContainerVariants({ size: "wide", className: "flex min-h-full flex-col gap-6" })}>
      <PageHeader
        title="Agents"
        description="Each agent has a color, an icon, and a name. One agent owns each chat."
        actions={
          <Button nativeButton={false} render={<Link href="/agents/new" />}>
            <Plus />
            New agent
          </Button>
        }
      />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : !ready ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
        </div>
      ) : (
        <AgentPicker agents={identities} showCreate={false} />
      )}
    </div>
  );
}
