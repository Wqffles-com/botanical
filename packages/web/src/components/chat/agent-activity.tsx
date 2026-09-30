"use client";

import { ChevronRight, NotebookText } from "lucide-react";
import { useState } from "react";
import { Markdown } from "@/components/chat/markdown";
import { ToolCallCard } from "@/components/chat/tool-call-card";
import type { ThreadEntry } from "@/lib/chat-stream";
import { cn } from "@/lib/utils";

/**
 * An agent's working notes between replies: its text output and tool calls, collapsed. The agent
 * talks to the user with `send_message`; this is what it wrote along the way.
 */
export function AgentActivity({ entry, name }: { entry: ThreadEntry; name?: string }) {
  const steps = entry.steps ?? [];
  const running = entry.tools.some((call) => call.status === "running");
  const [open, setOpen] = useState(running);
  const calls = entry.tools.length;
  const label = [name ? `${name}'s notes` : "Notes", calls > 0 ? `${calls} tool call${calls === 1 ? "" : "s"}` : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex gap-3" data-testid="agent-activity">
      <div className="w-6 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col items-start">
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-md py-0.5 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          <NotebookText className="size-3.5 shrink-0" />
          <span>{label}</span>
          <ChevronRight className={cn("size-3 shrink-0 transition-transform", open && "rotate-90")} />
        </button>
        {open ? (
          <div className="mt-1 w-full max-w-[min(92%,48rem)] space-y-1 border-l pl-3 text-xs leading-relaxed text-muted-foreground">
            {steps.map((step) => (
              <div key={step.key}>
                {step.message.content.trim() ? <Markdown className="text-xs">{step.message.content}</Markdown> : null}
                {step.tools.map((call) => (
                  <ToolCallCard key={call.id || call.name} call={call} />
                ))}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
