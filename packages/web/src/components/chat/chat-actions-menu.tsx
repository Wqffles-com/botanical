"use client";

import { Download, Ellipsis, FoldVertical, Trash2 } from "lucide-react";
import type { Chat, ChatMessage } from "@botanical/core";
import { useState } from "react";
import { ConfirmDialog } from "@botanical/ui/components/alert-dialog";
import { Button } from "@botanical/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@botanical/ui/components/dropdown-menu";
import { chatToJson, chatToMarkdown } from "@/lib/chat-export";
import { downloadText, fileStem } from "@/lib/download";

/**
 * Header menu for keeping a long chat in shape: compact it into a summary the agent reads
 * instead of the older messages, or clear it. Both wait until the agent is done. Export saves
 * the transcript as Markdown or JSON at any time.
 */
export function ChatActionsMenu({
  disabled,
  empty,
  onCompact,
  onClear,
  chat,
  messages,
  agentNames,
}: {
  /** True while the agent works or messages wait. */
  disabled: boolean;
  /** True when the chat has no messages. */
  empty: boolean;
  onCompact: () => Promise<boolean>;
  onClear: () => Promise<boolean>;
  chat: Chat;
  messages: ChatMessage[];
  /** Agent names by id, for labeling replies in the export. */
  agentNames: Record<string, string>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const locked = disabled || compacting;

  const clear = async () => {
    setClearing(true);
    const ok = await onClear();
    setClearing(false);
    if (ok) setConfirming(false);
  };

  const compact = async () => {
    setCompacting(true);
    await onCompact();
    setCompacting(false);
  };

  const exportAs = (kind: "md" | "json") => {
    const context = { chat, messages, agentNames };
    const stem = fileStem(chat.title, "chat");
    if (kind === "md") downloadText(`${stem}.md`, chatToMarkdown(context), "text/markdown");
    else downloadText(`${stem}.json`, chatToJson(context), "application/json");
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label="Chat actions"
              data-testid="chat-actions"
              className="rounded-full text-muted-foreground hover:text-foreground"
            />
          }
        >
          <Ellipsis />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-56">
          <DropdownMenuItem
            data-testid="chat-compact"
            disabled={locked || empty}
            onClick={() => void compact()}
          >
            <FoldVertical />
            {compacting ? "Compacting…" : "Compact conversation"}
          </DropdownMenuItem>
          <DropdownMenuItem data-testid="chat-export-md" disabled={empty} onClick={() => exportAs("md")}>
            <Download />
            Export as Markdown
          </DropdownMenuItem>
          <DropdownMenuItem data-testid="chat-export-json" disabled={empty} onClick={() => exportAs("json")}>
            <Download />
            Export as JSON
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            data-testid="chat-clear"
            variant="destructive"
            disabled={locked || empty}
            onClick={() => setConfirming(true)}
          >
            <Trash2 />
            Clear chat
          </DropdownMenuItem>
          {disabled ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">Available when the agent is done.</p>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={confirming}
        onOpenChange={(open) => {
          if (!open && !clearing) setConfirming(false);
        }}
        title="Clear this chat?"
        description="Every message is removed and the agent starts fresh. Its memories, files, and settings stay."
        confirmLabel="Clear chat"
        pending={clearing}
        pendingLabel="Clearing…"
        onConfirm={() => void clear()}
      />
    </>
  );
}
