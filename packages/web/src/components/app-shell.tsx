"use client";

import { Suspense, type ReactNode } from "react";
import { AppBreadcrumbs } from "@/components/app-breadcrumbs";
import { AppSidebar } from "@/components/app-sidebar";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { WorkspaceProvider } from "@/components/workspace-provider";
import { Separator } from "@botanical/ui/components/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@botanical/ui/components/sidebar";

export function AppShell({ actions, children }: { actions?: ReactNode; children: ReactNode }) {
  return (
    <WorkspaceProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className="h-svh min-h-0 overflow-hidden">
          <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-1 data-vertical:h-4 data-vertical:self-center" />
            <div className="min-w-0 flex-1">
              <Suspense fallback={null}>
                <AppBreadcrumbs />
              </Suspense>
            </div>
            <div className="flex items-center gap-1">
              {actions}
              <NotificationBell />
            </div>
          </header>
          <div className="min-h-0 flex-1 overflow-auto">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </WorkspaceProvider>
  );
}
