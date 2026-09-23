import type { Agent, Chat, ChatMessage, ModelProfile } from "@botanical/core";
import type { StreamingState } from "../state/model";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";
import { ProfileSelect } from "./ProfileSelect";

export function ChatThread({
  chat,
  agent,
  profiles,
  profileId,
  messages,
  streaming,
  onProfile,
  onSend,
  onStop,
}: {
  chat: Chat;
  agent: Agent | null;
  profiles: ModelProfile[];
  profileId: string | null;
  messages: ChatMessage[];
  streaming: StreamingState | null;
  onProfile: (profileId: string | null) => void;
  onSend: (content: string) => Promise<boolean>;
  onStop: () => void;
}) {
  const live = streaming?.chatId === chat.id ? streaming : null;
  return (
    <div className="bc-thread">
      <header className="bc-thread-head">
        <div className="bc-column bc-thread-title">
          <div>
            <h2>{chat.title}</h2>
            <p>Agent · {agent?.name ?? "Unknown agent"}</p>
          </div>
          <ProfileSelect id="thread-profile" profiles={profiles} value={profileId} onChange={onProfile} />
        </div>
      </header>
      {!profileId ? <p className="bc-hint">Choose a model profile for this chat.</p> : null}
      <MessageList messages={messages} streaming={live} />
      <Composer profileReady={Boolean(profileId)} streaming={Boolean(live)} onSend={onSend} onStop={onStop} />
    </div>
  );
}
