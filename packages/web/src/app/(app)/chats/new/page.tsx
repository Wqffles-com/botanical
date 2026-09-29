"use client";

import { NewChatForm } from "@/components/chat/new-chat-form";
import { useWorkspace } from "@/components/workspace-provider";
import { errorText, isProfileRequired, profileRequiredMessage } from "@/lib/errors";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

function NewChatPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { agents, profiles, createChat, setChatProfile } = useWorkspace();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialAgentId = params.get("agentId");

  return (
    <NewChatForm
      agents={agents}
      profiles={profiles}
      initialAgentId={initialAgentId}
      pending={pending}
      error={error}
      onSubmit={async ({ agentId, memberIds, profileId, title }) => {
        setPending(true);
        setError(null);
        try {
          // Without members this opens the agent's own chat. If it already existed, switch it to the picked profile.
          const chat = await createChat({ agentId, memberIds, profileId, title: title.trim() || undefined });
          if (memberIds.length === 0 && chat.profileId !== profileId) await setChatProfile(chat.id, profileId);
          router.push(`/chats/${chat.id}`);
        } catch (err) {
          setError(isProfileRequired(err) ? profileRequiredMessage(err) : errorText(err));
          setPending(false);
        }
      }}
    />
  );
}

export default function NewChatPage() {
  return (
    <Suspense>
      <NewChatPageInner />
    </Suspense>
  );
}
