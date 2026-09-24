import { cn } from "@/lib/utils";
import { AGENT_COLOR_CLASSES, agentColorOf, type AgentColor } from "@/lib/agent-colors";
import { agentIconOf } from "@/lib/agent-icons";

export function AgentAvatar({
  name,
  icon,
  color,
  size = "md",
  className,
}: {
  name: string;
  icon?: string | null;
  color?: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const tone: AgentColor = agentColorOf(color);
  const Icon = agentIconOf(icon);
  const dim = size === "sm" ? "size-6" : size === "lg" ? "size-10" : "size-8";
  const iconSize = size === "sm" ? "size-3.5" : size === "lg" ? "size-5" : "size-4";
  const classes = AGENT_COLOR_CLASSES[tone];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md ring-1 ring-inset",
        dim,
        classes.bg,
        classes.fg,
        classes.ring,
        className,
      )}
      title={name}
      aria-hidden
    >
      <Icon className={iconSize} />
    </span>
  );
}
