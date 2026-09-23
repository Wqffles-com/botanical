import { useEffect, useRef } from 'react'
import type { Agent, Chat, ChatMessage, Profile } from '../../lib/types'
import { EmptyState } from '../ui/Modal'
import { Badge, Button } from '../ui/primitives'
import { Composer } from './Composer'
import { MessageBubble } from './Message'

export function ChatThread({
  chat,
  agent,
  profile,
  messages,
  streamingId,
  draft,
  onDraft,
  onSend,
  onStop,
  onOpenProfile,
  onNew,
}: {
  chat: Chat | null
  agent: Agent | undefined
  profile: Profile | null
  messages: ChatMessage[]
  streamingId: string | null
  draft: string
  onDraft: (v: string) => void
  onSend: () => void
  onStop: () => void
  onOpenProfile: () => void
  onNew: () => void
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  useEffect(() => {
    const el = scroller.current
    if (!el || !stick.current) return
    el.scrollTop = el.scrollHeight
  }, [messages, streamingId])

  if (!chat || !agent) {
    return (
      <div className="flex h-full flex-col">
        <EmptyState
          title="Nothing growing yet"
          body="Start a thread with one agent. Profile is already locked for this session."
          action={
            <Button onClick={onNew}>New chat</Button>
          }
        />
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-4">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-medium">{chat.title}</div>
          <div className="truncate text-[11.5px] text-mute">
            {agent.name} · one agent per chat
          </div>
        </div>
        {profile ? (
          <button
            type="button"
            onClick={onOpenProfile}
            className="hidden items-center gap-2 rounded-full border border-line bg-canvas px-2.5 py-1 text-[12px] hover:border-line-strong sm:flex"
          >
            <span className="text-mute">Profile</span>
            <span className="font-medium">{profile.name}</span>
            <Badge tone="mute">{profile.model}</Badge>
          </button>
        ) : null}
      </header>

      <div
        ref={scroller}
        onScroll={() => {
          const el = scroller.current
          if (!el) return
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
        className="scrollbar-thin flex-1 overflow-y-auto"
      >
        {messages.length === 0 ? (
          <div className="mx-auto flex h-full max-w-[760px] flex-col items-center justify-center px-6 text-center">
            <h2 className="font-serif text-4xl tracking-tight">{agent.name}</h2>
            <p className="mt-2 max-w-md text-[14px] text-mute">{agent.description}</p>
            <p className="mt-4 text-[12px] text-faint">
              Profile {profile?.name ?? '—'} · {profile?.model}
            </p>
          </div>
        ) : (
          <div className="mx-auto flex min-h-full max-w-[760px] flex-col justify-end gap-5 px-4 py-6">
            {messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                agentName={agent.name}
                agentColor={agent.color}
                streaming={streamingId === m.id}
              />
            ))}
          </div>
        )}
      </div>

      <Composer
        value={draft}
        onChange={onDraft}
        onSubmit={onSend}
        onStop={onStop}
        streaming={Boolean(streamingId)}
        placeholder={`Message ${agent.name}…`}
        profile={profile}
        onOpenProfile={onOpenProfile}
      />
    </div>
  )
}
