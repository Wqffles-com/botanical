"use client";

import { Check, ChevronRight, FileText, Globe, LoaderCircle, SquareTerminal, Unplug } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { formatJson } from "@/lib/format";
import type { UiToolCall } from "@/lib/chat-stream";

function ToolIcon({ name }: { name: string }) {
  const cls = "size-3.5 shrink-0 text-muted-foreground";
  if (/shell|exec|terminal/i.test(name)) return <SquareTerminal className={cls} />;
  if (/file/i.test(name)) return <FileText className={cls} />;
  if (/mcp/i.test(name)) return <Unplug className={cls} />;
  return <Globe className={cls} />;
}

export function ToolCallCard({ call }: { call: UiToolCall }) {
  const [open, setOpen] = useState(false);
  const running = call.status === "running";
  const args = formatJson(call.arguments);
  const output = call.result ?? "";
  return (
    <div
      className={cn(
        "my-2 overflow-hidden rounded-md border bg-card/70 text-[12.5px]",
        running ? "border-primary/30" : "border-border",
      )}
      data-testid="tool-call"
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        {running ? (
          <LoaderCircle className="size-3.5 shrink-0 animate-spin text-primary" />
        ) : (
          <Check className="size-3.5 shrink-0 text-primary" />
        )}
        <ToolIcon name={call.name} />
        <span className="shrink-0 font-mono text-[12px]">{call.name}</span>
        <ChevronRight className={cn("size-3 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-muted-foreground">
          {args.replace(/\s+/g, " ")}
        </span>
        <span className="shrink-0 text-[11px] uppercase tracking-wide text-muted-foreground">{call.status}</span>
      </button>
      {open ? (
        <div className="space-y-2 border-t px-2.5 py-2">
          {args ? (
            <section>
              <h4 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Arguments</h4>
              <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[11.5px] text-muted-foreground">{args}</pre>
            </section>
          ) : null}
          {output ? (
            <section>
              <h4 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Output</h4>
              <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[11.5px] text-muted-foreground">{output}</pre>
            </section>
          ) : running ? (
            <p className="text-[11.5px] text-muted-foreground">Running…</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
