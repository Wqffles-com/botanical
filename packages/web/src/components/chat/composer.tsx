"use client";

import { activeMentionQuery, type Agent, type ModelProfile } from "@botanical/core";
import { ArrowUp, FileText, Paperclip, Square, X } from "lucide-react";
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent, type KeyboardEvent } from "react";
import { AgentAvatar } from "@/components/agent-avatar";
import { DictationActions, DictationNotice } from "@/components/chat/dictation-button";
import { spliceTranscript } from "@/components/chat/dictation";
import { useDictation } from "@/components/chat/use-dictation";
import { ProfileSelect } from "@/components/chat/profile-select";
import { Button } from "@botanical/ui/components/button";
import { formatBytes, type PendingFile } from "@/lib/attachments";
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
  attachments,
  onAttach,
  onRemoveAttachment,
  uploading,
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
  /** Files chosen, dropped, or pasted, uploaded when the message is sent. */
  attachments: PendingFile[];
  onAttach: (files: File[]) => void;
  onRemoveAttachment: (id: string) => void;
  uploading: boolean;
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
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const canSubmit =
    !disabled && !recording && !unavailableHint && !uploading && (value.trim().length > 0 || attachments.length > 0);

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

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.files);
    if (files.length === 0 || disabled) return;
    event.preventDefault();
    onAttach(files);
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (!disabled) onAttach(Array.from(event.dataTransfer.files));
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
          dragging && "ring-2 ring-primary",
        )}
        onDragOver={(event) => {
          if (disabled || !event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={handleDrop}
      >
        {attachments.length > 0 ? (
          <ul className="flex flex-wrap gap-2 px-4 pt-3" data-testid="composer-attachments">
            {attachments.map((item) => (
              <li
                key={item.id}
                className="relative flex max-w-56 items-center gap-2 rounded-xl bg-background/60 p-1.5 pr-8 text-xs ring-1 ring-border"
              >
                {item.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a local object URL
                  <img src={item.previewUrl} alt="" className="size-10 rounded-lg object-cover" />
                ) : (
                  <FileText className="mx-2 size-5 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <span className="min-w-0">
                  <span className="block truncate">{item.name}</span>
                  <span className="block text-2xs text-muted-foreground">{formatBytes(item.file.size)}</span>
                </span>
                <button
                  type="button"
                  className="absolute right-1.5 top-1.5 rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label={`Remove ${item.name}`}
                  onClick={() => onRemoveAttachment(item.id)}
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
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
          onPaste={handlePaste}
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
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            data-testid="composer-file-input"
            onChange={(event) => {
              onAttach(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 rounded-full text-muted-foreground"
            data-testid="attach"
            aria-label="Attach files"
            title="Attach files, or drop or paste them"
            disabled={disabled}
            onClick={() => fileInput.current?.click()}
          >
            <Paperclip className="size-4" />
          </Button>
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
