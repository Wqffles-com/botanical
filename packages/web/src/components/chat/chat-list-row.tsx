import Link from "next/link";
import { AgentAvatar } from "@/components/agent-avatar";
import type { AgentIdentity } from "@/lib/agent-identity";
import { cn } from "@/lib/utils";

export function ChatListRow({
  href,
  title,
  preview,
  active,
  agent,
  timestamp,
}: {
  href: string;
  title: string;
  preview?: string;
  active?: boolean;
  agent?: Pick<AgentIdentity, "name" | "icon" | "color"> | null;
  timestamp?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-start gap-2.5 rounded-md px-2 py-2 hover:bg-accent/70",
        active && "bg-accent",
      )}
    >
      <AgentAvatar
        name={agent?.name ?? title}
        icon={agent?.icon}
        color={agent?.color}
        size="sm"
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[13px] font-medium">{title}</span>
          {timestamp ? (
            <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">{timestamp}</span>
          ) : null}
        </span>
        {preview ? (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{preview}</span>
        ) : agent?.name ? (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{agent.name}</span>
        ) : null}
      </span>
    </Link>
  );
}
