import { AgentAvatar, type AgentAvatarSize } from "@/components/agent-avatar";
import type { AgentIdentity } from "@/lib/agent-identity";

export function MessageAgentAvatar({
  agent,
  size = "sm",
}: {
  agent?: Partial<Pick<AgentIdentity, "name" | "icon" | "color" | "shape" | "picture">> | null;
  size?: AgentAvatarSize;
}) {
  return (
    <AgentAvatar
      name={agent?.name ?? "Agent"}
      icon={agent?.icon}
      color={agent?.color}
      shape={agent?.shape}
      picture={agent?.picture}
      size={size}
      className="mt-0.5"
    />
  );
}
