import { Plus, Search } from 'lucide-react'
import { cn } from '../../lib/cn'
import { relativeTime } from '../../lib/format'
import type { Agent, Chat } from '../../lib/types'
import { AgentAvatar, Button, Input } from '../ui/primitives'

export function ChatList({
  chats,
  agents,
  activeId,
  query,
  onQuery,
  onSelect,
  onNew,
}: {
  chats: Chat[]
  agents: Agent[]
  activeId: string | undefined
  query: string
  onQuery: (q: string) => void
  onSelect: (id: string) => void
  onNew: () => void
}) {
  const agentMap = new Map(agents.map((a) => [a.id, a]))
  const filtered = chats.filter((c) => {
    if (!query.trim()) return true
    const q = query.toLowerCase()
    const agent = agentMap.get(c.agentId)
    return (
      c.title.toLowerCase().includes(q) ||
      c.preview.toLowerCase().includes(q) ||
      (agent?.name.toLowerCase().includes(q) ?? false)
    )
  })

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
          <Input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Search chats"
            className="h-8 pl-8"
          />
        </div>
        <Button size="sm" onClick={onNew} aria-label="New chat">
          <Plus className="size-3.5" />
          New
        </Button>
      </div>
      <div className="scrollbar-thin flex-1 overflow-y-auto px-2 pb-3">
        {filtered.length === 0 ? (
          <p className="px-2 py-6 text-center text-[12.5px] text-faint">No chats match.</p>
        ) : (
          filtered.map((chat) => {
            const agent = agentMap.get(chat.agentId)
            const active = chat.id === activeId
            return (
              <button
                key={chat.id}
                type="button"
                onClick={() => onSelect(chat.id)}
                className={cn(
                  'mb-0.5 flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left transition-colors',
                  active ? 'bg-hover' : 'hover:bg-hover/70',
                )}
              >
                <AgentAvatar
                  name={agent?.name ?? '?'}
                  color={agent?.color ?? '#8f9c93'}
                  size="sm"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[13px] font-medium">{chat.title}</span>
                    <span className="shrink-0 font-mono text-[10.5px] text-faint">
                      {relativeTime(chat.updatedAt)}
                    </span>
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5">
                    <span className="truncate text-[12px] text-mute">{chat.preview}</span>
                    {chat.unreadA2A > 0 ? (
                      <span className="ml-auto size-1.5 shrink-0 rounded-full bg-seed" />
                    ) : null}
                  </span>
                </span>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
