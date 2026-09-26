import type { ReactNode } from "react";
import { MessageAgentAvatar } from "@/components/chat/message-agent-avatar";
import type { AgentIdentity } from "@/lib/agent-identity";
import { cn } from "@/lib/utils";

export function AssistantMessageFrame({
  agent,
  children,
  className,
}: {
  agent?: Pick<AgentIdentity, "name" | "icon" | "color"> | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex gap-3", className)}>
      <MessageAgentAvatar agent={agent} />
      <div className="min-w-0 flex-1 pt-0.5">{children}</div>
    </div>
  );
}
