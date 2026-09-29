import type { Agent } from "@botanical/core";
import { AgentAvatar, type AgentAvatarSize } from "@/components/agent-avatar";
import { agentIdentity } from "@/lib/agent-identity";
import { cn } from "@/lib/utils";

/** Overlapping marks for a group chat: the first few agents, then a count. */
export function AgentStack({
  agents,
  max = 3,
  size = "sm",
  className,
  ring = "ring-sidebar",
}: {
  agents: Agent[];
  max?: number;
  size?: AgentAvatarSize;
  className?: string;
  /** Ring color that cuts each mark out of the one behind it: the surface the stack sits on. */
  ring?: string;
}) {
  const shown = agents.slice(0, max);
  const extra = agents.length - shown.length;
  return (
    <span className={cn("flex shrink-0 items-center", className)} aria-hidden>
      {shown.map((agent, index) => {
        const identity = agentIdentity(agent);
        return (
          <span
            key={agent.id}
            className={cn("rounded-full ring-2", ring, index > 0 && "-ml-2.5")}
            style={{ zIndex: shown.length - index }}
          >
            <AgentAvatar
              name={identity.name}
              icon={identity.icon}
              color={identity.color}
              shape={identity.shape}
              picture={identity.picture}
              size={size}
            />
          </span>
        );
      })}
      {extra > 0 ? (
        <span
          className={cn(
            "-ml-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1 text-2xs font-medium text-muted-foreground ring-2",
            ring,
          )}
        >
          +{extra}
        </span>
      ) : null}
    </span>
  );
}
