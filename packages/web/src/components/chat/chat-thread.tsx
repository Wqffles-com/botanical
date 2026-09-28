"use client";

import { MessageSquareOff } from "lucide-react";
import type { Agent, Chat, ChatMessage, ModelProfile } from "@botanical/core";
import { useEffect, useRef } from "react";
import { ChatAgentHeader } from "@/components/chat/chat-agent-header";
import { Composer } from "@/components/chat/composer";
import { EmptyState } from "@botanical/ui/components/empty-state";
import { MessageBubble } from "@/components/chat/message-bubble";
import { ProfileRequiredBanner } from "@/components/chat/profile-required-banner";
import { ChatThreadSkeleton } from "@/components/chat/skeletons";
import { identityFromUnknown } from "@/lib/agent-identity";
import { pendingToMessage, type PendingMessage } from "@/lib/chat-queue";
import { presentThread } from "@/lib/chat-stream";

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
  pending,
  working,
  error,
  profileError,
  onProfile,
  onSend,
  onStop,
  creator,
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
  pending: PendingMessage[];
  working: boolean;
  error: string | null;
  profileError: string | null;
  onProfile: (profileId: string | null) => void;
  onSend: () => void;
  onStop: () => void;
  creator?: Agent | null;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const identity = agent ? identityFromUnknown(agent) : null;

  useEffect(() => {
    const el = scroller.current;
    if (!el || !stick.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, pending, working]);

  if (loading) return <ChatThreadSkeleton />;
  if (missing || !chat) {
    return (
      <EmptyState
        icon={MessageSquareOff}
        title="Chat not found"
        className="h-full"
        body="This thread may have been deleted, or the id is wrong."
      />
    );
  }

  const rows = presentThread(messages);
  const unavailable = Boolean(profileError && /unavailable/i.test(profileError));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ChatAgentHeader agent={identity} title={chat.title} creator={creator} />

      {!profileReady || profileError ? (
        <div className="border-b px-4 py-2">
          <ProfileRequiredBanner
            title={unavailable ? "Profile unavailable" : undefined}
            message={profileError ?? undefined}
          />
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
        {messages.length === 0 && pending.length === 0 ? (
          <div className="mx-auto flex h-full max-w-3xl flex-col items-center justify-center px-6 text-center">
            <h2 className="text-2xl font-semibold tracking-tight">{identity?.name ?? "New chat"}</h2>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              {identity?.description || "Send a message when a model profile is selected."}
            </p>
          </div>
        ) : (
          <div className="mx-auto flex min-h-full max-w-3xl flex-col justify-end gap-5 px-4 py-6">
            {rows.map((row) => (
              <MessageBubble
                key={row.key}
                message={row.message}
                agent={agent}
                toolCalls={row.tools.length > 0 ? row.tools : undefined}
              />
            ))}
            {working ? (
              <MessageBubble
                message={{ id: "working", chatId: chat.id, role: "assistant", content: "", createdAt: "" }}
                agent={agent}
                working
              />
            ) : null}
            {pending.map((row) => (
              <MessageBubble key={row.id} message={pendingToMessage(chat.id, row)} queued />
            ))}
            <p className="sr-only" aria-live="polite">
              {working ? `${identity?.name ?? "The agent"} is working` : ""}
            </p>
          </div>
        )}
      </div>

      <Composer
        value={draft}
        onChange={onDraft}
        onSubmit={onSend}
        onStop={onStop}
        working={working}
        disabled={!profileReady}
        placeholder={profileReady ? `Message ${identity?.name ?? "this agent"}…` : "Choose a model profile to write"}
        profiles={profiles}
        profileId={profileId}
        onProfile={onProfile}
        profileNeeded={!profileReady}
      />
    </div>
  );
}
