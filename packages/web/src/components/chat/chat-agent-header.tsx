import type { Agent } from "@botanical/core";
import type { ReactNode } from "react";
import Link from "next/link";
import { AgentAvatar } from "@/components/agent-avatar";
import { RoleBadges } from "@/components/role-badges";
import type { AgentIdentity } from "@/lib/agent-identity";
import { cn } from "@/lib/utils";

export function ChatAgentHeader({
  agent,
  title,
  trailing,
  className,
  creator,
}: {
  agent: AgentIdentity | null | undefined;
  title?: string;
  trailing?: ReactNode;
  className?: string;
  creator?: Agent | null;
}) {
  if (!agent) {
    return (
      <header className={cn("flex h-12 shrink-0 items-center gap-3 border-b px-4", className)}>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{title ?? "Chat"}</div>
          <div className="truncate text-xs text-muted-foreground">Pick an agent to start</div>
        </div>
        {trailing}
      </header>
    );
  }

  return (
    <header className={cn("flex min-h-12 shrink-0 items-center gap-3 border-b px-4 py-2", className)}>
      <div className="flex min-w-0 flex-1 items-center gap-2.5 py-1">
        <Link href={`/agents/${encodeURIComponent(agent.id)}`} className="shrink-0 rounded-md hover:opacity-90">
          <AgentAvatar name={agent.name} icon={agent.icon} color={agent.color} />
        </Link>
        <span className="min-w-0">
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <Link
              href={`/agents/${encodeURIComponent(agent.id)}`}
              className="truncate text-sm font-medium hover:underline"
            >
              {title ?? agent.name}
            </Link>
            <RoleBadges roles={agent.roles} />
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {agent.name}
            {agent.description ? ` · ${agent.description}` : ""}
            {agent.createdByAgentId ? (
              <>
                {" · Created by "}
                <Link
                  href={`/agents/${encodeURIComponent(agent.createdByAgentId)}`}
                  className="underline-offset-2 hover:underline"
                >
                  {creator?.name ?? "another agent"}
                </Link>
              </>
            ) : null}
          </span>
        </span>
      </div>
      {trailing}
    </header>
  );
}
