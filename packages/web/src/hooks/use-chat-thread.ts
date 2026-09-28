"use client";

import { BotanicalApiError, isAbortError, type Chat, type ChatEvent, type ChatMessage } from "@botanical/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkspace } from "@/components/workspace-provider";
import { api } from "@/lib/api";
import {
  applyQueueStatus,
  markAccepted,
  mergeMessage,
  settlePending,
  type PendingMessage,
} from "@/lib/chat-queue";
import { errorText, isProfileRequired, isProfileUnavailable, profileRequiredMessage, profileUnavailableText } from "@/lib/errors";
import { unavailableProfileHint } from "@/lib/format";
import { toast } from "sonner";

export function useChatThread(chatId: string) {
  const { chats, profiles, agents, setChatProfile, refresh } = useWorkspace();
  const [remoteChat, setRemoteChat] = useState<Chat | null>(null);
  const chat = chats.find((item) => item.id === chatId) ?? remoteChat;
  const agent = chat ? (agents.find((item) => item.id === chat.agentId) ?? null) : null;
  const creator = agent?.createdByAgentId
    ? (agents.find((item) => item.id === agent.createdByAgentId) ?? null)
    : null;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const workingRef = useRef(false);

  const profileId = chat?.profileId ?? null;
  const profileReady = Boolean(profileId);
  const [loadedChatId, setLoadedChatId] = useState(chatId);
  if (loadedChatId !== chatId) {
    setLoadedChatId(chatId);
    setLoading(true);
    setMissing(false);
    setRemoteChat(null);
    setError(null);
    setProfileError(null);
    setMessages([]);
    setPending([]);
    setWorking(false);
    setDraft("");
  }

  useEffect(() => {
    let cancelled = false;
    void Promise.all([api.listMessages(chatId), api.getChat(chatId)])
      .then(([next, found]) => {
        if (cancelled) return;
        setRemoteChat(found);
        setMessages(next);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled || isAbortError(err)) return;
        const text = errorText(err);
        if (/not found/i.test(text)) setMissing(true);
        else setError(text);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [chatId]);

  // Queue status and finished replies. Reconnects with backoff and refetches the
  // transcript after a gap, so nothing sent while disconnected is missed.
  useEffect(() => {
    const ac = new AbortController();
    workingRef.current = false;
    const resync = () =>
      api
        .listMessages(chatId)
        .then((next) => {
          if (!ac.signal.aborted) setMessages(next);
        })
        .catch(() => undefined);
    const handle = (event: ChatEvent) => {
      if (event.type === "message") {
        setMessages((current) => mergeMessage(current, event.message));
        setPending((current) => settlePending(current, event.queuedId));
        return;
      }
      if (event.type === "error") {
        setError(event.error);
        return;
      }
      setPending((current) => applyQueueStatus(current, event));
      setWorking(event.running);
      if (workingRef.current && !event.running) {
        void resync();
        void refresh();
      }
      workingRef.current = event.running;
    };
    void (async () => {
      let attempt = 0;
      while (!ac.signal.aborted) {
        try {
          for await (const event of api.chatEvents(chatId, { signal: ac.signal })) {
            attempt = 0;
            handle(event);
          }
        } catch (err) {
          if (ac.signal.aborted || isAbortError(err)) return;
          if (err instanceof BotanicalApiError && (err.status === 404 || err.status === 401)) return;
        }
        await new Promise((resolve) => setTimeout(resolve, Math.min(15_000, 1_000 * 2 ** attempt)));
        attempt += 1;
        if (!ac.signal.aborted) await resync();
      }
    })();
    return () => ac.abort();
  }, [chatId, refresh]);

  const setProfile = useCallback(
    async (next: string | null) => {
      if (!next) {
        setProfileError(profileRequiredMessage());
        return;
      }
      setProfileError(null);
      try {
        await setChatProfile(chatId, next);
      } catch (err) {
        setProfileError(isProfileRequired(err) ? profileRequiredMessage(err) : errorText(err));
      }
    },
    [chatId, setChatProfile],
  );

  const unavailableCopy = useCallback(
    (error: unknown) => {
      if (!isProfileUnavailable(error)) return null;
      const profile = profiles.find((item) => item.id === profileId);
      return profileUnavailableText(profile?.name ?? "This profile", errorText(error));
    },
    [profileId, profiles],
  );

  const send = useCallback(async () => {
    const content = draft.trim();
    if (!content) return false;
    if (unavailableProfileHint(profiles.find((item) => item.id === profileId) ?? null)) return false;
    if (!profileId) {
      setProfileError(profileRequiredMessage());
      return false;
    }
    setError(null);
    setProfileError(null);
    const id = crypto.randomUUID();
    setPending((current) => [...current, { id, content, createdAt: new Date().toISOString(), posting: true }]);
    setDraft("");
    try {
      await api.queueMessage(chatId, { content, profileId, clientId: id });
      setPending((current) => markAccepted(current, id));
      return true;
    } catch (err) {
      setPending((current) => current.filter((row) => row.id !== id));
      setDraft((current) => (current.trim() ? current : content));
      if (isProfileRequired(err)) {
        setProfileError(profileRequiredMessage(err));
        return false;
      }
      const unavailable = unavailableCopy(err);
      if (unavailable) {
        setProfileError(unavailable);
        toast.error(unavailable);
        return false;
      }
      setError(errorText(err));
      return false;
    }
  }, [chatId, draft, profileId, profiles, unavailableCopy]);

  const stop = useCallback(() => {
    void api.stopChat(chatId).catch((err: unknown) => setError(errorText(err)));
  }, [chatId]);

  return {
    chat,
    agent,
    creator,
    profiles,
    profileId,
    profileReady,
    messages,
    loading,
    missing,
    draft,
    setDraft,
    pending,
    working,
    error,
    profileError,
    setProfile,
    send,
    stop,
  };
}
