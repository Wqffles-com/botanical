"use client";

import { Check, ChevronRight, CircleAlert, FileText, Globe, LoaderCircle, SquareTerminal, Unplug } from "lucide-react";
import { useState } from "react";
import type { UiToolCall } from "@/lib/chat-stream";
import { formatJson } from "@/lib/format";
import { cn } from "@/lib/utils";

function ToolIcon({ name }: { name: string }) {
  const cls = "size-3.5 shrink-0 text-muted-foreground";
  if (/shell|exec|terminal/i.test(name)) return <SquareTerminal className={cls} />;
  if (/file/i.test(name)) return <FileText className={cls} />;
  if (/mcp/i.test(name)) return <Unplug className={cls} />;
  return <Globe className={cls} />;
}

export function ToolCallCard({ call }: { call: UiToolCall }) {
  const [open, setOpen] = useState(call.status === "running");
  const [full, setFull] = useState(false);
  const running = call.status === "running";
  const failed = call.status === "error";
  const args = formatJson(call.arguments);
  const output = call.result ?? "";
  const long = output.length > 500 || output.split("\n").length > 14;

  return (
    <div
      className={cn("my-2 overflow-hidden rounded-lg border bg-card text-xs", failed && "border-destructive/40 bg-destructive/5")}
      data-testid="tool-call"
      data-tool-name={call.name}
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        {running ? (
          <LoaderCircle className="size-3.5 shrink-0 animate-spin text-primary" />
        ) : failed ? (
          <CircleAlert className="size-3.5 shrink-0 text-destructive" />
        ) : (
          <Check className="size-3.5 shrink-0 text-success" />
        )}
        <ToolIcon name={call.name} />
        <span className="shrink-0 font-mono text-xs">{call.name}</span>
        <ChevronRight className={cn("size-3 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
        <span className="min-w-0 flex-1 truncate font-mono text-2xs text-muted-foreground">
          {args.replace(/\s+/g, " ")}
        </span>
        <span
          className={cn(
            "shrink-0 text-2xs whitespace-nowrap capitalize",
            failed ? "font-medium text-destructive" : "text-muted-foreground",
          )}
        >
          {call.status}
        </span>
      </button>
      {open ? (
        <div className="space-y-2 border-t px-2.5 py-2">
          {args ? (
            <section>
              <h4 className="mb-1 text-2xs font-medium text-muted-foreground">Arguments</h4>
              <pre className="overflow-x-auto font-mono text-2xs whitespace-pre-wrap text-muted-foreground">{args}</pre>
            </section>
          ) : null}
          {output ? (
            <section>
              <h4 className="mb-1 text-2xs font-medium text-muted-foreground">Result</h4>
              <pre
                className={cn(
                  "overflow-auto font-mono text-2xs whitespace-pre-wrap text-muted-foreground",
                  !full && "max-h-40",
                )}
              >
                {output}
              </pre>
              {long ? (
                <button
                  type="button"
                  className="mt-1 text-2xs text-muted-foreground underline-offset-2 hover:underline"
                  onClick={() => setFull((value) => !value)}
                >
                  {full ? "Show less" : "Expand"}
                </button>
              ) : null}
            </section>
          ) : running ? (
            <p className="text-2xs text-muted-foreground">Running…</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
