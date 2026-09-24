"use client";

import {
  isUnauthorized,
  type Agent,
  type Chat,
  type CreateChatInput,
  type DeploymentMode,
  type ModelProfile,
} from "@botanical/core";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getClient, setClientToken } from "@/lib/api";
import { errorText } from "@/lib/errors";
import { clearSession, loadSession, saveSession } from "@/lib/session";
import { sortAgents, sortChats } from "@/lib/chat-groups";

export type WorkspaceStatus = "booting" | "anonymous" | "ready";

interface WorkspaceValue {
  status: WorkspaceStatus;
  mode: DeploymentMode | null;
  agents: Agent[];
  chats: Chat[];
  profiles: ModelProfile[];
  error: string | null;
  refresh: () => Promise<void>;
  createChat: (input: CreateChatInput) => Promise<Chat>;
  renameChat: (id: string, title: string) => Promise<void>;
  deleteChat: (id: string) => Promise<void>;
  setChatProfile: (id: string, profileId: string) => Promise<void>;
  login: (passcode: string) => Promise<void>;
  logout: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function useWorkspace(): WorkspaceValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return value;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = useState<WorkspaceStatus>("booting");
  const [mode, setMode] = useState<DeploymentMode | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [profiles, setProfiles] = useState<ModelProfile[]>([]);
  const [error, setError] = useState<string | null>(null);

  const failAuth = useCallback((err: unknown): boolean => {
    if (!isUnauthorized(err)) return false;
    setClientToken(null);
    clearSession();
    setStatus("anonymous");
    setAgents([]);
    setChats([]);
    setProfiles([]);
    return true;
  }, []);

  const loadWorkspace = useCallback(async () => {
    const api = getClient();
    const [nextAgents, nextProfiles, nextChats] = await Promise.all([
      api.listAgents(),
      api.listProfiles(),
      api.listChats(),
    ]);
    setAgents(sortAgents(nextAgents));
    setProfiles(nextProfiles);
    setChats(sortChats(nextChats));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const api = getClient();
      try {
        const health = await api.health();
        if (!cancelled) setMode(health.mode);
      } catch {
        // Health is optional during boot; /me decides auth.
      }
      try {
        const me = await api.me();
        if (cancelled) return;
        setMode(me.mode ?? null);
        await loadWorkspace();
        if (cancelled) return;
        setStatus("ready");
        setError(null);
      } catch (err) {
        if (cancelled) return;
        if (isUnauthorized(err)) {
          setClientToken(null);
          clearSession();
          setStatus("anonymous");
          return;
        }
        setStatus("anonymous");
        setError(errorText(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadWorkspace]);

  useEffect(() => {
    if (status === "booting") return;
    if (status === "anonymous" && pathname !== "/login") {
      router.replace("/login");
    }
    if (status === "ready" && pathname === "/login") {
      router.replace("/");
    }
  }, [status, pathname, router]);

  const refresh = useCallback(async () => {
    try {
      await loadWorkspace();
      setError(null);
    } catch (err) {
      if (!failAuth(err)) setError(errorText(err));
    }
  }, [failAuth, loadWorkspace]);

  const createChat = useCallback(
    async (input: CreateChatInput) => {
      const chat = await getClient().createChat(input);
      setChats((current) => sortChats([chat, ...current.filter((item) => item.id !== chat.id)]));
      return chat;
    },
    [],
  );

  const renameChat = useCallback(async (id: string, title: string) => {
    const updated = await getClient().updateChat(id, { title });
    setChats((current) =>
      sortChats(current.map((chat) => (chat.id === id ? { ...chat, title, ...(updated ?? {}) } : chat))),
    );
  }, []);

  const deleteChat = useCallback(async (id: string) => {
    await getClient().deleteChat(id);
    setChats((current) => current.filter((chat) => chat.id !== id));
  }, []);

  const setChatProfile = useCallback(async (id: string, profileId: string) => {
    setChats((current) => current.map((chat) => (chat.id === id ? { ...chat, profileId } : chat)));
    try {
      const updated = await getClient().updateChat(id, { profileId });
      if (updated) {
        setChats((current) => current.map((chat) => (chat.id === id ? updated : chat)));
      }
    } catch (err) {
      if (failAuth(err)) return;
    }
  }, [failAuth]);

  const login = useCallback(
    async (passcode: string) => {
      setError(null);
      const session = await getClient().login(passcode);
      if (session.token) {
        setClientToken(session.token);
        saveSession({ token: session.token, expiresAt: session.expiresAt });
      } else {
        setClientToken(loadSession()?.token ?? null);
      }
      const me = await getClient().me();
      setMode(me.mode ?? session.mode);
      await loadWorkspace();
      setStatus("ready");
    },
    [loadWorkspace],
  );

  const logout = useCallback(async () => {
    setClientToken(null);
    clearSession();
    setStatus("anonymous");
    setAgents([]);
    setChats([]);
    setProfiles([]);
    try {
      await getClient().logout();
    } catch {
      // Local session is already cleared.
    }
  }, []);

  const value = useMemo<WorkspaceValue>(
    () => ({
      status,
      mode,
      agents,
      chats,
      profiles,
      error,
      refresh,
      createChat,
      renameChat,
      deleteChat,
      setChatProfile,
      login,
      logout,
    }),
    [status, mode, agents, chats, profiles, error, refresh, createChat, renameChat, deleteChat, setChatProfile, login, logout],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
