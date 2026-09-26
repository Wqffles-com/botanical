"use client";

import type { Agent, Chat, CreateChatInput, DeploymentMode, Me, ModelProfile } from "@botanical/core";
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
import { sortChats } from "@/lib/chat-groups";

type WorkspaceState = {
  ready: boolean;
  me: Me | null;
  agents: Agent[];
  chats: Chat[];
  profiles: ModelProfile[];
  error: string | null;
  refresh: () => Promise<void>;
  createChat: (input: CreateChatInput) => Promise<Chat>;
  renameChat: (id: string, title: string) => Promise<void>;
  deleteChat: (id: string) => Promise<void>;
  setChatProfile: (id: string, profileId: string) => Promise<void>;
};

const WorkspaceContext = createContext<WorkspaceState | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [profiles, setProfiles] = useState<ModelProfile[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [session, nextAgents, nextChats, nextProfiles] = await Promise.all([
        api.me(),
        api.listAgents(),
        api.listChats(),
        api.listProfiles(),
      ]);
      setMe(session);
      setAgents(nextAgents);
      setChats(nextChats);
      setProfiles(nextProfiles);
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

  const createChat = useCallback(async (input: CreateChatInput) => {
    const chat = await api.createChat(input);
    setChats((current) => sortChats([chat, ...current.filter((item) => item.id !== chat.id)]));
    return chat;
  }, []);

  const renameChat = useCallback(async (id: string, title: string) => {
    const updated = await api.updateChat(id, { title });
    setChats((current) =>
      sortChats(current.map((chat) => (chat.id === id ? { ...chat, title, ...(updated ?? {}) } : chat))),
    );
  }, []);

  const deleteChat = useCallback(async (id: string) => {
    await api.deleteChat(id);
    setChats((current) => current.filter((chat) => chat.id !== id));
  }, []);

  const setChatProfile = useCallback(
    async (id: string, profileId: string) => {
      let previous: string | null | undefined;
      setChats((current) =>
        current.map((chat) => {
          if (chat.id !== id) return chat;
          previous = chat.profileId;
          return { ...chat, profileId };
        }),
      );
      try {
        const updated = await api.updateChat(id, { profileId });
        if (updated) {
          setChats((current) => current.map((chat) => (chat.id === id ? updated : chat)));
        }
      } catch (cause) {
        setChats((current) =>
          current.map((chat) =>
            chat.id === id && previous !== undefined ? { ...chat, profileId: previous } : chat,
          ),
        );
        if (isUnauthorized(cause)) {
          router.replace("/login");
          return;
        }
        throw cause;
      }
    },
    [router],
  );

  const value = useMemo<WorkspaceState>(
    () => ({
      ready,
      me,
      agents,
      chats,
      profiles,
      error,
      refresh,
      createChat,
      renameChat,
      deleteChat,
      setChatProfile,
    }),
    [ready, me, agents, chats, profiles, error, refresh, createChat, renameChat, deleteChat, setChatProfile],
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
