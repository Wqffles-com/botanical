import type { Agent, Chat, ModelProfile } from "@botanical/core";

export function ChatList({
  chats,
  agents,
  profiles,
  activeChatId,
  refreshing,
  onSelect,
  onNew,
  onRefresh,
}: {
  chats: Chat[];
  agents: Agent[];
  profiles: ModelProfile[];
  activeChatId: string | null;
  refreshing: boolean;
  onSelect: (chatId: string) => void;
  onNew: () => void;
  onRefresh: () => void;
}) {
  return (
    <div className="bc-chatlist">
      <div className="bc-chatlist-bar">
        <button type="button" className="bc-button" data-testid="new-chat" onClick={onNew}>
          New chat
        </button>
        <button type="button" className="bc-button bc-button--quiet" onClick={onRefresh} disabled={refreshing}>
          Refresh
        </button>
      </div>
      {chats.length === 0 ? (
        <p className="bc-muted">No chats yet.</p>
      ) : (
        <ul>
          {chats.map((chat) => {
            const agent = agents.find((item) => item.id === chat.agentId);
            const profile = profiles.find((item) => item.id === chat.profileId);
            const active = chat.id === activeChatId;
            return (
              <li key={chat.id}>
                <button
                  type="button"
                  data-testid="chat-row"
                  aria-current={active ? "true" : undefined}
                  className={active ? "is-active" : undefined}
                  onClick={() => onSelect(chat.id)}
                >
                  <span>{chat.title}</span>
                  <small>
                    {agent?.name ?? "Agent"}
                    {profile ? ` · ${profile.name}` : ""}
                  </small>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
