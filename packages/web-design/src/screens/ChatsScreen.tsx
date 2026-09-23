import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChatThread } from '../components/chat/ChatThread'
import { openNewChat, openProfileSwitcher } from '../lib/ui-events'
import { useSession } from '../state/session'
import { useWorkspace } from '../state/workspace'

export function ChatsScreen() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { profileId } = useSession()
  const {
    chats,
    agents,
    profiles,
    messagesByChat,
    loadMessages,
    send,
    stop,
    streamingMessageId,
    streamingChatId,
  } = useWorkspace()
  const [draft, setDraft] = useState('')

  const chat = chats.find((c) => c.id === id) ?? null
  const agent = chat ? agents.find((a) => a.id === chat.agentId) : undefined
  const profile = profiles.find((p) => p.id === profileId) ?? null
  const messages = id ? (messagesByChat[id] ?? []) : []

  useEffect(() => {
    if (id) void loadMessages(id)
  }, [id, loadMessages])

  useEffect(() => {
    setDraft('')
  }, [id])

  useEffect(() => {
    if (!id && chats[0]) navigate(`/chats/${chats[0].id}`, { replace: true })
  }, [id, chats, navigate])

  return (
    <ChatThread
      chat={chat}
      agent={agent}
      profile={profile}
      messages={messages}
      streamingId={streamingChatId === id ? streamingMessageId : null}
      draft={draft}
      onDraft={setDraft}
      onSend={() => {
        if (!id || !draft.trim()) return
        const text = draft
        setDraft('')
        void send(id, text)
      }}
      onStop={stop}
      onOpenProfile={openProfileSwitcher}
      onNew={openNewChat}
    />
  )
}
