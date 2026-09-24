"use client";

import type { Agent, Chat, ChatMessage, ModelProfile } from "@botanical/core";
import { useEffect, useRef } from "react";
import { AgentAvatar } from "@/components/agents/agent-avatar";
import { Composer } from "@/components/chat/composer";
import { EmptyState } from "@/components/chat/empty-state";
import { MessageBubble } from "@/components/chat/message-bubble";
import { ProfileRequiredBanner } from "@/components/chat/profile-required-banner";
import { ProfileSelect } from "@/components/chat/profile-select";
import { ChatThreadSkeleton } from "@/components/chat/skeletons";
import type { StreamDraft } from "@/lib/chat-stream";
import { draftToMessage } from "@/lib/chat-stream";

export function ChatThread({
  chat,
  agent,
  profiles,
  profileId,
  profileReady,
  messages,
  loading,
  missing,
  draft,
  onDraft,
  streaming,
  error,
  profileError,
  onProfile,
  onSend,
  onStop,
}: {
  chat: Chat | null;
  agent: Agent | null;
  profiles: ModelProfile[];
  profileId: string | null;
  profileReady: boolean;
  messages: ChatMessage[];
  loading: boolean;
  missing: boolean;
  draft: string;
  onDraft: (value: string) => void;
  streaming: StreamDraft | null;
  error: string | null;
  profileError: string | null;
  onProfile: (profileId: string | null) => void;
  onSend: () => void;
  onStop: () => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const identity = agent as (Agent & { icon?: string; color?: string }) | null;

  useEffect(() => {
    const el = scroller.current;
    if (!el || !stick.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, streaming?.content, streaming?.toolCalls.length]);

  if (loading) return <ChatThreadSkeleton />;
  if (missing || !chat) {
    return (
      <EmptyState
        title="Chat not found"
        body="This thread may have been deleted, or the id is wrong."
      />
    );
  }

  const live = streaming && streaming.chatId === chat.id ? streaming : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
        {agent ? (
          <AgentAvatar name={agent.name} icon={identity?.icon} color={identity?.color} size="sm" />
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-medium">{chat.title}</div>
          <div className="truncate text-[11.5px] text-muted-foreground">
            {agent?.name ?? "Unknown agent"} · one agent per chat
          </div>
        </div>
        <ProfileSelect
          profiles={profiles}
          value={profileId}
          onChange={onProfile}
          needed={!profileReady}
        />
      </header>

      {!profileReady || profileError ? (
        <div className="border-b px-4 py-2">
          <ProfileRequiredBanner message={profileError ?? undefined} />
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="border-b px-4 py-2 text-sm text-destructive" data-testid="chat-error">
          {error}
        </p>
      ) : null}

      <div
        ref={scroller}
        data-testid="messages"
        onScroll={() => {
          const el = scroller.current;
          if (!el) return;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {messages.length === 0 && !live ? (
          <div className="mx-auto flex h-full max-w-[760px] flex-col items-center justify-center px-6 text-center">
            <h2 className="font-heading text-4xl tracking-tight">{agent?.name ?? "New chat"}</h2>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              {agent?.description || "Send a message when a model profile is selected."}
            </p>
          </div>
        ) : (
          <div className="mx-auto flex min-h-full max-w-[760px] flex-col justify-end gap-5 px-4 py-6">
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} agent={agent} />
            ))}
            {live ? (
              <MessageBubble
                message={draftToMessage(live)}
                agent={agent}
                streaming
                toolCalls={live.toolCalls}
              />
            ) : null}
            <p className="sr-only" aria-live="polite">
              {live ? "Assistant is responding" : ""}
            </p>
          </div>
        )}
      </div>

      <Composer
        value={draft}
        onChange={onDraft}
        onSubmit={onSend}
        onStop={onStop}
        streaming={Boolean(live)}
        disabled={!profileReady}
        placeholder={profileReady ? `Message ${agent?.name ?? "this agent"}…` : "Choose a model profile to write"}
      />
    </div>
  );
}
