import { cn } from "@/lib/utils";

export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("shrink-0", className)} aria-hidden>
      <rect width="32" height="32" rx="8" className="fill-foreground" />
      <path d="M16 24.5V12" className="stroke-background" strokeWidth="1.6" strokeLinecap="round" fill="none" />
      <path
        d="M16 15.2c-3.1-1.2-5-.6-6 1.1-.9 1.6.2 3.1 1.9 3.1 2.1 0 3.3-1.9 4.1-4.2Z"
        className="fill-background"
      />
      <path
        d="M16 14.4c2.9-1.3 5-.9 6 .8.9 1.7-.1 3.3-1.9 3.3-2.1 0-3.3-1.9-4.1-4.1Z"
        className="fill-background"
      />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-sans text-[1.15rem] leading-none font-semibold tracking-tight", className)}>
      Botanical
    </span>
  );
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <Mark className="size-7" />
      {!compact ? <Wordmark /> : null}
    </div>
  );
}
