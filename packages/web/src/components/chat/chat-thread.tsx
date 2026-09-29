"use client";

import { MessageSquareOff } from "lucide-react";
import { isCompactionMessage, type Agent, type Chat, type ChatMessage, type ModelProfile } from "@botanical/core";
import { useEffect, useRef, type ReactNode } from "react";
import { ChatActionsMenu } from "@/components/chat/chat-actions-menu";
import { ShellHeader } from "@/components/app-shell";
import { ChatAgentHeader } from "@/components/chat/chat-agent-header";
import { ChatMembersMenu } from "@/components/chat/chat-members-menu";
import { CompactionDivider } from "@/components/chat/compaction-divider";
import { Composer } from "@/components/chat/composer";
import { EmptyState } from "@botanical/ui/components/empty-state";
import { AgentAvatar } from "@/components/agent-avatar";
import { AgentStack } from "@/components/agent-stack";
import { MessageBubble } from "@/components/chat/message-bubble";
import type { MessageActionHandlers } from "@/components/chat/message-actions";
import { ProfileRequiredBanner } from "@/components/chat/profile-required-banner";
import { ChatThreadSkeleton } from "@/components/chat/skeletons";
import { identityFromUnknown } from "@/lib/agent-identity";
import { isGroupChat, messageAuthor } from "@/lib/chat-members";
import { pendingToMessage, type PendingMessage } from "@/lib/chat-queue";
import { presentThread } from "@/lib/chat-stream";
import { isInboxMessage } from "@/lib/inbox-message";
import { useWorkspace } from "@/components/workspace-provider";

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
  workingAgentId,
  error,
  profileError,
  onProfile,
  onMembers,
  onSend,
  onStop,
  onClear,
  onCompact,
  onEditMessage,
  onDeleteMessage,
  onResendMessage,
  onRetryMessage,
  creator,
  headerActions,
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
  /** The agent answering right now, when the server says (group members take turns). */
  workingAgentId?: string | null;
  error: string | null;
  profileError: string | null;
  onProfile: (profileId: string | null) => void;
  /** Replace a group chat's members. Without it the chat shows no members control. */
  onMembers?: (memberIds: string[]) => Promise<void>;
  onSend: () => void;
  onStop: () => void;
  /** Remove every message. With `onCompact`, the header shows the chat actions menu. */
  onClear?: () => Promise<boolean>;
  /** Summarize the chat so far into one message the agent reads instead of the older ones. */
  onCompact?: () => Promise<boolean>;
  onEditMessage?: (messageId: string, content: string) => Promise<boolean>;
  onDeleteMessage?: (messageId: string, following: boolean) => Promise<boolean>;
  onResendMessage?: (messageId: string, content: string) => Promise<boolean>;
  onRetryMessage?: (messageId: string) => Promise<boolean>;
  creator?: Agent | null;
  /** Extra header controls after the members menu (the side panel toggle). */
  headerActions?: ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const identity = agent ? identityFromUnknown(agent) : null;
  const { agents } = useWorkspace();
  const group = isGroupChat(chat);
  // In a group chat a mention picks who answers, so every agent can be named, the owner too.
  const mentionables = group ? agents : agents.filter((other) => other.id !== agent?.id);
  const members = group && chat ? agents.filter((other) => chat.memberIds.includes(other.id)) : [];
  const workingAgent = (workingAgentId ? agents.find((other) => other.id === workingAgentId) : null) ?? agent;

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
  // The transcript is locked while the agent works or messages wait to be answered.
  const locked = working || pending.length > 0;
  const actionsFor = (message: ChatMessage): MessageActionHandlers | undefined => {
    if (!onDeleteMessage) return undefined;
    const user = message.role === "user";
    // Agent mail is not the human's to rewrite. It can still be copied or deleted.
    const mail = isInboxMessage(message);
    return {
      disabled: locked,
      onDelete: (following) => onDeleteMessage(message.id, following),
      ...(onEditMessage && !user ? { onEdit: (content: string) => onEditMessage(message.id, content) } : {}),
      ...(onResendMessage && user && !mail ? { onResend: (content: string) => onResendMessage(message.id, content) } : {}),
      ...(onRetryMessage && !user ? { onRetry: () => onRetryMessage(message.id) } : {}),
    };
  };
  const unavailable = Boolean(profileError && /unavailable/i.test(profileError));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ShellHeader
        center={<ChatAgentHeader agent={identity} title={chat.title} creator={creator} members={members} />}
        actions={
          <>
            {/* An agent's own chat stays one-on-one. Group chats are started from New chat. */}
            {agent && onMembers && group ? (
              <ChatMembersMenu
                owner={agent}
                agents={agents}
                memberIds={chat.memberIds}
                disabled={locked}
                onChange={onMembers}
              />
            ) : null}
            {onClear && onCompact ? (
              <ChatActionsMenu disabled={locked} empty={messages.length === 0} onClear={onClear} onCompact={onCompact} />
            ) : null}
            {headerActions}
          </>
        }
      />

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
          <div className="mx-auto flex h-full max-w-3xl flex-col items-center justify-center px-6 pb-16 text-center">
            {group && agent ? (
              <AgentStack agents={[agent, ...members]} size="xl" ring="ring-background" className="mb-4" />
            ) : identity ? (
              <AgentAvatar
                name={identity.name}
                icon={identity.icon}
                color={identity.color}
                shape={identity.shape}
                picture={identity.picture}
                size="xl"
                className="mb-4"
              />
            ) : null}
            <h2 className="text-3xl font-semibold tracking-tight">
              {group ? [identity?.name ?? "Agent", ...members.map((member) => member.name)].join(", ") : (identity?.name ?? "New chat")}
            </h2>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              {group
                ? "Everyone answers in turn. Mention an agent with @Name to ask only that agent."
                : identity?.description ||
                  "This is your one chat with this agent. Its routines, webhooks, and messages from other agents show up here too."}
            </p>
          </div>
        ) : (
          <div className="mx-auto flex min-h-full max-w-3xl flex-col justify-end gap-6 px-4 pt-2 pb-6">
            {rows.map((row, index) => {
              if (isCompactionMessage(row.message)) return <CompactionDivider key={row.key} message={row.message} />;
              if (row.message.role === "system") return null;
              const author = messageAuthor(row.message, chat, agents) ?? agent;
              return (
                <MessageBubble
                  key={row.key}
                  message={row.message}
                  agent={author}
                  showName={group}
                  continued={continuesRun(rows, index, author?.id ?? null, chat, agents)}
                  toolCalls={row.tools.length > 0 ? row.tools : undefined}
                  actions={actionsFor(row.message)}
                />
              );
            })}
            {working ? (
              <MessageBubble
                message={{ id: "working", chatId: chat.id, role: "assistant", content: "", createdAt: "" }}
                agent={workingAgent}
                showName={group}
                working
              />
            ) : null}
            {pending.map((row) => (
              <MessageBubble key={row.id} message={pendingToMessage(chat.id, row)} queued />
            ))}
            <p className="sr-only" aria-live="polite">
              {working ? `${workingAgent?.name ?? "The agent"} is working` : ""}
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
        placeholder={
          !profileReady
            ? "Choose a model profile to write"
            : group
              ? "Message the group…"
              : `Message ${identity?.name ?? "this agent"}…`
        }
        profiles={profiles}
        profileId={profileId}
        onProfile={onProfile}
        profileNeeded={!profileReady}
        mentionables={mentionables}
      />
    </div>
  );
}

/** A reply that follows another reply from the same agent drops its avatar and sits closer. */
function continuesRun(
  rows: ReturnType<typeof presentThread>,
  index: number,
  authorId: string | null,
  chat: Chat,
  agents: Agent[],
): boolean {
  const current = rows[index]?.message;
  const previous = rows[index - 1]?.message;
  if (!current || !previous || current.role === "user" || previous.role === "user") return false;
  if (previous.role === "system" || isCompactionMessage(previous)) return false;
  if (isInboxMessage(current) || isInboxMessage(previous)) return false;
  const previousAuthor = messageAuthor(previous, chat, agents)?.id ?? chat.agentId;
  return previousAuthor === (authorId ?? chat.agentId);
}
