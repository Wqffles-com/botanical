"use client";

import { ChatThread } from "@/components/chat/chat-thread";
import { useChatThread } from "@/hooks/use-chat-thread";
import { useParams } from "next/navigation";

export default function ChatPage() {
  const params = useParams<{ id: string }>();
  const chatId = params.id;
  const thread = useChatThread(chatId);

  return (
    <ChatThread
      chat={thread.chat}
      agent={thread.agent}
      profiles={thread.profiles}
      profileId={thread.profileId}
      profileReady={thread.profileReady}
      messages={thread.messages}
      loading={thread.loading}
      missing={thread.missing}
      draft={thread.draft}
      onDraft={thread.setDraft}
      pending={thread.pending}
      working={thread.working}
      error={thread.error}
      profileError={thread.profileError}
      onProfile={(profileId) => void thread.setProfile(profileId)}
      onSend={() => void thread.send()}
      onStop={thread.stop}
      onEditMessage={thread.editMessage}
      onDeleteMessage={thread.deleteMessage}
      onResendMessage={thread.resend}
      onRetryMessage={thread.retry}
      creator={thread.creator}
    />
  );
}
