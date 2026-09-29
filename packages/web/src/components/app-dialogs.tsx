"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { AgentEditorPage } from "@/components/agents/agent-editor-page";
import { SettingsPanels, type SettingsTab } from "@/components/settings/settings-view";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@botanical/ui/components/dialog";

interface AppDialogs {
  /** Open settings as a dialog over the current page. */
  openSettings: (tab?: SettingsTab) => void;
  /** Open an agent's settings, or the new-agent form with no id. */
  openAgent: (agentId?: string | null) => void;
}

const AppDialogsContext = createContext<AppDialogs | null>(null);

/** Settings and agent settings open as dialogs over whatever page is showing. */
export function AppDialogsProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null);
  // `undefined` is closed; `null` is the new-agent form.
  const [agentId, setAgentId] = useState<string | null | undefined>(undefined);

  const openSettings = useCallback((tab: SettingsTab = "general") => {
    setAgentId(undefined);
    setSettingsTab(tab);
  }, []);
  const openAgent = useCallback((id?: string | null) => {
    setSettingsTab(null);
    setAgentId(id ?? null);
  }, []);
  const value = useMemo(() => ({ openSettings, openAgent }), [openSettings, openAgent]);

  return (
    <AppDialogsContext.Provider value={value}>
      {children}
      <Dialog open={settingsTab !== null} onOpenChange={(open) => !open && setSettingsTab(null)}>
        <DialogContent
          data-testid="settings-dialog"
          className="flex h-[min(88svh,760px)] flex-col gap-0 overflow-hidden rounded-2xl bg-background p-0 sm:max-w-4xl"
        >
          <div className="shrink-0 border-b px-5 py-4 pr-12">
            <DialogTitle className="text-lg font-semibold">Settings</DialogTitle>
            <DialogDescription className="mt-1 text-xs">
              Profiles, memory, and roles live on the server. Keys never enter this browser.
            </DialogDescription>
          </div>
          <div className="min-h-0 flex-1">
            {settingsTab ? <SettingsPanels tab={settingsTab} onTab={setSettingsTab} layout="dialog" /> : null}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={agentId !== undefined} onOpenChange={(open) => !open && setAgentId(undefined)}>
        <DialogContent
          data-testid="agent-dialog"
          className="flex h-[min(88svh,860px)] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-2xl"
        >
          <DialogTitle className="sr-only">{agentId ? "Agent settings" : "New agent"}</DialogTitle>
          {agentId !== undefined ? (
            <AgentEditorPage
              agentId={agentId ?? undefined}
              layout="dialog"
              onDone={(next) => {
                setAgentId(undefined);
                if (next) router.push(next);
                router.refresh();
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </AppDialogsContext.Provider>
  );
}

export function useAppDialogs(): AppDialogs {
  const value = useContext(AppDialogsContext);
  if (!value) throw new Error("useAppDialogs must be used inside AppDialogsProvider");
  return value;
}
