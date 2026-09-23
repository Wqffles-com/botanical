import { Cloud, House } from 'lucide-react'
import type { DeploymentMode } from '../../lib/types'
import { cn } from '../../lib/cn'

export function DeploymentBadge({
  mode,
  large = false,
}: {
  mode: DeploymentMode
  large?: boolean
}) {
  const selfHost = mode === 'self-host'
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border font-medium tracking-wide',
        large ? 'h-8 px-3 text-[12.5px]' : 'h-6 px-2 text-[11px] uppercase',
        selfHost
          ? 'border-line bg-hover text-mute'
          : 'border-seed/30 bg-seed/12 text-seed',
      )}
    >
      {selfHost ? <House className="size-3.5" /> : <Cloud className="size-3.5" />}
      {selfHost ? 'Self-host' : 'SaaS'}
    </span>
  )
}
