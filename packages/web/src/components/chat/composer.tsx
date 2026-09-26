"use client";

import { Send, Square } from "lucide-react";
import { useEffect, useRef, type FormEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  streaming,
  disabled,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  streaming: boolean;
  disabled?: boolean;
  placeholder: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const canSubmit = !disabled && !streaming && value.trim().length > 0;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  function handleKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (canSubmit) onSubmit();
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (streaming) onStop();
    else if (canSubmit) onSubmit();
  }

  return (
    <form onSubmit={handleSubmit} className="px-4 pb-4 pt-2">
      <div
        className={cn(
          "mx-auto flex max-w-[760px] flex-col rounded-xl border bg-card",
          disabled ? "border-border opacity-70" : "border-border focus-within:border-primary/45",
        )}
      >
        <textarea
          ref={ref}
          id="composer"
          data-testid="composer"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKey}
          placeholder={placeholder}
          disabled={disabled || streaming}
          rows={1}
          className="max-h-[200px] min-h-[44px] w-full bg-transparent px-3.5 pt-3 pb-1 text-[14.5px] leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed"
        />
        <div className="flex items-center gap-2 px-2 pb-2">
          <span className="hidden text-[11px] text-muted-foreground sm:inline">
            Enter to send · Shift+Enter newline
          </span>
          <span className="ml-auto flex items-center gap-2">
            {streaming ? (
              <Button type="button" variant="outline" size="icon" data-testid="stop" onClick={onStop} aria-label="Stop">
                <Square className="size-3.5 fill-current" />
              </Button>
            ) : (
              <Button type="submit" size="icon" data-testid="send" disabled={!canSubmit} aria-label="Send">
                <Send className="size-3.5" />
              </Button>
            )}
          </span>
        </div>
      </div>
    </form>
  );
}
