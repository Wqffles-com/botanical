import type { ReactNode } from "react"
import { cn } from "cn"
import { Badge } from "@botanical/ui/components/badge"

export type StatusTone = "neutral" | "success" | "warning" | "danger" | "info" | "progress"

const VARIANT = {
  neutral: "outline",
  success: "success",
  warning: "warning",
  danger: "destructive",
  info: "info",
  progress: "info",
} as const

const DOT: Record<StatusTone, string> = {
  neutral: "bg-muted-foreground/60",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  info: "bg-info",
  progress: "bg-info motion-safe:animate-pulse",
}

/** A badge with a leading dot. The tone, not the label, picks the color. */
function StatusBadge({
  tone,
  children,
  className,
}: {
  tone: StatusTone
  children: ReactNode
  className?: string
}) {
  return (
    <Badge
      data-slot="status-badge"
      data-tone={tone}
      variant={VARIANT[tone]}
      className={cn("gap-1.5 font-medium", tone === "neutral" && "text-muted-foreground", className)}
    >
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", DOT[tone])} />
      {children}
    </Badge>
  )
}

export { StatusBadge }
