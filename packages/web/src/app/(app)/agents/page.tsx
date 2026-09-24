"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { useWorkspace } from "@/components/workspace-provider";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export default function AgentsIndexPage() {
  const router = useRouter();
  const { ready, agents } = useWorkspace();

  useEffect(() => {
    if (!ready) return;
    if (agents[0]) router.replace(`/agents/${agents[0].id}`);
  }, [ready, agents, router]);

  if (!ready) {
    return (
      <div className="p-8">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="mt-4 h-24 w-full" />
      </div>
    );
  }

  if (agents[0]) return null;

  return (
    <div className="p-8">
      <PageHeader title="Agents" description="Unlimited custom agents. One agent owns each chat." />
      <EmptyState
        className="min-h-[50vh]"
        title="Grow the first agent"
        body="Give it a name, a color, an icon, and a prompt. Chats stay bound to that agent."
        action={
          <Button nativeButton={false} render={<Link href="/agents/new" />}>
            New agent
          </Button>
        }
      />
    </div>
  );
}
