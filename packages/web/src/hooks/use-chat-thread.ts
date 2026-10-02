"use client";

import {
  BotanicalApiError,
  isAbortError,
  withAttachments,
  type Chat,
  type ChatEvent,
  type ChatMessage,
} from "@botanical/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkspace } from "@/components/workspace-provider";
import { api } from "@/lib/api";
import {
  applyQueueStatus,
  markAccepted,
  mergeMessage,
  promptFor,
  removeMessages,
  replaceMessage,
  settlePending,
  type PendingMessage,
} from "@/lib/chat-queue";
import { acceptFiles, releasePending, toPending, type PendingFile } from "@/lib/attachments";
import { errorText, isProfileRequired, isProfileUnavailable, profileRequiredMessage, profileUnavailableText } from "@/lib/errors";
import { unavailableProfileHint } from "@/lib/format";
import { toast } from "sonner";

export function useChatThread(chatId: string) {
  const { chats, profiles, agents, setChatProfile, setChatMembers, refresh } = useWorkspace();
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
  const [attachments, setAttachments] = useState<PendingFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [working, setWorking] = useState(false);
  // The agent answering right now. Group members take turns.
  const [workingAgentId, setWorkingAgentId] = useState<string | null>(null);
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
    setWorkingAgentId(null);
    setDraft("");
    setAttachments([]);
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
      if (event.type === "message-updated") {
        setMessages((current) => replaceMessage(current, event.message));
        return;
      }
      if (event.type === "messages-deleted") {
        setMessages((current) => removeMessages(current, event.ids));
        return;
      }
      setPending((current) => applyQueueStatus(current, event));
      setWorking(event.running);
      setWorkingAgentId(event.running ? (event.agentId ?? null) : null);
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

  /** True when the chat has a usable profile to send with. */
  const canPost = useCallback(() => {
    if (unavailableProfileHint(profiles.find((item) => item.id === profileId) ?? null)) return false;
    if (!profileId) {
      setProfileError(profileRequiredMessage());
      return false;
    }
    return true;
  }, [profileId, profiles]);

  /** Queue `content` as the next user message. `restore` puts it back in the composer when the post fails. */
  const post = useCallback(
    async (content: string, restore: boolean) => {
      if (!profileId || !canPost()) return false;
      setError(null);
      setProfileError(null);
      const id = crypto.randomUUID();
      setPending((current) => [...current, { id, content, createdAt: new Date().toISOString(), posting: true }]);
      try {
        await api.queueMessage(chatId, { content, profileId, clientId: id });
        setPending((current) => markAccepted(current, id));
        return true;
      } catch (err) {
        setPending((current) => current.filter((row) => row.id !== id));
        if (restore) setDraft((current) => (current.trim() ? current : content));
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
    },
    [canPost, chatId, profileId, unavailableCopy],
  );

  const attach = useCallback(
    (files: File[]) => {
      const { accepted, errors } = acceptFiles(attachments, files);
      for (const message of new Set(errors)) toast.error(message);
      if (accepted.length === 0) return;
      setAttachments((current) => [...current, ...toPending(accepted, current.length)]);
    },
    [attachments],
  );

  const removeAttachment = useCallback((id: string) => {
    setAttachments((current) => {
      releasePending(current.filter((item) => item.id === id));
      return current.filter((item) => item.id !== id);
    });
  }, []);

  const send = useCallback(async () => {
    const text = draft.trim();
    if ((!text && attachments.length === 0) || !chat || uploading || !canPost()) return false;
    let content = text;
    if (attachments.length > 0) {
      setUploading(true);
      try {
        const files = await Promise.all(attachments.map((item) => api.uploadAgentFile(chat.agentId, item.file, item.name)));
        content = withAttachments(text, files);
      } catch (err) {
        toast.error(errorText(err));
        return false;
      } finally {
        setUploading(false);
      }
      releasePending(attachments);
      setAttachments([]);
    }
    setDraft("");
    return post(content, attachments.length === 0);
  }, [attachments, canPost, chat, draft, post, uploading]);

  /** Delete a message, or it and everything after it. */
  const deleteMessage = useCallback(
    async (messageId: string, following = false) => {
      try {
        const ids = await api.deleteMessage(chatId, messageId, { following });
        setMessages((current) => removeMessages(current, ids));
        return true;
      } catch (err) {
        toast.error(errorText(err));
        return false;
      }
    },
    [chatId],
  );

  /** Save new text for a message in place. The agent is not asked again. */
  const editMessage = useCallback(
    async (messageId: string, content: string) => {
      try {
        const message = await api.updateMessage(chatId, messageId, content);
        setMessages((current) => replaceMessage(current, message));
        return true;
      } catch (err) {
        toast.error(errorText(err));
        return false;
      }
    },
    [chatId],
  );

  /** Rewind to a user message and send `content` in its place, so the agent answers again. */
  const resend = useCallback(
    async (messageId: string, content: string) => {
      const text = content.trim();
      if (!text || !canPost()) return false;
      if (!(await deleteMessage(messageId, true))) return false;
      return post(text, false);
    },
    [canPost, deleteMessage, post],
  );

  /** Ask again for a reply: resend the user message it answers. */
  const retry = useCallback(
    async (messageId: string) => {
      const prompt = promptFor(messages, messageId);
      if (!prompt) return false;
      return resend(prompt.id, prompt.content);
    },
    [messages, resend],
  );

  /** Replace the chat's group members, and keep the page's copy in step. */
  const setMembers = useCallback(
    async (memberIds: string[]) => {
      try {
        const updated = await setChatMembers(chatId, memberIds);
        setRemoteChat(updated);
      } catch (err) {
        toast.error(errorText(err));
      }
    },
    [chatId, setChatMembers],
  );

  /** Remove every message. The agent starts fresh; its memories and files stay. */
  const clear = useCallback(async () => {
    try {
      const ids = await api.clearChat(chatId);
      setMessages((current) => removeMessages(current, ids));
      setError(null);
      return true;
    } catch (err) {
      toast.error(errorText(err));
      return false;
    }
  }, [chatId]);

  /** Summarize the chat so far. The agent reads the summary instead of the older messages. */
  const compact = useCallback(async () => {
    try {
      const summary = await api.compactChat(chatId, profileId ? { profileId } : {});
      setMessages((current) => mergeMessage(current, summary));
      toast.success("Conversation compacted");
      return true;
    } catch (err) {
      toast.error(errorText(err));
      return false;
    }
  }, [chatId, profileId]);

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
    attachments,
    attach,
    removeAttachment,
    uploading,
    pending,
    working,
    workingAgentId,
    error,
    profileError,
    setProfile,
    setMembers,
    send,
    stop,
    clear,
    compact,
    editMessage,
    deleteMessage,
    resend,
    retry,
  };
}
