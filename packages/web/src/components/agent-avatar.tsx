import { createElement } from "react";
import type { AgentShape } from "@botanical/core";
import { cn } from "@/lib/utils";
import { agentColorTokens, resolveAgentColor, type AgentColor } from "@/lib/agent-colors";
import { AGENT_ICONS, resolveAgentIconName, type AgentIconName } from "@/lib/agent-icons";
import { resolveAgentPicture, resolveAgentShape } from "@/lib/agent-identity";

const SIZE = {
  sm: { box: "size-6 rounded-sm", icon: "size-3.5" },
  md: { box: "size-8 rounded-md", icon: "size-4" },
  lg: { box: "size-10 rounded-lg", icon: "size-5" },
  xl: { box: "size-14 rounded-xl", icon: "size-7" },
} as const;

/** Clip the colored mark. A picture replaces the silhouette. */
const CLIP: Partial<Record<AgentShape, string>> = {
  hexagon: "polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%)",
  diamond: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)",
  shield: "polygon(50% 0%, 100% 16%, 86% 70%, 50% 100%, 14% 70%, 0% 16%)",
};

function shapeStyle(shape: AgentShape, photo: boolean): { className: string; style: { borderRadius?: number | string; clipPath?: string } } {
  if (photo) return { className: "", style: {} };
  if (shape === "circle") return { className: "rounded-full", style: { borderRadius: 9999 } };
  if (shape === "square") return { className: "rounded-none", style: { borderRadius: 0 } };
  const clip = CLIP[shape];
  if (clip) return { className: "rounded-none", style: { borderRadius: 0, clipPath: clip } };
  return { className: "", style: {} };
}

const CLIPPED: ReadonlySet<AgentShape> = new Set(["hexagon", "diamond", "shield"]);

export type AgentAvatarSize = keyof typeof SIZE;

export type AgentAvatarProps = {
  icon?: string | null;
  color?: string | AgentColor | null;
  shape?: string | AgentShape | null;
  picture?: string | null;
  name?: string;
  size?: AgentAvatarSize;
  className?: string;
};

export function AgentAvatar({
  icon,
  color,
  shape,
  picture,
  name,
  size = "md",
  className,
}: AgentAvatarProps) {
  const tokens = agentColorTokens(color);
  const iconName = resolveAgentIconName(icon);
  const silhouette = resolveAgentShape(shape);
  const photo = resolveAgentPicture(picture);
  const dim = SIZE[size];
  const label = name?.trim() || "Agent";
  const clipped = !photo && CLIPPED.has(silhouette);
  const shaped = shapeStyle(silhouette, Boolean(photo));

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden",
        clipped ? "border-0" : "border border-foreground/15",
        dim.box,
        shaped.className,
        className,
      )}
      style={{
        background: photo ? undefined : tokens.fill,
        color: tokens.ink,
        ...shaped.style,
      }}
      data-icon={iconName}
      data-color={resolveAgentColor(color)}
      data-shape={silhouette}
      data-picture={photo ? "true" : "false"}
      data-agent-name={label}
      title={label}
      aria-hidden
    >
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element -- user-supplied photo URL, not optimizable
        <img src={photo} alt="" className="size-full object-cover" draggable={false} />
      ) : (
        createElement(AGENT_ICONS[iconName], { className: dim.icon, strokeWidth: 2.1 })
      )}
    </span>
  );
}

export type { AgentIconName, AgentColor };
