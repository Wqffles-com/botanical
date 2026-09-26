"use client";

import { isAbortError, type Chat, type ChatMessage } from "@botanical/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkspace } from "@/components/workspace-provider";
import { api } from "@/lib/api";
import { applyStreamEvent, draftToMessage, emptyDraft, type StreamDraft } from "@/lib/chat-stream";
import { errorText, isProfileRequired, profileRequiredMessage } from "@/lib/errors";

export function useChatThread(chatId: string) {
  const { chats, profiles, agents, setChatProfile, refresh } = useWorkspace();
  const [remoteChat, setRemoteChat] = useState<Chat | null>(null);
  const chat = chats.find((item) => item.id === chatId) ?? remoteChat;
  const agent = chat ? (agents.find((item) => item.id === chat.agentId) ?? null) : null;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState<StreamDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const profileId = chat?.profileId ?? null;
  const profileReady = Boolean(profileId);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMissing(false);
    setRemoteChat(null);
    setError(null);
    setProfileError(null);
    abortRef.current?.abort();
    void (async () => {
      try {
        const [next, found] = await Promise.all([api.listMessages(chatId), api.getChat(chatId)]);
        if (cancelled) return;
        setRemoteChat(found);
        setMessages(next);
      } catch (err) {
        if (cancelled || isAbortError(err)) return;
        const text = errorText(err);
        if (/not found/i.test(text)) setMissing(true);
        else setError(text);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, [chatId]);

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

  const send = useCallback(async () => {
    const content = draft.trim();
    if (!content || streaming) return false;
    if (!profileId) {
      setProfileError(profileRequiredMessage());
      return false;
    }
    setError(null);
    setProfileError(null);
    const userMessage: ChatMessage = {
      id: `local-user-${crypto.randomUUID()}`,
      chatId,
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    };
    setMessages((current) => [...current, userMessage]);
    setDraft("");
    const ac = new AbortController();
    abortRef.current = ac;
    let live = emptyDraft(chatId);
    setStreaming(live);
    let sawEvent = false;
    try {
      for await (const event of api.streamMessage(chatId, { content, profileId }, { signal: ac.signal })) {
        sawEvent = true;
        if (event.type === "error") {
          if (isProfileRequired(event.error)) {
            setProfileError(profileRequiredMessage(event.error));
            setStreaming(null);
            return true;
          }
          live = applyStreamEvent(live, event);
          setStreaming(null);
          if (live.content || live.toolCalls.length) {
            setMessages((current) => [...current, draftToMessage(live)]);
          }
          setError(event.error);
          return true;
        }
        live = applyStreamEvent(live, event);
        setStreaming({ ...live });
      }
      const assistant = draftToMessage(live);
      setStreaming(null);
      setMessages((current) => [...current, assistant]);
      try {
        const [serverMessages] = await Promise.all([api.listMessages(chatId), refresh()]);
        if (serverMessages.some((message) => message.role === "user" && message.content === content)) {
          setMessages(serverMessages);
        }
      } catch {
        // Keep the local transcript if refresh fails.
      }
      return true;
    } catch (err) {
      if (isAbortError(err)) {
        if (live.content || live.toolCalls.length) {
          setMessages((current) => [...current, draftToMessage(live)]);
        }
        setStreaming(null);
        return sawEvent;
      }
      if (!sawEvent) {
        setMessages((current) => current.filter((message) => message.id !== userMessage.id));
        setDraft(content);
      } else if (live.content || live.toolCalls.length) {
        setMessages((current) => [...current, draftToMessage(live)]);
      }
      setStreaming(null);
      if (isProfileRequired(err)) {
        setProfileError(profileRequiredMessage(err));
        return false;
      }
      setError(errorText(err));
      return sawEvent;
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
    }
  }, [chatId, draft, profileId, refresh, streaming]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return {
    chat,
    agent,
    profiles,
    profileId,
    profileReady,
    messages,
    loading,
    missing,
    draft,
    setDraft,
    streaming,
    error,
    profileError,
    setProfile,
    send,
    stop,
  };
}
