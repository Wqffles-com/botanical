"use client";

import { LoaderCircle, Mic, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { DictationController } from "./use-dictation";

export function DictationNotice({ dictation }: { dictation: DictationController }) {
  if (!dictation.privacyNote && !dictation.interim && !dictation.error) return null;
  return (
    <div className="px-3.5 pb-1 text-[11px] leading-snug text-muted-foreground">
      {dictation.privacyNote ? <p>{dictation.privacyNote}</p> : null}
      {dictation.interim ? <p aria-live="polite">{dictation.interim}</p> : null}
      {dictation.error ? <p role="alert">{dictation.error}</p> : null}
    </div>
  );
}

export function DictationActions({ dictation }: { dictation: DictationController }) {
  return (
    <span className="flex items-center gap-1.5">
      {dictation.phase === "recording" ? (
        <>
          <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-foreground" aria-hidden />
          <span
            data-testid="dictation-timer"
            className="font-mono text-[11px] tabular-nums text-muted-foreground"
            aria-label={`Recording time ${dictation.elapsedLabel}`}
          >
            {dictation.elapsedLabel}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            data-testid="dictation-cancel"
            aria-label="Cancel dictation"
            onClick={dictation.cancel}
          >
            <X className="size-3.5" />
          </Button>
        </>
      ) : null}
      {dictation.phase === "transcribing" ? (
        <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
          Transcribing…
        </span>
      ) : null}
      <Tooltip>
        <TooltipTrigger render={<span className="inline-flex" />}>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            data-testid="dictation-mic"
            className={dictation.phase === "recording" ? "bg-muted" : undefined}
            aria-label={dictation.micLabel}
            aria-pressed={dictation.phase === "recording"}
            disabled={dictation.micDisabled}
            onClick={dictation.toggle}
          >
            {dictation.phase === "recording" ? (
              <Square className="size-3.5 fill-current" />
            ) : (
              <Mic className="size-3.5" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{dictation.tooltip}</TooltipContent>
      </Tooltip>
    </span>
  );
}
