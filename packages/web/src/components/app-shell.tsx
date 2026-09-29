"use client";

import { createContext, Suspense, useContext, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AppBreadcrumbs } from "@/components/app-breadcrumbs";
import { AppDialogsProvider } from "@/components/app-dialogs";
import { AppSidebar } from "@/components/app-sidebar";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { WorkspaceProvider } from "@/components/workspace-provider";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@botanical/ui/components/sidebar";

interface HeaderSlots {
  center: HTMLElement | null;
  actions: HTMLElement | null;
}

const HeaderSlotsContext = createContext<HeaderSlots>({ center: null, actions: null });

/**
 * Put page controls in the shell header: `center` replaces the breadcrumb (the chat's agent pill),
 * `actions` sit before the notification bell. One header per page, never two stacked.
 */
export function ShellHeader({ center, actions }: { center?: ReactNode; actions?: ReactNode }) {
  const slots = useContext(HeaderSlotsContext);
  return (
    <>
      {center && slots.center ? createPortal(center, slots.center) : null}
      {actions && slots.actions ? createPortal(actions, slots.actions) : null}
    </>
  );
}

export function AppShell({ actions, children }: { actions?: ReactNode; children: ReactNode }) {
  const [center, setCenter] = useState<HTMLElement | null>(null);
  const [slotActions, setSlotActions] = useState<HTMLElement | null>(null);

  return (
    <WorkspaceProvider>
      <AppDialogsProvider>
        <SidebarProvider style={{ "--sidebar-width": "18rem" } as CSSProperties}>
          <AppSidebar />
          <SidebarInset className="h-svh min-h-0 overflow-hidden">
            <HeaderSlotsContext.Provider value={{ center, actions: slotActions }}>
              <header className="group/header grid h-14 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-3">
                <div className="flex min-w-0 items-center gap-2">
                  <SidebarTrigger className="size-8 rounded-full text-muted-foreground hover:text-foreground" />
                  {/* The breadcrumb steps aside when a page fills the center slot. */}
                  <div className="min-w-0 flex-1 group-has-[[data-header-center]>*]/header:hidden">
                    <Suspense fallback={null}>
                      <AppBreadcrumbs />
                    </Suspense>
                  </div>
                </div>
                <div ref={setCenter} data-header-center className="flex min-w-0 justify-center" />
                <div className="flex items-center justify-end gap-1">
                  <div ref={setSlotActions} className="flex items-center gap-1 empty:hidden" />
                  {actions}
                  <NotificationBell />
                </div>
              </header>
              <div className="min-h-0 flex-1 overflow-auto">{children}</div>
            </HeaderSlotsContext.Provider>
          </SidebarInset>
        </SidebarProvider>
      </AppDialogsProvider>
    </WorkspaceProvider>
  );
}
