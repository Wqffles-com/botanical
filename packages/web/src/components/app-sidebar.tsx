"use client";

import type { Agent, Chat } from "@botanical/core";
import { CalendarClock, Inbox, Plus, Webhook } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { AgentAvatar } from "@/components/agent-avatar";
import { CommandMenu, CommandMenuButton } from "@/components/command-menu";
import { Mark } from "@/components/logo";
import { NavUser } from "@/components/nav-user";
import { useWorkspace } from "@/components/workspace-provider";
import { Button } from "@botanical/ui/components/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
} from "@botanical/ui/components/sidebar";
import { agentIdentity } from "@/lib/agent-identity";
import { relativeTime } from "@/lib/format";

const NAV = [
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/routines", label: "Routines", icon: CalendarClock },
  { href: "/listeners", label: "Listeners", icon: Webhook },
] as const;

export function AppSidebar() {
  const pathname = usePathname();
  const { ready, me, agents, chats, error } = useWorkspace();

  const activeChatId = pathname.startsWith("/chats/") ? pathname.split("/")[2] : undefined;
  const activeAgentId = useMemo(() => {
    if (pathname.startsWith("/agents/")) {
      const id = pathname.split("/")[2];
      if (id && id !== "new") return id;
    }
    return undefined;
  }, [pathname]);

  const recent = useMemo(
    () => [...chats].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 20),
    [chats],
  );

  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader className="gap-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/" />} className="hover:bg-transparent active:bg-transparent">
              <Mark className="size-8!" />
              <span className="grid min-w-0 flex-1 leading-tight">
                <span className="truncate font-semibold tracking-tight">Botanical</span>
                <span className="truncate text-xs text-muted-foreground">
                  {me?.brandName && me.brandName !== "Botanical"
                    ? me.brandName
                    : me?.mode === "SAAS"
                      ? "Hosted"
                      : "Self-host"}
                </span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <Button nativeButton={false} render={<Link href="/chats/new" />} className="w-full justify-start">
          <Plus />
          New chat
        </Button>
        <SidebarMenu>
          <SidebarMenuItem>
            <CommandMenu trigger={(open) => <CommandMenuButton onOpen={open} />} />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent className="scrollbar-thin">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map(({ href, label, icon: Icon }) => (
                <SidebarMenuItem key={href}>
                  <SidebarMenuButton render={<Link href={href} />} isActive={pathname.startsWith(href)} tooltip={label}>
                    <Icon />
                    <span>{label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel render={<Link href="/agents" />} className="hover:text-sidebar-foreground">
            Agents
          </SidebarGroupLabel>
          <SidebarGroupAction render={<Link href="/agents/new" />} title="New agent" aria-label="New agent">
            <Plus />
          </SidebarGroupAction>
          <SidebarGroupContent>
            <SidebarMenu>
              {!ready ? (
                Array.from({ length: 3 }, (_, index) => (
                  <SidebarMenuItem key={index}>
                    <SidebarMenuSkeleton showIcon />
                  </SidebarMenuItem>
                ))
              ) : agents.length === 0 ? (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">No agents yet.</p>
              ) : (
                agents.map((agent) => (
                  <AgentItem key={agent.id} agent={agent} active={agent.id === activeAgentId} />
                ))
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Recent</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {ready && recent.length === 0 ? (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">No chats yet.</p>
              ) : (
                recent.map((chat) => (
                  <RecentItem
                    key={chat.id}
                    chat={chat}
                    agent={agents.find((item) => item.id === chat.agentId) ?? null}
                    active={chat.id === activeChatId}
                  />
                ))
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {error ? <p className="px-4 pb-3 text-xs text-destructive">{error}</p> : null}
      </SidebarContent>

      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  );
}

function AgentItem({ agent, active }: { agent: Agent; active: boolean }) {
  const identity = agentIdentity(agent);
  const line =
    identity.title ||
    (agent.roles.length > 0 ? agent.roles.map((role) => role.name).join(", ") : identity.description);
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        size="lg"
        render={<Link href={`/agents/${agent.id}`} />}
        isActive={active}
        title={identity.description ? `${identity.name} — ${identity.description}` : identity.name}
        className="h-11"
      >
        <AgentAvatar
          icon={identity.icon}
          color={identity.color}
          shape={identity.shape}
          picture={identity.picture}
          name={identity.name}
          size="md"
        />
        <span className="grid min-w-0 flex-1 leading-tight">
          <span className="truncate font-medium">{identity.name}</span>
          {line ? <span className="truncate text-xs text-muted-foreground">{line}</span> : null}
        </span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function RecentItem({ chat, agent, active }: { chat: Chat; agent: Agent | null; active: boolean }) {
  const title = chat.title || "Untitled chat";
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        render={<Link href={`/chats/${chat.id}`} />}
        isActive={active}
        title={agent ? `${title} · ${agent.name}` : title}
        className="pr-12"
      >
        <span>{title}</span>
      </SidebarMenuButton>
      <SidebarMenuBadge className="font-normal text-muted-foreground tabular-nums">
        {relativeTime(chat.updatedAt)}
      </SidebarMenuBadge>
    </SidebarMenuItem>
  );
}
