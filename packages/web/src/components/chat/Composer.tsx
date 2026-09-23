import { useEffect, useRef, type FormEvent, type KeyboardEvent } from 'react'
import { ChevronDown, Send, Square } from 'lucide-react'
import { cn } from '../../lib/cn'
import type { Profile } from '../../lib/types'
import { Button } from '../ui/primitives'

export function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  streaming,
  disabled,
  placeholder,
  profile,
  onOpenProfile,
}: {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  onStop: () => void
  streaming: boolean
  disabled?: boolean
  placeholder: string
  profile: Profile | null
  onOpenProfile: () => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [value])

  function handleKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!streaming && value.trim()) onSubmit()
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (streaming) onStop()
    else if (value.trim()) onSubmit()
  }

  return (
    <form onSubmit={handleSubmit} className="px-4 pb-4 pt-2">
      <div
        className={cn(
          'mx-auto flex max-w-[760px] flex-col rounded-xl border bg-panel hairline',
          disabled ? 'border-line opacity-60' : 'border-line-strong focus-within:border-leaf/45',
        )}
      >
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKey}
          placeholder={placeholder}
          disabled={disabled || streaming}
          rows={1}
          className="max-h-[200px] min-h-[44px] w-full bg-transparent px-3.5 pt-3 pb-1 text-[14.5px] leading-relaxed text-ink placeholder:text-faint focus:outline-none disabled:cursor-not-allowed"
        />
        <div className="flex items-center gap-2 px-2 pb-2">
          <button
            type="button"
            onClick={onOpenProfile}
            className="inline-flex h-7 items-center gap-1 rounded-full border border-line bg-canvas px-2 text-[12px] text-mute hover:border-line-strong hover:text-ink"
          >
            <span className="size-1.5 rounded-full bg-leaf" />
            {profile ? profile.name : 'Pick profile'}
            <ChevronDown className="size-3" />
          </button>
          <span className="ml-auto flex items-center gap-2">
            <span className="hidden text-[11px] text-faint sm:inline">
              Enter to send · Shift+Enter newline
            </span>
            {streaming ? (
              <Button type="button" variant="outline" size="icon" onClick={onStop} aria-label="Stop">
                <Square className="size-3.5 fill-current" />
              </Button>
            ) : (
              <Button
                type="submit"
                size="icon"
                disabled={disabled || !value.trim()}
                aria-label="Send"
              >
                <Send className="size-3.5" />
              </Button>
            )}
          </span>
        </div>
      </div>
    </form>
  )
}
