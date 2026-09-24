import type { DeploymentMode } from "@botanical/core";
import { Cloud, House } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function DeploymentBadge({
  mode,
  large = false,
  className,
}: {
  mode: DeploymentMode | null | undefined;
  large?: boolean;
  className?: string;
}) {
  if (!mode) return null;
  const selfHost = mode === "SELF_HOST";
  return (
    <Badge
      variant={selfHost ? "secondary" : "default"}
      data-testid="mode-badge"
      className={cn(
        "gap-1.5 font-medium tracking-wide",
        large ? "h-8 px-3 text-[12.5px]" : "h-6 px-2 text-[11px] uppercase",
        !selfHost && "bg-amber-500/15 text-amber-800 dark:text-amber-200",
        className,
      )}
    >
      {selfHost ? <House className="size-3.5" /> : <Cloud className="size-3.5" />}
      {selfHost ? "Self-host" : "SaaS"}
    </Badge>
  );
}
