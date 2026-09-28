import type { DeploymentMode } from "@botanical/core";
import { Cloud, House } from "lucide-react";
import { Badge } from "@botanical/ui/components/badge";
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
      variant={selfHost ? "secondary" : "info"}
      data-testid="mode-badge"
      className={cn(
        "gap-1.5 font-medium",
        large ? "h-7 px-2.5 text-xs" : "h-5 px-2 text-2xs",
        className,
      )}
    >
      {selfHost ? <House className="size-3.5" /> : <Cloud className="size-3.5" />}
      {selfHost ? "Self-host" : "SaaS"}
    </Badge>
  );
}
