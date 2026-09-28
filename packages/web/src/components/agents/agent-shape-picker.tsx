"use client";

import { AGENT_SHAPES, type AgentShape } from "@botanical/core";
import { AgentAvatar } from "@/components/agent-avatar";
import type { AgentColor } from "@/lib/agent-colors";
import { cn } from "@/lib/utils";

const LABEL: Record<AgentShape, string> = {
  circle: "Circle",
  squircle: "Rounded",
  square: "Square",
  hexagon: "Hexagon",
  diamond: "Diamond",
  shield: "Shield",
};

export function AgentShapePicker({
  value,
  color,
  icon,
  onChange,
  disabled,
}: {
  value: AgentShape;
  color: AgentColor;
  icon: string;
  onChange: (shape: AgentShape) => void;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label="Avatar shape" data-testid="shape-picker" className="flex flex-wrap gap-2">
      {AGENT_SHAPES.map((shape) => {
        const selected = shape === value;
        return (
          <button
            key={shape}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={LABEL[shape]}
            disabled={disabled}
            onClick={() => onChange(shape)}
            className={cn(
              "rounded-lg p-1 ring-offset-2 ring-offset-background transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40",
              selected && "ring-2 ring-foreground",
            )}
          >
            <AgentAvatar name={LABEL[shape]} icon={icon} color={color} shape={shape} size="md" />
          </button>
        );
      })}
    </div>
  );
}
