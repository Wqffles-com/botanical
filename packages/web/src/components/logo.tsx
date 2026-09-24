import { cn } from "@/lib/utils";

export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("shrink-0", className)} aria-hidden>
      <rect width="32" height="32" rx="8" className="fill-card" />
      <rect
        x="0.5"
        y="0.5"
        width="31"
        height="31"
        rx="7.5"
        className="stroke-primary/40"
        fill="none"
      />
      <path
        d="M16 25.5V13.5"
        className="stroke-primary"
        strokeWidth="1.7"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M16 16.2c-2.4-1.1-4.3-1-5.6.2-1.2 1.1-.8 2.8.6 3.2 1.7.4 3.4-.7 5-3.4Z"
        className="fill-primary"
      />
      <path
        d="M16 15.4c2.2-1.4 4.2-1.5 5.6-.2 1.3 1.2.8 3-.6 3.3-1.8.4-3.5-.9-5-3.1Z"
        fill="#B7E09A"
      />
      <circle cx="16" cy="12.2" r="1.35" fill="#d4b07a" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-heading text-[1.35rem] leading-none tracking-tight", className)}>
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
