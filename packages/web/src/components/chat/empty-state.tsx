import { Button } from "@/components/ui/button";
import { Sprout } from "lucide-react";
import type { ReactNode } from "react";

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <Sprout className="mb-3 size-8 text-primary" />
      <h2 className="font-heading text-2xl tracking-tight">{title}</h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">{body}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function EmptyChatAction({ onClick, label = "New chat" }: { onClick: () => void; label?: string }) {
  return (
    <Button onClick={onClick} data-testid="empty-new-chat">
      {label}
    </Button>
  );
}
