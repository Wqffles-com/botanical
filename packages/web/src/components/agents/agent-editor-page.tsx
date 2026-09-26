"use client";

import { useEffect, useMemo, useState } from "react";
import { AgentForm } from "@/components/agents/agent-form";
import { useWorkspace } from "@/components/workspace-provider";
import { Skeleton } from "@/components/ui/skeleton";
import { listProfiles, listTools } from "@/lib/agent-api";
import { identityFromUnknown, type ProfileInfo, type ToolInfo } from "@/lib/agent-identity";

export function AgentEditorPage({ agentId }: { agentId?: string }) {
  const { ready, agents, error } = useWorkspace();
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [toolsLoading, setToolsLoading] = useState(true);

  const agent = useMemo(() => {
    if (!agentId) return null;
    const found = agents.find((item) => item.id === agentId);
    return found ? identityFromUnknown(found) : null;
  }, [agentId, agents]);

  useEffect(() => {
    let cancelled = false;
    setToolsLoading(true);
    Promise.all([listTools().catch(() => []), listProfiles().catch(() => [])])
      .then(([nextTools, nextProfiles]) => {
        if (cancelled) return;
        setTools(nextTools);
        setProfiles(nextProfiles);
      })
      .finally(() => {
        if (!cancelled) setToolsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (!ready || (agentId && !agent && agents.length === 0)) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-4 px-6 py-8">
        <Skeleton className="size-14 rounded-xl" />
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (agentId && !agent) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <p className="text-sm text-muted-foreground">Agent not found.</p>
      </div>
    );
  }

  return <AgentForm agent={agent} tools={tools} profiles={profiles} toolsLoading={toolsLoading} />;
}
