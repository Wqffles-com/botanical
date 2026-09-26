"use client";

import { Inbox } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { WorkspaceProvider } from "@/components/workspace-provider";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";

export function AppShell({
  title,
  actions,
  children,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <WorkspaceProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-4" />
            <div className="min-w-0 flex-1 truncate text-sm font-medium">{title}</div>
            <div className="flex items-center gap-1">
              {actions}
              <Button
                nativeButton={false}
                render={<Link href="/inbox" />}
                variant="ghost"
                size="icon-sm"
                aria-label="Inbox"
              >
                <Inbox className="size-4" />
              </Button>
              <ThemeToggle />
            </div>
          </header>
          <div className="min-h-0 flex-1 overflow-auto">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </WorkspaceProvider>
  );
}
