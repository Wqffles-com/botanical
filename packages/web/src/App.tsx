import { useState } from "react";
import { ChatList } from "./components/ChatList";
import { ChatThread } from "./components/ChatThread";
import { EmptyState } from "./components/EmptyState";
import { BootScreen, LoginScreen } from "./components/LoginScreen";
import { NewChatPanel } from "./components/NewChatPanel";
import { Shell } from "./components/Shell";
import { profileForChat } from "./state/model";
import { useChatApp } from "./state/useChatApp";

export function App() {
  const app = useChatApp();
  const [navOpen, setNavOpen] = useState(false);
  const { state } = app;

  if (state.status === "booting") return <BootScreen />;
  if (state.status === "anonymous") {
    return (
      <LoginScreen
        mode={state.mode}
        error={state.error}
        pending={state.busy === "login"}
        onSubmit={(password) => void app.login(password)}
      />
    );
  }

  const activeChat = state.chats.find((chat) => chat.id === state.activeChatId) ?? null;
  const activeAgent = activeChat ? (state.agents.find((agent) => agent.id === activeChat.agentId) ?? null) : null;

  let body;
  if (state.draft) {
    body = (
      <NewChatPanel
        agents={state.agents}
        profiles={state.profiles}
        draft={state.draft}
        pending={state.busy === "create"}
        agentPending={state.busy === "agent"}
        onSelectAgent={app.setDraftAgent}
        onSelectProfile={app.setDraftProfile}
        onTitle={app.setDraftTitle}
        onCreateAgent={app.createAgent}
        onSubmit={() => void app.createChat()}
        onCancel={() => {
          setNavOpen(false);
          app.cancelDraft();
        }}
      />
    );
  } else if (activeChat) {
    body = (
      <ChatThread
        chat={activeChat}
        agent={activeAgent}
        profiles={state.profiles}
        profileId={profileForChat(state)}
        messages={state.messages}
        streaming={state.streaming}
        onProfile={(profileId) => void app.setProfile(activeChat.id, profileId)}
        onSend={app.send}
        onStop={app.stop}
      />
    );
  } else {
    body = (
      <EmptyState
        onNew={() => {
          setNavOpen(false);
          app.openDraft();
        }}
      />
    );
  }

  return (
    <Shell
      mode={state.mode}
      navOpen={navOpen}
      onToggleNav={() => setNavOpen((open) => !open)}
      onLogout={() => void app.logout()}
      sidebar={
        <ChatList
          chats={state.chats}
          agents={state.agents}
          profiles={state.profiles}
          activeChatId={state.draft ? null : state.activeChatId}
          refreshing={state.busy === "refresh"}
          onNew={() => {
            setNavOpen(false);
            app.openDraft();
          }}
          onRefresh={() => void app.refresh()}
          onSelect={(chatId) => {
            setNavOpen(false);
            void app.openChat(chatId);
          }}
        />
      }
    >
      {state.error ? (
        <p role="alert" className="bc-banner bc-banner--inset" data-testid="app-error">
          {state.error}
        </p>
      ) : null}
      {body}
    </Shell>
  );
}
