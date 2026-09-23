import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  deleteAgent as apiDeleteAgent,
  getChatMessages,
  listA2A,
  listAgents,
  listChats,
  listProfiles,
  readA2A,
  saveAgent as apiSaveAgent,
  startChat,
  streamMessage,
} from '../lib/api'
import { uid } from '../lib/format'
import type { A2AMessage, Agent, Chat, ChatMessage, Profile } from '../lib/types'
import { useSession } from './session'

interface WorkspaceValue {
  profiles: Profile[]
  agents: Agent[]
  chats: Chat[]
  a2a: A2AMessage[]
  messagesByChat: Record<string, ChatMessage[]>
  loading: boolean
  streamingChatId: string | null
  streamingMessageId: string | null
  refresh: () => Promise<void>
  loadMessages: (chatId: string) => Promise<void>
  createChat: (agentId: string) => Promise<Chat>
  send: (chatId: string, content: string) => Promise<void>
  stop: () => void
  saveAgent: (agent: Agent) => Promise<Agent>
  removeAgent: (id: string) => Promise<void>
  markA2A: (id: string) => Promise<void>
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null)

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { profileId } = useSession()
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [chats, setChats] = useState<Chat[]>([])
  const [a2a, setA2A] = useState<A2AMessage[]>([])
  const [messagesByChat, setMessagesByChat] = useState<Record<string, ChatMessage[]>>({})
  const [loading, setLoading] = useState(true)
  const [streamingChatId, setStreamingChatId] = useState<string | null>(null)
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null)
  const abortRef = useState<{ current: AbortController | null }>({ current: null })[0]

  const refresh = useCallback(async () => {
    const [p, a, c, inbox] = await Promise.all([
      listProfiles(),
      listAgents(),
      listChats(),
      listA2A(),
    ])
    setProfiles(p)
    setAgents(a)
    setChats(c)
    setA2A(inbox)
  }, [])

  useEffect(() => {
    refresh().finally(() => setLoading(false))
  }, [refresh])

  const loadMessages = useCallback(async (chatId: string) => {
    const msgs = await getChatMessages(chatId)
    setMessagesByChat((prev) => ({ ...prev, [chatId]: msgs }))
  }, [])

  const createChat = useCallback(
    async (agentId: string) => {
      if (!profileId) throw new Error('Profile required')
      const chat = await startChat(agentId, profileId)
      setChats((prev) => [chat, ...prev.filter((c) => c.id !== chat.id)])
      setMessagesByChat((prev) => ({ ...prev, [chat.id]: [] }))
      return chat
    },
    [profileId],
  )

  const stop = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setStreamingChatId(null)
    setStreamingMessageId(null)
  }, [abortRef])

  const send = useCallback(
    async (chatId: string, content: string) => {
      if (!profileId) throw new Error('Profile required')
      stop()
      const controller = new AbortController()
      abortRef.current = controller
      setStreamingChatId(chatId)

      const user: ChatMessage = {
        id: uid('m'),
        chatId,
        role: 'user',
        content,
        createdAt: new Date().toISOString(),
      }
      const assistant: ChatMessage = {
        id: uid('m'),
        chatId,
        role: 'assistant',
        content: '',
        createdAt: new Date().toISOString(),
        toolCalls: [],
      }
      setStreamingMessageId(assistant.id)
      setMessagesByChat((prev) => ({
        ...prev,
        [chatId]: [...(prev[chatId] ?? []), user, assistant],
      }))

      // The mock API also appends to the store. We stream events onto the local assistant copy.
      // Skip duplicating user/assistant from the store by consuming events only.
      try {
        for await (const event of streamMessage(
          chatId,
          content,
          profileId,
          controller.signal,
        )) {
          if (controller.signal.aborted) break
          setMessagesByChat((prev) => {
            const list = prev[chatId] ?? []
            const next = list.map((m) => {
              if (m.id !== assistant.id) return m
              if (event.type === 'text-delta') {
                return { ...m, content: m.content + event.text }
              }
              if (event.type === 'tool-call') {
                return {
                  ...m,
                  toolCalls: [
                    ...(m.toolCalls ?? []),
                    {
                      id: event.id,
                      name: event.name,
                      arguments: JSON.stringify(event.arguments),
                      status: 'running' as const,
                    },
                  ],
                }
              }
              if (event.type === 'tool-result') {
                return {
                  ...m,
                  toolCalls: (m.toolCalls ?? []).map((t) =>
                    t.id === event.id
                      ? { ...t, status: event.status, result: event.result }
                      : t,
                  ),
                }
              }
              return m
            })
            return { ...prev, [chatId]: next }
          })
          if (event.type === 'done' || event.type === 'error') break
        }
      } finally {
        setStreamingChatId(null)
        setStreamingMessageId(null)
        abortRef.current = null
        const latest = await listChats()
        setChats(latest)
      }
    },
    [abortRef, profileId, stop],
  )

  const saveAgent = useCallback(async (agent: Agent) => {
    const saved = await apiSaveAgent(agent)
    setAgents((prev) => {
      const exists = prev.some((a) => a.id === saved.id)
      return exists ? prev.map((a) => (a.id === saved.id ? saved : a)) : [saved, ...prev]
    })
    return saved
  }, [])

  const removeAgent = useCallback(async (id: string) => {
    await apiDeleteAgent(id)
    setAgents((prev) => prev.filter((a) => a.id !== id))
  }, [])

  const markA2A = useCallback(async (id: string) => {
    await readA2A(id)
    setA2A((prev) => prev.map((m) => (m.id === id ? { ...m, read: true } : m)))
  }, [])

  const value = useMemo(
    () => ({
      profiles,
      agents,
      chats,
      a2a,
      messagesByChat,
      loading,
      streamingChatId,
      streamingMessageId,
      refresh,
      loadMessages,
      createChat,
      send,
      stop,
      saveAgent,
      removeAgent,
      markA2A,
    }),
    [
      profiles,
      agents,
      chats,
      a2a,
      messagesByChat,
      loading,
      streamingChatId,
      streamingMessageId,
      refresh,
      loadMessages,
      createChat,
      send,
      stop,
      saveAgent,
      removeAgent,
      markA2A,
    ],
  )

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error('useWorkspace must be used within WorkspaceProvider')
  return ctx
}
