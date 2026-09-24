"use client";

import { AgentSidebarList } from "@/components/agents/agent-sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { useAgents } from "@/components/agents/use-agents";

export function SidebarAgentRoster({ activeId }: { activeId?: string | null }) {
  const { agents, loading, error } = useAgents();

  if (loading) {
    return (
      <div className="space-y-2 px-3 py-3">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }

  if (error) {
    return <p className="px-3 py-4 text-xs text-muted-foreground">{error}</p>;
  }

  return <AgentSidebarList agents={agents} activeId={activeId} />;
}
