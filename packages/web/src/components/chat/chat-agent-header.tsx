import type { ReactNode } from "react";
import Link from "next/link";
import { AgentAvatar } from "@/components/agent-avatar";
import type { AgentIdentity } from "@/lib/agent-identity";
import { cn } from "@/lib/utils";

export function ChatAgentHeader({
  agent,
  title,
  trailing,
  className,
}: {
  agent: AgentIdentity | null | undefined;
  title?: string;
  trailing?: ReactNode;
  className?: string;
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
    <header className={cn("flex h-12 shrink-0 items-center gap-3 border-b px-4", className)}>
      <Link
        href={`/agents/${encodeURIComponent(agent.id)}`}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md py-1 hover:opacity-90"
      >
        <AgentAvatar name={agent.name} icon={agent.icon} color={agent.color} />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{title ?? agent.name}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {agent.name}
            {agent.description ? ` · ${agent.description}` : " · one agent per chat"}
          </span>
        </span>
      </Link>
      {trailing}
    </header>
  );
}
