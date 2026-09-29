"use client";

import { Check, Copy, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { ConfirmDialog } from "@botanical/ui/components/alert-dialog";
import { Button } from "@botanical/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@botanical/ui/components/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@botanical/ui/components/tooltip";
import { cn } from "@/lib/utils";

/** What a stored message can do. A missing handler hides its button. */
export interface MessageActionHandlers {
  /** Save new text in place. */
  onEdit?: (content: string) => Promise<boolean>;
  /** Replace this user message with new text and ask the agent again. */
  onResend?: (content: string) => Promise<boolean>;
  /** Ask the agent again for this reply. */
  onRetry?: () => Promise<boolean>;
  onDelete: (following: boolean) => Promise<boolean>;
  /** True while the agent works. The transcript is locked until it is done. */
  disabled: boolean;
}

export function MessageActions({
  content,
  actions,
  onStartEdit,
  align,
}: {
  content: string;
  actions: MessageActionHandlers;
  /** Shown when the message has text and can be edited or resent. */
  onStartEdit?: () => void;
  align: "start" | "end";
}) {
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState<{ following: boolean } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const busy = actions.disabled;
  const busyHint = "Available when the agent is done";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be refused. Nothing else to do.
    }
  };

  const remove = async () => {
    if (!confirm) return;
    setDeleting(true);
    const ok = await actions.onDelete(confirm.following);
    setDeleting(false);
    if (ok) setConfirm(null);
  };

  return (
    <div
      data-testid="message-actions"
      className={cn(
        "flex items-center gap-0.5 opacity-0 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100 has-[[data-popup-open]]:opacity-100 pointer-coarse:opacity-100",
        align === "end" ? "justify-end" : "justify-start",
      )}
    >
      {content ? (
        <ActionButton label={copied ? "Copied" : "Copy"} onClick={() => void copy()}>
          {copied ? <Check /> : <Copy />}
        </ActionButton>
      ) : null}
      {onStartEdit ? (
        <ActionButton label={busy ? busyHint : "Edit"} disabled={busy} onClick={onStartEdit} testId="message-edit">
          <Pencil />
        </ActionButton>
      ) : null}
      {actions.onRetry ? (
        <ActionButton
          label={busy ? busyHint : "Retry"}
          disabled={busy}
          onClick={() => void actions.onRetry?.()}
          testId="message-retry"
        >
          <RotateCcw />
        </ActionButton>
      ) : null}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger render={<span className="inline-flex" />}>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground"
                  aria-label="Delete"
                  data-testid="message-delete"
                  disabled={busy}
                />
              }
            >
              <Trash2 />
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{busy ? busyHint : "Delete"}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align={align} className="w-auto min-w-48">
          <DropdownMenuItem onClick={() => setConfirm({ following: false })}>Delete message</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => setConfirm({ following: true })}>
            Delete this and everything after it
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setConfirm(null);
        }}
        title={confirm?.following ? "Delete this and later messages?" : "Delete this message?"}
        description={
          confirm?.following
            ? "This message and every message after it are removed from the chat. The agent will not see them again."
            : "The message is removed from the chat, with any tool results it produced. The agent will not see it again."
        }
        pending={deleting}
        pendingLabel="Deleting…"
        onConfirm={() => void remove()}
      />
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  disabled,
  testId,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground"
          aria-label={label}
          data-testid={testId}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
