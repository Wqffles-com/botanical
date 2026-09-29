"use client";

import type { ChatMessage } from "@botanical/core";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { Markdown } from "@/components/chat/markdown";
import { cn } from "@/lib/utils";

/**
 * Where a chat was compacted. The agent reads the summary instead of the messages above it;
 * they stay here for you to read. The summary opens on click.
 */
export function CompactionDivider({ message }: { message: ChatMessage }) {
  const [open, setOpen] = useState(false);
  return (
    <div data-testid="compaction" className="flex flex-col gap-2">
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-muted hover:text-foreground"
        >
          <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
          Conversation compacted
        </button>
        <span className="h-px flex-1 bg-border" />
      </div>
      {open ? (
        <div className="rounded-lg border bg-muted/40 px-4 py-3 text-sm">
          <p className="mb-2 text-xs text-muted-foreground">
            The agent reads this summary instead of the messages above.
          </p>
          <Markdown>{message.content}</Markdown>
        </div>
      ) : null}
    </div>
  );
}
