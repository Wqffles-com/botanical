"use client";

import type { ModelProfile } from "@botanical/core";
import { Send, Square } from "lucide-react";
import { useEffect, useRef, type FormEvent, type KeyboardEvent } from "react";
import { DictationActions, DictationNotice } from "@/components/chat/dictation-button";
import { spliceTranscript } from "@/components/chat/dictation";
import { useDictation } from "@/components/chat/use-dictation";
import { ProfileSelect } from "@/components/chat/profile-select";
import { Button } from "@botanical/ui/components/button";
import { unavailableProfileHint } from "@/lib/format";
import { cn } from "@/lib/utils";

export function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  working,
  disabled,
  placeholder,
  profiles,
  profileId,
  onProfile,
  profileNeeded,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  /** The agent is on a turn. Sending still works; the message steers the running turn. */
  working: boolean;
  disabled?: boolean;
  placeholder: string;
  profiles?: ModelProfile[];
  profileId?: string | null;
  onProfile?: (profileId: string | null) => void;
  profileNeeded?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const valueRef = useRef(value);
  const caretRef = useRef<number | null>(null);
  const unavailableHint = unavailableProfileHint(profiles?.find((profile) => profile.id === profileId) ?? null);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  function insertTranscript(transcript: string) {
    const current = valueRef.current;
    const el = ref.current;
    const next = spliceTranscript(
      current,
      transcript,
      el?.selectionStart ?? current.length,
      el?.selectionEnd ?? current.length,
    );
    valueRef.current = next.value;
    caretRef.current = next.caret;
    onChange(next.value);
  }

  const dictation = useDictation({
    blocked: Boolean(disabled),
    onInsert: insertTranscript,
  });
  const recording = dictation.phase === "recording";
  const canSubmit = !disabled && !recording && !unavailableHint && value.trim().length > 0;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    const caret = caretRef.current;
    if (caret === null) return;
    caretRef.current = null;
    el.focus();
    const pos = Math.min(caret, el.value.length);
    el.setSelectionRange(pos, pos);
  }, [value]);

  function handleKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (dictation.phase === "recording") {
      event.preventDefault();
      return;
    }
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (canSubmit) onSubmit();
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (canSubmit) onSubmit();
  }

  return (
    <form onSubmit={handleSubmit} className="px-4 pb-4 pt-2">
      <div
        className={cn(
          "mx-auto flex max-w-3xl flex-col rounded-xl border bg-card",
          disabled ? "border-border opacity-70" : "border-border focus-within:border-primary/45",
        )}
      >
        <textarea
          ref={ref}
          id="composer"
          data-testid="composer"
          value={value}
          onChange={(event) => {
            valueRef.current = event.target.value;
            onChange(event.target.value);
          }}
          onKeyDown={handleKey}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className="max-h-[200px] min-h-[44px] w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed"
          aria-describedby={unavailableHint ? "composer-unavailable" : undefined}
        />
        {unavailableHint ? (
          <p
            id="composer-unavailable"
            data-testid="profile-unavailable"
            className="px-3.5 pb-1 text-2xs leading-snug text-muted-foreground"
          >
            {unavailableHint}
          </p>
        ) : null}
        <DictationNotice dictation={dictation} />
        <div className="flex items-end gap-2 px-2 pb-2">
          {profiles && onProfile ? (
            <ProfileSelect
              id="composer-profile"
              profiles={profiles}
              value={profileId ?? null}
              onChange={onProfile}
              needed={profileNeeded}
              compact
            />
          ) : null}
          {unavailableHint ? null : (
            <span className="mb-1 hidden text-2xs text-muted-foreground sm:inline">
              {dictation.phase === "recording"
                ? "Enter or Space to stop · Escape to cancel"
                : "Enter to send · Shift+Enter newline"}
            </span>
          )}
          <span className="ml-auto flex items-center gap-2">
            <DictationActions dictation={dictation} />
            {working ? (
              <Button type="button" variant="outline" size="icon" data-testid="stop" onClick={onStop} aria-label="Stop">
                <Square className="size-3.5 fill-current" />
              </Button>
            ) : null}
            {recording ? null : (
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
