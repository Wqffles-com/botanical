import { Check, ChevronRight, FileText, Globe, LoaderCircle, SquareTerminal, Unplug } from 'lucide-react'
import { cn } from '../../lib/cn'
import type { ToolCall } from '../../lib/types'

function ToolIcon({ name }: { name: string }) {
  const cls = 'size-3.5 shrink-0 text-mute'
  if (name.includes('shell') || name.includes('exec')) return <SquareTerminal className={cls} />
  if (name.includes('file')) return <FileText className={cls} />
  if (name.includes('mcp')) return <Unplug className={cls} />
  return <Globe className={cls} />
}

export function ToolCallCard({ call }: { call: ToolCall }) {
  const running = call.status === 'running'
  return (
    <div
      className={cn(
        'my-2 overflow-hidden rounded-md border bg-raised/70 text-[12.5px]',
        running ? 'border-leaf/30' : 'border-line',
      )}
    >
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        {running ? (
          <LoaderCircle className="size-3.5 shrink-0 animate-spin text-leaf" />
        ) : (
          <Check className="size-3.5 shrink-0 text-leaf" />
        )}
        <ToolIcon name={call.name} />
        <span className="shrink-0 font-mono text-[12px] text-ink">{call.name}</span>
        <ChevronRight className="size-3 shrink-0 text-faint" />
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-faint">
          {call.arguments}
        </span>
        <span className="shrink-0 text-[11px] uppercase tracking-wide text-faint">
          {call.status}
        </span>
      </div>
      {call.result ? (
        <div className="border-t border-line px-2.5 py-1.5 font-mono text-[11.5px] text-mute">
          {call.result}
        </div>
      ) : null}
    </div>
  )
}
