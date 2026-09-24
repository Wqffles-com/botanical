"use client";

import type { Agent, Chat } from "@botanical/core";
import {
  Cloud,
  House,
  Inbox,
  Plus,
  Search,
  Settings,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { AgentAvatar } from "@/components/agent-avatar";
import { Brand } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { useWorkspace } from "@/components/workspace-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { agentIdentity } from "@/lib/agent-identity";
import { relativeTime } from "@/lib/format";

export function AppSidebar() {
  const pathname = usePathname();
  const { ready, me, agents, chats } = useWorkspace();
  const [query, setQuery] = useState("");

  const activeChatId = pathname.startsWith("/chats/") ? pathname.split("/")[2] : undefined;
  const activeAgentId = useMemo(() => {
    if (pathname.startsWith("/agents/")) {
      const id = pathname.split("/")[2];
      if (id && id !== "new") return id;
    }
    if (activeChatId) {
      return chats.find((chat) => chat.id === activeChatId)?.agentId;
    }
    return agents[0]?.id;
  }, [pathname, activeChatId, chats, agents]);

  const filteredAgents = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter((agent) => {
      const id = agentIdentity(agent);
      return (
        id.name.toLowerCase().includes(q) ||
        id.description.toLowerCase().includes(q) ||
        chats.some(
          (chat) =>
            chat.agentId === agent.id &&
            chat.title.toLowerCase().includes(q),
        )
      );
    });
  }, [agents, chats, query]);

  const chatsByAgent = useMemo(() => {
    const map = new Map<string, Chat[]>();
    for (const chat of chats) {
      const list = map.get(chat.agentId) ?? [];
      list.push(chat);
      map.set(chat.agentId, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }
    return map;
  }, [chats]);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="gap-3 px-3 py-3">
        <div className="flex items-center justify-between gap-2 group-data-[collapsible=icon]:justify-center">
          <Link href="/" className="min-w-0">
            <span className="group-data-[collapsible=icon]:hidden">
              <Brand />
            </span>
            <span className="hidden group-data-[collapsible=icon]:inline-flex">
              <Brand compact />
            </span>
          </Link>
          <ThemeToggle className="group-data-[collapsible=icon]:hidden" />
        </div>
        <div className="relative group-data-[collapsible=icon]:hidden">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search agents"
            className="h-8 pl-8"
          />
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="flex items-center justify-between pr-1">
            <span>Agents</span>
            <Button
              nativeButton={false}
              render={<Link href="/agents/new" />}
              variant="ghost"
              size="icon-xs"
              aria-label="New agent"
              className="group-data-[collapsible=icon]:hidden"
            >
              <Plus className="size-3.5" />
            </Button>
          </SidebarGroupLabel>
          <SidebarGroupContent>
            {!ready ? (
              <div className="space-y-1 px-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : (
              <ScrollArea className="h-[calc(100svh-16rem)]">
                <SidebarMenu>
                  {filteredAgents.length === 0 ? (
                    <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                      {agents.length === 0 ? "No agents yet." : "No agents match."}
                    </p>
                  ) : (
                    filteredAgents.map((agent) => (
                      <AgentNavItem
                        key={agent.id}
                        agent={agent}
                        chats={chatsByAgent.get(agent.id) ?? []}
                        active={agent.id === activeAgentId}
                        activeChatId={activeChatId}
                      />
                    ))
                  )}
                </SidebarMenu>
              </ScrollArea>
            )}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarSeparator />
      <SidebarFooter className="gap-1">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={<Link href="/inbox" />}
              isActive={pathname.startsWith("/inbox")}
              tooltip="Inbox"
            >
              <Inbox />
              <span>Inbox</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={<Link href="/settings" />}
              isActive={pathname.startsWith("/settings")}
              tooltip="Settings"
            >
              <Settings />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <div className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground group-data-[collapsible=icon]:justify-center">
          {me?.mode === "SAAS" ? <Cloud className="size-3.5" /> : <House className="size-3.5" />}
          <span className="truncate group-data-[collapsible=icon]:hidden">
            {me?.brandName ?? "Botanical"} · {me?.mode === "SAAS" ? "SaaS" : "Self-host"}
          </span>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}

function AgentNavItem({
  agent,
  chats,
  active,
  activeChatId,
}: {
  agent: Agent;
  chats: Chat[];
  active: boolean;
  activeChatId: string | undefined;
}) {
  const identity = agentIdentity(agent);
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        render={<Link href={`/agents/${agent.id}`} />}
        isActive={active && !activeChatId}
        tooltip={identity.name}
      >
        <AgentAvatar icon={identity.icon} color={identity.color} name={identity.name} size="sm" />
        <span>{identity.name}</span>
      </SidebarMenuButton>
      {active ? (
        <SidebarMenuSub>
          <SidebarMenuSubItem>
            <SidebarMenuSubButton render={<Link href={`/agents/${agent.id}?compose=1`} />}>
              <Plus />
              <span>New chat</span>
            </SidebarMenuSubButton>
          </SidebarMenuSubItem>
          {chats.slice(0, 12).map((chat) => (
            <SidebarMenuSubItem key={chat.id}>
              <SidebarMenuSubButton
                render={<Link href={`/chats/${chat.id}`} />}
                isActive={chat.id === activeChatId}
              >
                <span className="min-w-0 flex-1 truncate">{chat.title || "Untitled chat"}</span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {relativeTime(chat.updatedAt)}
                </span>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          ))}
        </SidebarMenuSub>
      ) : chats.length > 0 ? (
        <SidebarMenuBadge>{chats.length}</SidebarMenuBadge>
      ) : null}
    </SidebarMenuItem>
  );
}
