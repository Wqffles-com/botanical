import {
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react'
import { cn } from '../../lib/cn'

type ButtonVariant = 'primary' | 'ghost' | 'quiet' | 'danger' | 'outline'
type ButtonSize = 'sm' | 'md' | 'icon'

export function Button({
  className,
  variant = 'primary',
  size = 'md',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
}) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:pointer-events-none',
        variant === 'primary' &&
          'bg-leaf text-leaf-ink hover:bg-leaf/90 disabled:bg-leaf/25 disabled:text-leaf-ink/50',
        variant !== 'primary' && 'disabled:opacity-35',
        variant === 'ghost' && 'text-ink hover:bg-hover',
        variant === 'quiet' && 'text-mute hover:bg-hover hover:text-ink',
        variant === 'danger' && 'text-rose hover:bg-rose/10',
        variant === 'outline' &&
          'border border-line bg-transparent text-ink hover:bg-hover',
        size === 'sm' && 'h-7 px-2.5 text-[12.5px]',
        size === 'md' && 'h-9 px-3.5 text-[13.5px]',
        size === 'icon' && 'size-8 p-0',
        className,
      )}
      {...props}
    />
  )
}

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-9 w-full rounded-md border border-line bg-canvas px-3 text-[13.5px] text-ink placeholder:text-faint hover:border-line-strong focus:border-leaf/60 focus:outline-none',
        className,
      )}
      {...props}
    />
  )
}

export function Textarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'w-full rounded-md border border-line bg-canvas px-3 py-2 text-[13.5px] text-ink placeholder:text-faint hover:border-line-strong focus:border-leaf/60 focus:outline-none',
        className,
      )}
      {...props}
    />
  )
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-baseline justify-between">
        <span className="text-[12.5px] font-medium text-mute">{label}</span>
        {hint ? <span className="text-[11.5px] text-faint">{hint}</span> : null}
      </span>
      {children}
    </label>
  )
}

export function Badge({
  children,
  tone = 'mute',
  className,
}: {
  children: ReactNode
  tone?: 'mute' | 'leaf' | 'seed' | 'sky' | 'rose' | 'lilac'
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium tracking-wide uppercase',
        tone === 'mute' && 'bg-hover text-mute',
        tone === 'leaf' && 'bg-leaf/15 text-leaf',
        tone === 'seed' && 'bg-seed/15 text-seed',
        tone === 'sky' && 'bg-sky/15 text-sky',
        tone === 'rose' && 'bg-rose/15 text-rose',
        tone === 'lilac' && 'bg-lilac/15 text-lilac',
        className,
      )}
    >
      {children}
    </span>
  )
}

export function Chip({
  children,
  selected,
  onClick,
  className,
}: {
  children: ReactNode
  selected?: boolean
  onClick?: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-7 items-center rounded-full border px-2.5 text-[12.5px] transition-colors',
        selected
          ? 'border-leaf/50 bg-leaf/15 text-ink'
          : 'border-line bg-transparent text-mute hover:border-line-strong hover:text-ink',
        className,
      )}
    >
      {children}
    </button>
  )
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] border border-line bg-raised px-1 font-mono text-[10px] text-mute">
      {children}
    </kbd>
  )
}

export function AgentAvatar({
  name,
  color,
  size = 'md',
}: {
  name: string
  color: string
  size?: 'sm' | 'md' | 'lg'
}) {
  const dim = size === 'sm' ? 'size-6 text-[10px]' : size === 'lg' ? 'size-10 text-sm' : 'size-8 text-[11px]'
  const letters = name
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-medium text-leaf-ink',
        dim,
      )}
      style={{ background: color }}
      aria-hidden
    >
      {letters}
    </span>
  )
}
