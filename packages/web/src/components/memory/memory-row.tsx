"use client";

import type { MemoryRecord } from "@botanical/core";
import { ChevronRight } from "lucide-react";
import { relativeTime } from "@/lib/format";
import { memoryTitle } from "@/lib/memory-title";
import { cn } from "@/lib/utils";

/** One collapsed memory: its title and age. Clicking opens the full entry. */
export function MemoryRow({
  memory,
  onOpen,
  className,
}: {
  memory: MemoryRecord;
  onOpen: (memory: MemoryRecord) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(memory)}
      className={cn(
        "group flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        className,
      )}
      data-testid="memory-row"
    >
      <span className="min-w-0 flex-1 truncate">{memoryTitle(memory.content)}</span>
      <time className="shrink-0 text-xs text-muted-foreground" dateTime={memory.updatedAt}>
        {relativeTime(memory.updatedAt)}
      </time>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
    </button>
  );
}
