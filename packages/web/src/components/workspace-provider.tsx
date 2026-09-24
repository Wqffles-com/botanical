"use client";

import type { Agent, Chat, DeploymentMode, Me } from "@botanical/core";
import { BotanicalApiError, isUnauthorized } from "@botanical/core";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api } from "@/lib/api";

type WorkspaceState = {
  ready: boolean;
  me: Me | null;
  agents: Agent[];
  chats: Chat[];
  error: string | null;
  refresh: () => Promise<void>;
};

const WorkspaceContext = createContext<WorkspaceState | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [session, nextAgents, nextChats] = await Promise.all([
        api.me(),
        api.listAgents(),
        api.listChats(),
      ]);
      setMe(session);
      setAgents(nextAgents);
      setChats(nextChats);
      setError(null);
    } catch (cause) {
      if (isUnauthorized(cause)) {
        router.replace("/login");
        return;
      }
      const message =
        cause instanceof BotanicalApiError ? cause.message : "Could not load the workspace.";
      setError(message);
    } finally {
      setReady(true);
    }
  }, [router]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<WorkspaceState>(
    () => ({ ready, me, agents, chats, error, refresh }),
    [ready, me, agents, chats, error, refresh],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceState {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error("useWorkspace must be used within WorkspaceProvider.");
  }
  return ctx;
}

export function useDeploymentMode(): DeploymentMode | null {
  return useWorkspace().me?.mode ?? null;
}
