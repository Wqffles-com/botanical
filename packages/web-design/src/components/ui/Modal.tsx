import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '../../lib/cn'
import { Button } from './primitives'

export function Modal({
  open,
  onClose,
  title,
  wide,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  wide?: boolean
  children: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 bg-canvas/70 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className={cn(
          'relative w-full rounded-lg border border-line bg-panel shadow-2xl fade-up hairline',
          wide ? 'max-w-xl' : 'max-w-md',
        )}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 id="modal-title" className="font-serif text-lg tracking-tight">
            {title}
          </h2>
          <Button variant="quiet" size="icon" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </Button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  )
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string
  body: string
  action?: ReactNode
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
      <h2 className="font-serif text-3xl tracking-tight text-ink">{title}</h2>
      <p className="mt-2 max-w-sm text-[13.5px] text-mute">{body}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}
