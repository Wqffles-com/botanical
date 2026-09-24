import { cn } from "@/lib/utils";
import { agentColorTokens, type AgentColor } from "@/lib/agent-colors";
import { getAgentIcon, type AgentIconName } from "@/lib/agent-icons";

const SIZE = {
  sm: { box: "size-6 rounded-[7px]", icon: "size-3.5" },
  md: { box: "size-8 rounded-[9px]", icon: "size-4" },
  lg: { box: "size-10 rounded-[11px]", icon: "size-5" },
  xl: { box: "size-14 rounded-[14px]", icon: "size-7" },
} as const;

export type AgentAvatarSize = keyof typeof SIZE;

export type AgentAvatarProps = {
  icon?: string | null;
  color?: string | AgentColor | null;
  name?: string;
  size?: AgentAvatarSize;
  className?: string;
};

export function AgentAvatar({
  icon,
  color,
  name,
  size = "md",
  className,
}: AgentAvatarProps) {
  const tokens = agentColorTokens(color);
  const Icon = getAgentIcon(icon);
  const dim = SIZE[size];
  const label = name?.trim() || "Agent";

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]",
        dim.box,
        className,
      )}
      style={{ background: tokens.fill, color: tokens.ink }}
      title={label}
      aria-hidden
    >
      <Icon className={dim.icon} strokeWidth={2.1} />
    </span>
  );
}

export type { AgentIconName, AgentColor };
