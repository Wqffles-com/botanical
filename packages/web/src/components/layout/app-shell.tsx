"use client";

import { Inbox, Moon, Plus, Settings, Sprout, Sun } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { ChatList } from "@/components/chat/chat-list";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import type { ReactNode } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { chats, agents, status, logout, mode } = useWorkspace();
  const activeChatId = pathname.startsWith("/chats/") && !pathname.startsWith("/chats/new")
    ? pathname.split("/")[2]
    : undefined;

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader className="gap-2">
          <div className="flex items-center gap-2 px-2 py-1">
            <Sprout className="size-5 text-primary" />
            <span className="font-heading text-lg tracking-tight">Botanical</span>
          </div>
          <Button render={<Link href="/chats/new" data-testid="new-chat" />} className="w-full" size="sm">
            <Plus />
            New chat
          </Button>
        </SidebarHeader>
        <SidebarContent>
          <ChatList
            chats={chats}
            agents={agents}
            activeChatId={activeChatId}
            loading={status === "booting"}
          />
        </SidebarContent>
        <SidebarSeparator />
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton isActive={pathname.startsWith("/agents")} render={<Link href="/agents" />}>
                <Sprout />
                Agents
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton isActive={pathname.startsWith("/inbox")} render={<Link href="/inbox" />}>
                <Inbox />
                Inbox
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton isActive={pathname.startsWith("/settings")} render={<Link href="/settings" />}>
                <Settings />
                Settings
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <div className="flex items-center justify-between px-2 pb-1 text-[11px] text-muted-foreground">
            <span>{mode === "SAAS" ? "SaaS" : "Self-host"}</span>
            <span className="flex items-center gap-1">
              <ThemeToggle />
              <Button variant="ghost" size="xs" onClick={() => void logout()}>
                Log out
              </Button>
            </span>
          </div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="min-h-svh">
        <div className="flex h-12 items-center gap-2 border-b px-3 md:hidden">
          <SidebarTrigger />
          <span className="font-heading text-lg">Botanical</span>
        </div>
        <div className="min-h-0 flex-1">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label="Toggle theme"
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      {dark ? <Sun /> : <Moon />}
    </Button>
  );
}
