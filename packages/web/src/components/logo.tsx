import { cn } from "@/lib/utils";

export function Mark({ className }: { className?: string }) {
  // Brand colors live in the asset, so the mark looks the same in light and dark themes.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/logo.svg" alt="" aria-hidden className={cn("shrink-0", className)} />;
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-sans text-lg leading-none font-semibold tracking-tight", className)}>
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
