"use client";

import { Ellipsis, FoldVertical, Trash2 } from "lucide-react";
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

/**
 * Header menu for keeping a long chat in shape: compact it into a summary the agent reads
 * instead of the older messages, or clear it. Both wait until the agent is done.
 */
export function ChatActionsMenu({
  disabled,
  empty,
  onCompact,
  onClear,
}: {
  /** True while the agent works or messages wait. */
  disabled: boolean;
  /** True when the chat has no messages. */
  empty: boolean;
  onCompact: () => Promise<boolean>;
  onClear: () => Promise<boolean>;
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

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Chat actions"
              data-testid="chat-actions"
              className="text-muted-foreground"
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
