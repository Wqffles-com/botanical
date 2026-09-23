import { Plus, Search } from 'lucide-react'
import { cn } from '../../lib/cn'
import type { Agent } from '../../lib/types'
import { AgentAvatar, Button, Input } from '../ui/primitives'

export function AgentList({
  agents,
  activeId,
  query,
  onQuery,
  onSelect,
  onNew,
}: {
  agents: Agent[]
  activeId: string | undefined
  query: string
  onQuery: (q: string) => void
  onSelect: (id: string) => void
  onNew: () => void
}) {
  const filtered = agents.filter((a) => {
    if (!query.trim()) return true
    const q = query.toLowerCase()
    return a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q)
  })

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
          <Input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Search agents"
            className="h-8 pl-8"
          />
        </div>
        <Button size="sm" onClick={onNew}>
          <Plus className="size-3.5" />
          New
        </Button>
      </div>
      <div className="scrollbar-thin flex-1 overflow-y-auto px-2 pb-3">
        {filtered.map((agent) => {
          const active = agent.id === activeId
          return (
            <button
              key={agent.id}
              type="button"
              onClick={() => onSelect(agent.id)}
              className={cn(
                'mb-0.5 flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left',
                active ? 'bg-hover' : 'hover:bg-hover/70',
              )}
            >
              <AgentAvatar name={agent.name} color={agent.color} size="sm" />
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium">{agent.name}</span>
                <span className="block truncate text-[12px] text-mute">{agent.description}</span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
