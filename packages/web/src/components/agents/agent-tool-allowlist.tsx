"use client";

import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import type { ToolInfo } from "@/lib/agent-identity";
import { cn } from "@/lib/utils";

export function AgentToolAllowlist({
  tools,
  value,
  onChange,
  disabled,
  loading,
}: {
  tools: ToolInfo[];
  value: string[];
  onChange: (toolIds: string[]) => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  const selected = new Set(value);

  function toggle(id: string) {
    if (selected.has(id)) onChange(value.filter((item) => item !== id));
    else onChange([...value, id]);
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading tools…</p>;
  }

  if (tools.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No tools reported by the server yet. Built-ins and MCP tools will appear here from{" "}
        <code className="font-mono text-xs">GET /api/tools</code>.
      </p>
    );
  }

  return (
    <div className="grid gap-2">
      {tools.map((tool) => {
        const checked = selected.has(tool.id);
        const inputId = `tool-${tool.id}`;
        return (
          <label
            key={tool.id}
            htmlFor={inputId}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-lg border bg-card px-3 py-2.5 transition-colors hover:bg-accent/40",
              checked ? "border-primary/40 bg-accent/30" : "border-border",
              disabled && "pointer-events-none opacity-50",
            )}
          >
            <input
              id={inputId}
              type="checkbox"
              className="mt-1 size-4 accent-emerald-600"
              checked={checked}
              disabled={disabled}
              onChange={() => toggle(tool.id)}
            />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <Label htmlFor={inputId} className="cursor-pointer text-sm font-medium">
                  {tool.name}
                </Label>
                {tool.source ? (
                  <Badge variant="secondary" className="font-normal capitalize">
                    {tool.source}
                  </Badge>
                ) : null}
              </span>
              {tool.description ? (
                <span className="mt-0.5 block text-xs text-muted-foreground">{tool.description}</span>
              ) : (
                <span className="mt-0.5 block font-mono text-[11px] text-muted-foreground">{tool.id}</span>
              )}
            </span>
          </label>
        );
      })}
    </div>
  );
}
