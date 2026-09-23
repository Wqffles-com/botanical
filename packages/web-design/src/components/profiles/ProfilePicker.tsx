import { Check, Eye, Wrench } from 'lucide-react'
import { cn } from '../../lib/cn'
import { costLabel, providerLabel } from '../../lib/format'
import type { Profile } from '../../lib/types'
import { Badge } from '../ui/primitives'

export function ProfileCard({
  profile,
  selected,
  onSelect,
  index,
}: {
  profile: Profile
  selected: boolean
  onSelect: () => void
  index?: number
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'group flex w-full flex-col items-start rounded-lg border p-3.5 text-left transition-colors hairline',
        selected
          ? 'border-leaf/55 bg-leaf/8'
          : 'border-line bg-panel hover:border-line-strong hover:bg-raised',
      )}
    >
      <span className="flex w-full items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          {index != null ? (
            <span className="font-mono text-[11px] text-faint">{index + 1}</span>
          ) : null}
          <span className="text-[15px] font-medium tracking-tight">{profile.name}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <Badge tone={profile.costTier === 'high' ? 'rose' : profile.costTier === 'mid' ? 'seed' : 'leaf'}>
            {costLabel(profile.costTier)}
          </Badge>
          {selected ? <Check className="size-4 text-leaf" /> : null}
        </span>
      </span>
      <span className="mt-1 text-[13px] text-mute">{profile.description}</span>
      <span className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11.5px] text-faint">
        <span>{providerLabel(profile.provider)}</span>
        <span className="text-line-strong">·</span>
        <span>{profile.model}</span>
      </span>
      <span className="mt-2 flex gap-1.5">
        {profile.capabilities.tools ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-mute">
            <Wrench className="size-3" /> tools
          </span>
        ) : (
          <span className="text-[11px] text-faint">no tools</span>
        )}
        {profile.capabilities.vision ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-mute">
            <Eye className="size-3" /> vision
          </span>
        ) : null}
      </span>
    </button>
  )
}

export function ProfileGrid({
  profiles,
  selectedId,
  onSelect,
}: {
  profiles: Profile[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  return (
    <div className="grid gap-2.5 sm:grid-cols-2">
      {profiles.map((p, i) => (
        <ProfileCard
          key={p.id}
          profile={p}
          selected={p.id === selectedId}
          onSelect={() => onSelect(p.id)}
          index={i}
        />
      ))}
    </div>
  )
}
