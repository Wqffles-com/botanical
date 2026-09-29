"use client";

import { PanelRight } from "lucide-react";
import { useParams } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { Button } from "@botanical/ui/components/button";
import { Sheet, SheetContent, SheetTitle } from "@botanical/ui/components/sheet";
import { useIsMobile } from "@botanical/ui/hooks/use-mobile";
import { ChatSidePanel } from "@/components/chat/chat-side-panel";
import { ChatThread } from "@/components/chat/chat-thread";
import { useWorkspace } from "@/components/workspace-provider";
import { useChatThread } from "@/hooks/use-chat-thread";

const PANEL_KEY = "botanical.chatPanel";
const panelListeners = new Set<() => void>();
/** Last choice this visit, so the toggle works when storage throws (private mode). */
let panelChoice: boolean | null = null;

/** Side panel open on wide screens unless the viewer closed it. Remembered per browser. */
function readPanelPref(): boolean {
  if (panelChoice !== null) return panelChoice;
  try {
    return window.localStorage.getItem(PANEL_KEY) !== "0";
  } catch {
    return true;
  }
}

function writePanelPref(open: boolean) {
  try {
    window.localStorage.setItem(PANEL_KEY, open ? "1" : "0");
  } catch {
    // Private mode: panelChoice still carries the choice for this visit.
  }
  panelChoice = open;
  for (const listener of panelListeners) listener();
}

function subscribePanelPref(listener: () => void) {
  panelListeners.add(listener);
  return () => panelListeners.delete(listener);
}

export default function ChatPage() {
  const params = useParams<{ id: string }>();
  const chatId = params.id;
  const thread = useChatThread(chatId);
  const { agents } = useWorkspace();
  const mobile = useIsMobile();
  const panelOpen = useSyncExternalStore(subscribePanelPref, readPanelPref, () => false);
  const [sheetOpen, setSheetOpen] = useState(false);

  function togglePanel() {
    if (mobile) setSheetOpen((open) => !open);
    else writePanelPref(!panelOpen);
  }

  const chat = thread.chat;
  const participants = chat
    ? [chat.agentId, ...chat.memberIds]
        .map((id) => (id === thread.agent?.id ? thread.agent : agents.find((agent) => agent.id === id)))
        .filter((agent): agent is NonNullable<typeof agent> => Boolean(agent))
    : [];
  const profile = thread.profiles.find((item) => item.id === thread.profileId) ?? null;
  const panel = chat ? (
    <ChatSidePanel chat={chat} participants={participants} messages={thread.messages} profile={profile} />
  ) : null;
  const expanded = mobile ? sheetOpen : panelOpen;

  return (
    <div className="flex h-full min-h-0">
      <div className="min-w-0 flex-1">
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
          workingAgentId={thread.workingAgentId}
          error={thread.error}
          profileError={thread.profileError}
          onProfile={(profileId) => void thread.setProfile(profileId)}
          onMembers={thread.setMembers}
          onSend={() => void thread.send()}
          onStop={thread.stop}
          onClear={thread.clear}
          onCompact={thread.compact}
          onEditMessage={thread.editMessage}
          onDeleteMessage={thread.deleteMessage}
          onResendMessage={thread.resend}
          onRetryMessage={thread.retry}
          creator={thread.creator}
          headerActions={
            panel ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={expanded ? "Hide side panel" : "Show side panel"}
                aria-pressed={expanded}
                data-testid="chat-panel-toggle"
                onClick={togglePanel}
              >
                <PanelRight />
              </Button>
            ) : null
          }
        />
      </div>
      {panel && !mobile && panelOpen ? <aside className="w-80 shrink-0 border-l">{panel}</aside> : null}
      {panel && mobile ? (
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetContent side="right" className="w-[85vw] gap-0 p-0 pt-10" showCloseButton>
            <SheetTitle className="sr-only">Chat details</SheetTitle>
            {panel}
          </SheetContent>
        </Sheet>
      ) : null}
    </div>
  );
}
