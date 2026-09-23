import { relativeTime } from '../../lib/format'
import type { A2AMessage, Agent } from '../../lib/types'
import { Modal } from '../ui/Modal'
import { AgentAvatar } from '../ui/primitives'

export function InboxSheet({
  open,
  onClose,
  messages,
  agents,
  onRead,
}: {
  open: boolean
  onClose: () => void
  messages: A2AMessage[]
  agents: Agent[]
  onRead: (id: string) => void
}) {
  const map = new Map(agents.map((a) => [a.id, a]))
  return (
    <Modal open={open} onClose={onClose} title="Teammate inbox" wide>
      <p className="mb-3 text-[13px] text-mute">
        Async agent-to-agent notes. They never merge into the user thread.
      </p>
      <div className="max-h-80 space-y-1 overflow-y-auto scrollbar-thin">
        {messages.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-faint">Inbox is empty.</p>
        ) : (
          messages.map((m) => {
            const from = map.get(m.fromAgentId)
            const to = map.get(m.toAgentId)
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => onRead(m.id)}
                className="flex w-full items-start gap-3 rounded-md px-2 py-2 text-left hover:bg-hover"
              >
                <AgentAvatar name={from?.name ?? '?'} color={from?.color ?? '#8f9c93'} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="text-[13px] font-medium">
                      {from?.name ?? 'Agent'} → {to?.name ?? 'Agent'}
                    </span>
                    <span className="font-mono text-[10.5px] text-faint">
                      {relativeTime(m.createdAt)}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-[12.5px] text-mute">{m.preview}</span>
                </span>
                {!m.read ? <span className="mt-1.5 size-1.5 rounded-full bg-seed" /> : null}
              </button>
            )
          })
        )}
      </div>
    </Modal>
  )
}
