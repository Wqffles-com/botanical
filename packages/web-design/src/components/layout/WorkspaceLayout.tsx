import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AgentList } from '../agents/AgentList'
import { ChatList } from '../chat/ChatList'
import { InboxSheet } from '../chat/InboxSheet'
import { NewChatDialog } from '../chat/NewChatDialog'
import { ProfileGrid } from '../profiles/ProfilePicker'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/primitives'
import { useSession } from '../../state/session'
import { useWorkspace } from '../../state/workspace'
import { uid } from '../../lib/format'
import { AppShell } from './AppShell'

export function WorkspaceLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const { profileId, setProfileId } = useSession()
  const { agents, chats, a2a, profiles, createChat, saveAgent, markA2A } = useWorkspace()

  const [paneOpen, setPaneOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [agentQuery, setAgentQuery] = useState('')
  const [newChatOpen, setNewChatOpen] = useState(false)
  const [inboxOpen, setInboxOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [picked, setPicked] = useState(profileId)

  const isChats = location.pathname.startsWith('/chats')
  const isAgents = location.pathname.startsWith('/agents')
  const chatId = isChats ? location.pathname.split('/')[2] : undefined
  const agentId = isAgents ? location.pathname.split('/')[2] : undefined
  const unread = a2a.filter((m) => !m.read).length

  useEffect(() => {
    setPicked(profileId)
  }, [profileId])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey
      if (meta && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        setNewChatOpen(true)
      }
      if (meta && e.key === ',') {
        e.preventDefault()
        navigate('/settings')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])

  async function handleNewAgent() {
    const created = await saveAgent({
      id: uid('ag'),
      name: 'New agent',
      description: 'Describe this agent.',
      prompt: 'You are a Botanical agent.',
      tools: ['web-search'],
      color: '#8fca7a',
      createdAt: new Date().toISOString(),
    })
    navigate(`/agents/${created.id}`)
  }

  async function handlePickAgent(id: string) {
    const chat = await createChat(id)
    setNewChatOpen(false)
    setPaneOpen(false)
    navigate(`/chats/${chat.id}`)
  }

  const pane = isChats ? (
    <ChatList
      chats={chats}
      agents={agents}
      activeId={chatId}
      query={query}
      onQuery={setQuery}
      onSelect={(id) => {
        setPaneOpen(false)
        navigate(`/chats/${id}`)
      }}
      onNew={() => setNewChatOpen(true)}
    />
  ) : isAgents ? (
    <AgentList
      agents={agents}
      activeId={agentId}
      query={agentQuery}
      onQuery={setAgentQuery}
      onSelect={(id) => {
        setPaneOpen(false)
        navigate(`/agents/${id}`)
      }}
      onNew={() => void handleNewAgent()}
    />
  ) : undefined

  return (
    <>
      <AppShell
        pane={pane}
        paneOpen={paneOpen}
        onTogglePane={() => setPaneOpen((v) => !v)}
        onInbox={() => setInboxOpen(true)}
        unreadA2A={unread}
      />
      <NewChatDialog
        open={newChatOpen}
        onClose={() => setNewChatOpen(false)}
        agents={agents}
        onPick={(id) => void handlePickAgent(id)}
      />
      <InboxSheet
        open={inboxOpen}
        onClose={() => setInboxOpen(false)}
        messages={a2a}
        agents={agents}
        onRead={(id) => void markA2A(id)}
      />
      <Modal
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        title="Switch profile"
        wide
      >
        <p className="mb-3 text-[13px] text-mute">
          Explicit pick only. This changes the brain for the next turn — the agent stays.
        </p>
        <ProfileGrid
          profiles={profiles}
          selectedId={picked}
          onSelect={setPicked}
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setProfileOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={!picked}
            onClick={() => {
              if (picked) setProfileId(picked)
              setProfileOpen(false)
            }}
          >
            Use profile
          </Button>
        </div>
      </Modal>
      <ProfileSwitchBridge onOpen={() => setProfileOpen(true)} onNewChat={() => setNewChatOpen(true)} />
    </>
  )
}

function ProfileSwitchBridge({
  onOpen,
  onNewChat,
}: {
  onOpen: () => void
  onNewChat: () => void
}) {
  useEffect(() => {
    function handler(e: Event) {
      const detail = (e as CustomEvent<string>).detail
      if (detail === 'profile') onOpen()
      if (detail === 'new-chat') onNewChat()
    }
    window.addEventListener('botanical:ui', handler)
    return () => window.removeEventListener('botanical:ui', handler)
  }, [onOpen, onNewChat])
  return null
}
