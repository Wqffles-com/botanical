"use client";

import { AppShell } from "@/components/layout/app-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import type { ReactNode } from "react";

export default function AppLayout({ children }: { children: ReactNode }) {
  const { status } = useWorkspace();
  if (status === "booting") {
    return (
      <div className="flex h-svh">
        <div className="hidden w-64 border-r p-3 md:block">
          <Skeleton className="mb-3 h-8 w-full" />
          <Skeleton className="mb-2 h-8 w-5/6" />
          <Skeleton className="h-8 w-2/3" />
        </div>
        <div className="flex-1 p-6">
          <Skeleton className="h-10 w-64" />
        </div>
      </div>
    );
  }
  if (status === "anonymous") return null;
  return <AppShell>{children}</AppShell>;
}
