"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { AgentAvatar } from "@/components/agent-avatar";
import { EmptyState } from "@/components/empty-state";
import { useWorkspace } from "@/components/workspace-provider";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { agentIdentity } from "@/lib/agent-identity";

export default function ChatPage() {
  const params = useParams<{ id: string }>();
  const { ready, chats, agents } = useWorkspace();
  const chat = chats.find((item) => item.id === params.id) ?? null;
  const agent = chat ? (agents.find((item) => item.id === chat.agentId) ?? null) : null;
  const identity = agent ? agentIdentity(agent) : null;

  if (!ready) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex h-12 items-center gap-3 border-b px-4">
          <Skeleton className="size-8 rounded-lg" />
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="flex-1 p-6">
          <Skeleton className="h-16 w-2/3" />
        </div>
      </div>
    );
  }

  if (!chat) {
    return (
      <EmptyState
        title="Chat not found"
        body="This thread is not in the workspace. Pick another from the sidebar or start a new one."
        action={
          <Button nativeButton={false} render={<Link href="/" />}>
            Back to agents
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 items-center gap-3 border-b px-4">
        {identity ? (
          <AgentAvatar icon={identity.icon} color={identity.color} name={identity.name} />
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{chat.title || "Untitled chat"}</div>
          <div className="truncate text-xs text-muted-foreground">
            {identity?.name ?? "Unknown agent"}
            {chat.profileId ? ` · profile ${chat.profileId}` : " · pick a model profile to send"}
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-6">
        <EmptyState
          className="min-h-[40vh]"
          title="Thread"
          body="Streaming messages, markdown, and tool cards land in the chat UI. Composer stays shut until a profile is picked."
        />
      </div>
      <div className="border-t p-3">
        <Textarea
          placeholder={chat.profileId ? "Message this agent…" : "Choose a model profile before sending."}
          disabled={!chat.profileId}
          rows={3}
        />
        <div className="mt-2 flex justify-end">
          <Button disabled>Send</Button>
        </div>
      </div>
    </div>
  );
}
