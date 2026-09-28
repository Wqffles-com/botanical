import type * as React from "react"
import { cn } from "cn"

/**
 * Nothing here yet: a muted icon tile, a title, one sentence, and an optional action.
 * `bordered` draws a dashed frame for use inside a page section.
 */
function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  bordered = false,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>
  title: string
  body?: React.ReactNode
  action?: React.ReactNode
  bordered?: boolean
  className?: string
}) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex flex-col items-center justify-center px-6 py-10 text-center",
        bordered && "rounded-xl border border-dashed",
        className
      )}
    >
      {Icon ? (
        <div className="mb-4 flex size-10 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
          <Icon className="size-5" />
        </div>
      ) : null}
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      {body ? <p className="mt-1 max-w-sm text-sm text-muted-foreground">{body}</p> : null}
      {action ? <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  )
}

export { EmptyState }
