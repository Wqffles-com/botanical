"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";
import { AgentAvatar } from "@/components/agent-avatar";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { AgentIdentity } from "@/lib/agent-identity";
import { cn } from "@/lib/utils";

export function AgentSidebarList({
  agents,
  activeId,
}: {
  agents: AgentIdentity[];
  activeId?: string | null;
}) {
  const pathname = usePathname();
  const current = activeId ?? pathname.split("/")[2];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Agents</span>
        <Button
          nativeButton={false}
          render={<Link href="/agents/new" />}
          size="icon-xs"
          variant="ghost"
          aria-label="New agent"
        >
          <Plus className="size-3.5" />
        </Button>
      </div>
      <ScrollArea className="flex-1 px-2 pb-3">
        {agents.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">No agents yet.</p>
        ) : (
          <nav className="grid gap-0.5" aria-label="Agents">
            {agents.map((agent) => {
              const href = `/agents/${encodeURIComponent(agent.id)}`;
              const active = agent.id === current;
              return (
                <Link
                  key={agent.id}
                  href={href}
                  className={cn(
                    "flex items-start gap-2.5 rounded-md px-2 py-2 text-left hover:bg-accent/70",
                    active && "bg-accent",
                  )}
                >
                  <AgentAvatar name={agent.name} icon={agent.icon} color={agent.color} size="sm" />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium">{agent.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {agent.description || "No description"}
                    </span>
                  </span>
                </Link>
              );
            })}
          </nav>
        )}
      </ScrollArea>
    </div>
  );
}

export function AgentSidebarChip({ agent }: { agent: AgentIdentity }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <AgentAvatar name={agent.name} icon={agent.icon} color={agent.color} size="sm" />
      <span className="truncate text-sm font-medium">{agent.name}</span>
    </span>
  );
}
