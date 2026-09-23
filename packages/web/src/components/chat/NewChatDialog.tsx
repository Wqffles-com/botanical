import { useMemo, useState } from 'react'
import type { Agent } from '../../lib/types'
import { Modal } from '../ui/Modal'
import { AgentAvatar, Input } from '../ui/primitives'

export function NewChatDialog({
  open,
  onClose,
  agents,
  onPick,
}: {
  open: boolean
  onClose: () => void
  agents: Agent[]
  onPick: (agentId: string) => void
}) {
  const [q, setQ] = useState('')
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return agents
    return agents.filter(
      (a) =>
        a.name.toLowerCase().includes(s) || a.description.toLowerCase().includes(s),
    )
  }, [agents, q])

  return (
    <Modal open={open} onClose={onClose} title="New chat — pick an agent">
      <p className="mb-3 text-[13px] text-mute">
        One agent owns the thread. You can still switch model profiles later.
      </p>
      <Input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Filter agents"
        className="mb-3"
      />
      <div className="max-h-72 space-y-1 overflow-y-auto scrollbar-thin">
        {filtered.map((agent) => (
          <button
            key={agent.id}
            type="button"
            onClick={() => onPick(agent.id)}
            className="flex w-full items-start gap-3 rounded-md px-2 py-2 text-left hover:bg-hover"
          >
            <AgentAvatar name={agent.name} color={agent.color} />
            <span>
              <span className="block text-[13.5px] font-medium">{agent.name}</span>
              <span className="block text-[12.5px] text-mute">{agent.description}</span>
            </span>
          </button>
        ))}
        {filtered.length === 0 ? (
          <p className="py-6 text-center text-[12.5px] text-faint">No agents match.</p>
        ) : null}
      </div>
    </Modal>
  )
}
