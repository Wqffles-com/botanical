"use client";

import type { Agent, Chat } from "@botanical/core";
import { CalendarClock, Inbox, Plus, Search, Settings, Webhook } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { AgentAvatar } from "@/components/agent-avatar";
import { Mark } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { useWorkspace } from "@/components/workspace-provider";
import { Button } from "@botanical/ui/components/button";
import { Input } from "@botanical/ui/components/input";
import { ScrollArea } from "@botanical/ui/components/scroll-area";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@botanical/ui/components/sidebar";
import { Skeleton } from "@botanical/ui/components/skeleton";
import { agentIdentity } from "@/lib/agent-identity";
import { initials, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export function AppSidebar() {
  const pathname = usePathname();
  const { ready, me, agents, chats, error } = useWorkspace();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const activeChatId = pathname.startsWith("/chats/") ? pathname.split("/")[2] : undefined;
  const activeAgentId = useMemo(() => {
    if (pathname.startsWith("/agents/")) {
      const id = pathname.split("/")[2];
      if (id && id !== "new") return id;
    }
    if (activeChatId) return chats.find((chat) => chat.id === activeChatId)?.agentId;
    return undefined;
  }, [pathname, activeChatId, chats]);

  const filteredAgents = useMemo(() => {
    if (!q) return agents;
    return agents.filter((agent) => {
      const identity = agentIdentity(agent);
      const roles = agent.roles.map((role) => role.name).join(" ");
      return (
        identity.name.toLowerCase().includes(q) ||
        identity.title.toLowerCase().includes(q) ||
        identity.description.toLowerCase().includes(q) ||
        roles.toLowerCase().includes(q)
      );
    });
  }, [agents, q]);

  const recent = useMemo(() => {
    const sorted = [...chats].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (!q) return sorted.slice(0, 20);
    return sorted
      .filter((chat) => {
        const agent = agents.find((item) => item.id === chat.agentId);
        return chat.title.toLowerCase().includes(q) || (agent?.name.toLowerCase().includes(q) ?? false);
      })
      .slice(0, 20);
  }, [agents, chats, q]);

  const owner = me?.brandName ?? "Botanical";

  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader className="gap-3 border-b px-3 py-3">
        <Link href="/" className="flex min-w-0 items-center gap-2.5">
          <Mark className="size-8" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold tracking-tight">Botanical</span>
            <span className="block truncate text-xs text-muted-foreground">
              {me?.mode === "SAAS" ? "Hosted desk" : "Self-host"}
            </span>
          </span>
        </Link>
        <Button nativeButton={false} render={<Link href="/chats/new" />} className="w-full justify-start">
          <Plus />
          New chat
        </Button>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            aria-label="Search agents and chats"
            className="h-8 bg-background pl-8"
          />
        </div>
      </SidebarHeader>

      <SidebarContent>
        <ScrollArea className="h-full">
          <div className="px-3 py-3">
            <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">Agents</p>
            {!ready ? (
              <div className="space-y-1 px-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : filteredAgents.length === 0 ? (
              <p className="px-2 py-2 text-xs text-muted-foreground">
                {agents.length === 0 ? "No agents yet." : "No agents match."}
              </p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {filteredAgents.map((agent) => (
                  <AgentRow key={agent.id} agent={agent} active={agent.id === activeAgentId && !activeChatId} />
                ))}
              </ul>
            )}

            <p className="px-2 pt-4 pb-1 text-xs font-medium text-muted-foreground">Recent</p>
            {recent.length === 0 ? (
              <p className="px-2 py-2 text-xs text-muted-foreground">
                {chats.length === 0 ? "No chats yet." : "No chats match."}
              </p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {recent.map((chat) => (
                  <RecentRow
                    key={chat.id}
                    chat={chat}
                    agent={agents.find((item) => item.id === chat.agentId) ?? null}
                    active={chat.id === activeChatId}
                  />
                ))}
              </ul>
            )}
            {error ? <p className="px-2 pt-3 text-xs text-destructive">{error}</p> : null}
          </div>
        </ScrollArea>
      </SidebarContent>

      <SidebarFooter className="border-t p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton render={<Link href="/inbox" />} isActive={pathname.startsWith("/inbox")} tooltip="Inbox">
              <Inbox />
              <span>Inbox</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton render={<Link href="/routines" />} isActive={pathname.startsWith("/routines")} tooltip="Routines">
              <CalendarClock />
              <span>Routines</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton render={<Link href="/listeners" />} isActive={pathname.startsWith("/listeners")} tooltip="Listeners">
              <Webhook />
              <span>Listeners</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <div className="flex items-center gap-2 px-1 py-1">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md border text-xs font-medium">
            {initials(owner)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm leading-tight font-medium">{owner}</p>
            <p className="truncate text-xs leading-tight text-muted-foreground">
              {me?.mode === "SAAS" ? "Hosted" : "Desk owner"}
            </p>
          </div>
          <ThemeToggle />
          <Button
            nativeButton={false}
            render={<Link href="/settings" />}
            variant="ghost"
            size="icon-sm"
            aria-label="Settings"
          >
            <Settings className="size-4" />
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}

function AgentRow({ agent, active }: { agent: Agent; active: boolean }) {
  const identity = agentIdentity(agent);
  const line =
    identity.title ||
    (agent.roles.length > 0 ? agent.roles.map((role) => role.name).join(", ") : identity.description);
  return (
    <li>
      <Link
        href={`/agents/${agent.id}`}
        aria-current={active ? "page" : undefined}
        title={identity.description ? `${identity.name} — ${identity.description}` : identity.name}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-sidebar-accent",
          active && "bg-sidebar-accent",
        )}
      >
        <AgentAvatar
          icon={identity.icon}
          color={identity.color}
          shape={identity.shape}
          picture={identity.picture}
          name={identity.name}
          size="sm"
        />
        <span className="min-w-0">
          <span className="block truncate text-sm leading-tight font-medium">{identity.name}</span>
          {line ? <span className="mt-0.5 block truncate text-xs leading-tight text-muted-foreground">{line}</span> : null}
        </span>
      </Link>
    </li>
  );
}

function RecentRow({ chat, agent, active }: { chat: Chat; agent: Agent | null; active: boolean }) {
  const identity = agent ? agentIdentity(agent) : null;
  return (
    <li>
      <Link
        href={`/chats/${chat.id}`}
        aria-current={active ? "page" : undefined}
        title={chat.title || "Untitled chat"}
        className={cn(
          "flex w-full flex-col gap-0.5 rounded-lg px-2 py-1.5 text-left hover:bg-sidebar-accent",
          active && "bg-sidebar-accent",
        )}
      >
        <span className="flex items-center gap-2">
          <span className={cn("min-w-0 flex-1 truncate text-sm", active && "font-medium")}>
            {chat.title || "Untitled chat"}
          </span>
          <time className="shrink-0 text-[11px] whitespace-nowrap text-muted-foreground tabular-nums">
            {relativeTime(chat.updatedAt)}
          </time>
        </span>
        <span className="truncate text-xs text-muted-foreground">{identity?.name ?? "Agent"}</span>
      </Link>
    </li>
  );
}
