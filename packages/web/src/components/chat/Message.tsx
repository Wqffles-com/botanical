import { cn } from '../../lib/cn'
import type { ChatMessage } from '../../lib/types'
import { AgentAvatar } from '../ui/primitives'
import { ToolCallCard } from './ToolCallCard'

function renderContent(content: string) {
  const parts = content.split(/(```[\s\S]*?```)/g)
  return parts.map((part, i) => {
    const fence = part.match(/^```(\w+)?\n?([\s\S]*?)```$/)
    if (fence) {
      return (
        <pre
          key={i}
          className="my-2 overflow-x-auto rounded-md border border-line bg-canvas px-3 py-2 font-mono text-[12.5px] leading-relaxed text-ink"
        >
          {fence[1] ? (
            <div className="mb-1.5 text-[10.5px] uppercase tracking-wide text-faint">{fence[1]}</div>
          ) : null}
          <code>{fence[2]}</code>
        </pre>
      )
    }
    return (
      <span key={i} className="whitespace-pre-wrap">
        {decorateInline(part)}
      </span>
    )
  })
}

function decorateInline(text: string) {
  const bits = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g)
  return bits.map((bit, i) => {
    if (bit.startsWith('`') && bit.endsWith('`')) {
      return (
        <code
          key={i}
          className="rounded-[4px] bg-hover px-1 py-0.5 font-mono text-[12.5px] text-seed"
        >
          {bit.slice(1, -1)}
        </code>
      )
    }
    if (bit.startsWith('**') && bit.endsWith('**')) {
      return (
        <strong key={i} className="font-medium text-ink">
          {bit.slice(2, -2)}
        </strong>
      )
    }
    return bit
  })
}

export function MessageBubble({
  message,
  agentName,
  agentColor,
  streaming,
}: {
  message: ChatMessage
  agentName: string
  agentColor: string
  streaming?: boolean
}) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[min(72%,40rem)] rounded-2xl rounded-br-md bg-raised px-3.5 py-2.5 text-[14.5px] leading-relaxed text-ink hairline">
          <div className="whitespace-pre-wrap">{message.content}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-3">
      <AgentAvatar name={agentName} color={agentColor} size="sm" />
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="mb-1 text-[11.5px] font-medium uppercase tracking-wide text-faint">
          {agentName}
        </div>
        {message.toolCalls?.map((call) => (
          <ToolCallCard key={call.id} call={call} />
        ))}
        <div className={cn('text-[14.5px] leading-[1.55] text-ink')}>
          {renderContent(message.content)}
          {streaming ? <span className="stream-caret" aria-hidden /> : null}
        </div>
      </div>
    </div>
  )
}
