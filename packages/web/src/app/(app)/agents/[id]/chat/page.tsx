"use client";

import { useAppDialogs } from "@/components/app-dialogs";
import { Bot } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { EmptyState } from "@botanical/ui/components/empty-state";
import { Button } from "@botanical/ui/components/button";
import { Label } from "@botanical/ui/components/label";
import { pageContainerVariants } from "@botanical/ui/components/page-container";
import { PageHeader } from "@botanical/ui/components/page-header";
import { ProfileSelect } from "@/components/chat/profile-select";
import { ChatThreadSkeleton } from "@/components/chat/skeletons";
import { useWorkspace } from "@/components/workspace-provider";
import { api } from "@/lib/api";
import { agentDefaultProfileId, ownChat } from "@/lib/chat-groups";
import { errorText, isProfileRequired, profileRequiredMessage } from "@/lib/errors";

/**
 * Opens an agent's chat (one chat per agent). An existing chat opens at once. The first
 * time, the chat starts on the agent's default profile, or asks for one when it has none.
 */
export default function AgentChatPage() {
  const params = useParams<{ id: string }>();
  const agentId = params.id;
  const router = useRouter();
  const { ready, agents, chats, profiles, createChat, refresh } = useWorkspace();
  const { openSettings } = useAppDialogs();
  const agent = agents.find((item) => item.id === agentId) ?? null;
  const [asking, setAsking] = useState(false);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const looked = useRef<string | null>(null);

  useEffect(() => {
    if (!ready || !agent) return;
    const known = ownChat(agent.id, chats);
    if (known) {
      router.replace(`/chats/${known.id}`);
      return;
    }
    if (looked.current === agent.id) return;
    looked.current = agent.id;
    void (async () => {
      try {
        // A routine or webhook may have started the chat since the workspace loaded.
        const found = await api.getAgentChat(agent.id);
        if (found) {
          void refresh();
          router.replace(`/chats/${found.id}`);
          return;
        }
        const fallback = agentDefaultProfileId(agent, profiles);
        if (!fallback) {
          setAsking(true);
          return;
        }
        const chat = await createChat({ agentId: agent.id, profileId: fallback });
        router.replace(`/chats/${chat.id}`);
      } catch (err) {
        setError(isProfileRequired(err) ? profileRequiredMessage(err) : errorText(err));
        setAsking(true);
      }
    })();
  }, [ready, agent, chats, profiles, createChat, refresh, router]);

  if (!ready) return <ChatThreadSkeleton />;
  if (!agent) {
    return (
      <EmptyState
        icon={Bot}
        title="Agent not found"
        className="h-full"
        body="It may have been deleted, or the link is wrong."
      />
    );
  }
  if (!asking) return <ChatThreadSkeleton />;

  const start = async () => {
    if (!profileId) return;
    setPending(true);
    setError(null);
    try {
      const chat = await createChat({ agentId: agent.id, profileId });
      router.replace(`/chats/${chat.id}`);
    } catch (err) {
      setError(isProfileRequired(err) ? profileRequiredMessage(err) : errorText(err));
      setPending(false);
    }
  };

  return (
    <div className={pageContainerVariants({ size: "narrow", className: "flex flex-col gap-6" })}>
      <PageHeader
        title={`Chat with ${agent.name}`}
        description="Pick the model profile this chat runs on. You can switch it from the composer at any time."
      />
      <section className="space-y-2">
        <Label htmlFor="agent-chat-profile">Model profile</Label>
        {profiles.length === 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed px-4 py-3">
            <p className="text-sm text-muted-foreground">No model profiles yet.</p>
            <Button variant="outline" size="sm" onClick={() => openSettings("profiles")}>
              Create one
            </Button>
          </div>
        ) : (
          <ProfileSelect id="agent-chat-profile" profiles={profiles} value={profileId} onChange={setProfileId} />
        )}
      </section>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div>
        <Button data-testid="start-chat" disabled={!profileId || pending} onClick={() => void start()}>
          {pending ? "Starting…" : "Start chatting"}
        </Button>
      </div>
    </div>
  );
}
