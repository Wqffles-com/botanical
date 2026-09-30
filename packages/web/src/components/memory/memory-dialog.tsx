"use client";

import type { MemoryRecord } from "@botanical/core";
import { useEffect, useState, type ReactNode } from "react";
import { Badge } from "@botanical/ui/components/badge";
import { Button } from "@botanical/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@botanical/ui/components/dialog";
import { Input } from "@botanical/ui/components/input";
import { Label } from "@botanical/ui/components/label";
import { Textarea } from "@botanical/ui/components/textarea";
import { memoryTitle } from "@/lib/memory-title";

/**
 * The full memory entry in a popup. Read-only unless `onSave` is given, in which
 * case an Edit button switches the popup to a form.
 */
export function MemoryDialog({
  memory,
  scopeLabel,
  onOpenChange,
  onSave,
  onDelete,
  saving = false,
  footer,
}: {
  memory: MemoryRecord | null;
  /** e.g. "Shared memory" or "Scout's memory". */
  scopeLabel?: string;
  onOpenChange: (open: boolean) => void;
  onSave?: (memory: MemoryRecord, patch: { content: string; tags: string }) => Promise<boolean>;
  onDelete?: (memory: MemoryRecord) => void;
  saving?: boolean;
  /** Extra footer content for the read-only view (e.g. a link to Settings). */
  footer?: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState("");
  const [tags, setTags] = useState("");

  useEffect(() => {
    setEditing(false);
    setContent(memory?.content ?? "");
    setTags(memory?.tags.join(", ") ?? "");
  }, [memory]);

  return (
    <Dialog open={memory !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-lg" data-testid="memory-dialog">
        {memory ? (
          <>
            <DialogHeader className="pr-8">
              <DialogTitle className="break-words">{editing ? "Edit memory" : memoryTitle(memory.content)}</DialogTitle>
              <DialogDescription>
                {[scopeLabel, `Updated ${formatDate(memory.updatedAt)}`].filter(Boolean).join(" · ")}
              </DialogDescription>
            </DialogHeader>
            {editing ? (
              <div className="grid gap-3 overflow-y-auto">
                <div className="grid gap-1.5">
                  <Label htmlFor="memory-edit-content">Memory</Label>
                  <Textarea
                    id="memory-edit-content"
                    value={content}
                    onChange={(event) => setContent(event.target.value)}
                    rows={8}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="memory-edit-tags">Tags</Label>
                  <Input
                    id="memory-edit-tags"
                    value={tags}
                    onChange={(event) => setTags(event.target.value)}
                    placeholder="tags, comma separated"
                  />
                </div>
              </div>
            ) : (
              <div className="grid content-start gap-3 overflow-y-auto">
                <p className="text-sm whitespace-pre-wrap break-words">{memory.content}</p>
                {memory.tags.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {memory.tags.map((tag) => (
                      <Badge key={tag} variant="outline">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </div>
            )}
            {editing ? (
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    if (!onSave) return;
                    void onSave(memory, { content, tags }).then((ok) => {
                      if (ok) setEditing(false);
                    });
                  }}
                >
                  Save
                </Button>
              </DialogFooter>
            ) : onSave || onDelete || footer ? (
              <DialogFooter className="items-center">
                {footer ? <div className="mr-auto text-xs text-muted-foreground">{footer}</div> : null}
                {onDelete ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => onDelete(memory)}
                  >
                    Delete
                  </Button>
                ) : null}
                {onSave ? (
                  <Button type="button" onClick={() => setEditing(true)}>
                    Edit
                  </Button>
                ) : null}
              </DialogFooter>
            ) : null}
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}
