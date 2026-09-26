"use client";

import { useMemo } from "react";
import { AgentPicker } from "@/components/agents/agent-picker";
import { useWorkspace } from "@/components/workspace-provider";
import { Skeleton } from "@/components/ui/skeleton";
import { identityFromUnknown } from "@/lib/agent-identity";

export function AgentsIndex() {
  const { ready, agents, error } = useWorkspace();
  const identities = useMemo(() => agents.map((agent) => identityFromUnknown(agent)), [agents]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="p-6">
        <Skeleton className="h-9 w-64" />
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col p-6">
      <div className="mb-4">
        <h1 className="font-heading text-3xl tracking-tight">Agents</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Each agent has a color, an icon, and a name. One agent owns each chat.
        </p>
      </div>
      <AgentPicker agents={identities} />
    </div>
  );
}
