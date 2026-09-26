"use client";

import { AGENT_COLORS, AGENT_COLOR_TOKENS, type AgentColor } from "@/lib/agent-colors";
import { cn } from "@/lib/utils";

export function AgentColorPicker({
  value,
  onChange,
  disabled,
}: {
  value: AgentColor;
  onChange: (color: AgentColor) => void;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label="Agent color" className="flex flex-wrap gap-2">
      {AGENT_COLORS.map((color) => {
        const tokens = AGENT_COLOR_TOKENS[color];
        const selected = color === value;
        return (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={color}
            disabled={disabled}
            onClick={() => onChange(color)}
            className={cn(
              "size-7 rounded-md ring-offset-2 ring-offset-background transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40",
              selected && "ring-2 ring-foreground",
            )}
            style={{ background: tokens.fill }}
          />
        );
      })}
    </div>
  );
}
