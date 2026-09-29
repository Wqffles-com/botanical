"use client";

import { activeMentionQuery, type Agent, type ModelProfile } from "@botanical/core";
import { ArrowUp, Square } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { AgentAvatar } from "@/components/agent-avatar";
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
  mentionables,
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
  /** Agents offered after `@`. Mentioning one sends it the message as agent mail. */
  mentionables?: Agent[];
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
  const [caret, setCaret] = useState<number | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const mention = caret === null ? null : activeMentionQuery(value, caret);
  const suggestions =
    mention && mention.start !== dismissed && mentionables
      ? mentionables
          .filter((agent) => agent.name.toLowerCase().startsWith(mention.query.toLowerCase()))
          .slice(0, 6)
      : [];
  const active = Math.min(highlight, Math.max(suggestions.length - 1, 0));

  function pickMention(agent: Agent) {
    if (!mention) return;
    const end = mention.start + 1 + mention.query.length;
    const next = `${value.slice(0, mention.start)}@${agent.name} ${value.slice(end)}`;
    const pos = mention.start + agent.name.length + 2;
    valueRef.current = next;
    caretRef.current = pos;
    setCaret(pos);
    setHighlight(0);
    onChange(next);
  }
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
    if (suggestions.length > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setHighlight((active + step + suggestions.length) % suggestions.length);
        return;
      }
      if ((event.key === "Enter" || event.key === "Tab") && !event.nativeEvent.isComposing) {
        event.preventDefault();
        pickMention(suggestions[active] as Agent);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setDismissed(mention?.start ?? null);
        return;
      }
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
    <form onSubmit={handleSubmit} className="px-3 pb-4 pt-1 sm:px-4">
      <div
        className={cn(
          "relative mx-auto flex max-w-3xl flex-col rounded-[1.75rem] bg-bubble shadow-sm ring-1 ring-border transition-shadow",
          disabled ? "opacity-70" : "focus-within:ring-foreground/20",
        )}
      >
        {suggestions.length > 0 ? (
          <ul
            id="composer-mentions"
            role="listbox"
            aria-label="Mention an agent"
            data-testid="mention-suggestions"
            className="absolute bottom-full left-0 z-10 mb-1 w-64 max-w-full overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md"
          >
            {suggestions.map((agent, index) => (
              <li
                key={agent.id}
                id={`composer-mention-${agent.id}`}
                role="option"
                aria-selected={index === active}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                  index === active ? "bg-accent text-accent-foreground" : "",
                )}
                onMouseDown={(event) => {
                  event.preventDefault();
                  pickMention(agent);
                }}
                onMouseEnter={() => setHighlight(index)}
              >
                <AgentAvatar
                  size="sm"
                  name={agent.name}
                  icon={agent.icon}
                  color={agent.color}
                  shape={agent.shape}
                  picture={agent.picture}
                />
                <span className="truncate">{agent.name}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <textarea
          ref={ref}
          id="composer"
          data-testid="composer"
          value={value}
          onChange={(event) => {
            valueRef.current = event.target.value;
            setCaret(event.target.selectionStart);
            onChange(event.target.value);
          }}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
          onBlur={() => setCaret(null)}
          role={mentionables ? "combobox" : undefined}
          aria-expanded={mentionables ? suggestions.length > 0 : undefined}
          aria-controls={suggestions.length > 0 ? "composer-mentions" : undefined}
          aria-activedescendant={
            suggestions.length > 0 ? `composer-mention-${(suggestions[active] as Agent).id}` : undefined
          }
          onKeyDown={handleKey}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className="max-h-[200px] min-h-[48px] w-full resize-none bg-transparent px-5 pt-3.5 pb-1 text-[0.9375rem] leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed"
          aria-describedby={unavailableHint ? "composer-unavailable" : undefined}
        />
        {unavailableHint ? (
          <p
            id="composer-unavailable"
            data-testid="profile-unavailable"
            className="px-5 pb-1 text-2xs leading-snug text-muted-foreground"
          >
            {unavailableHint}
          </p>
        ) : null}
        <DictationNotice dictation={dictation} />
        <div className="flex items-center gap-1.5 px-2.5 pb-2.5">
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
          {recording && !unavailableHint ? (
            <span className="hidden text-2xs text-muted-foreground sm:inline">Enter or Space to stop · Escape to cancel</span>
          ) : null}
          <span className="ml-auto flex items-center gap-2">
            <DictationActions dictation={dictation} />
            {working ? (
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-9 rounded-full"
                data-testid="stop"
                onClick={onStop}
                aria-label="Stop"
              >
                <Square className="size-3.5 fill-current" />
              </Button>
            ) : null}
            {recording ? null : (
              <Button
                type="submit"
                size="icon"
                className="size-9 rounded-full"
                data-testid="send"
                disabled={!canSubmit}
                aria-label="Send"
                title="Send (Enter). Shift+Enter for a new line."
              >
                <ArrowUp className="size-4" />
              </Button>
            )}
          </span>
        </div>
      </div>
    </form>
  );
}
