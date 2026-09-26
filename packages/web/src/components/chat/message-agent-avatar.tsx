import { AgentAvatar, type AgentAvatarSize } from "@/components/agent-avatar";
import type { AgentIdentity } from "@/lib/agent-identity";

export function MessageAgentAvatar({
  agent,
  size = "sm",
}: {
  agent?: Pick<AgentIdentity, "name" | "icon" | "color"> | null;
  size?: AgentAvatarSize;
}) {
  return (
    <AgentAvatar
      name={agent?.name ?? "Agent"}
      icon={agent?.icon}
      color={agent?.color}
      size={size}
      className="mt-0.5"
    />
  );
}
