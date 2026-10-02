"use client";

import type { Agent, Chat } from "@botanical/core";
import { CalendarClock, Gauge, Inbox, Moon, Plus, Search, Settings, SquarePen, Sun, Webhook } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useMemo } from "react";
import { AgentAvatar } from "@/components/agent-avatar";
import { useAppDialogs } from "@/components/app-dialogs";
import { CommandMenu } from "@/components/command-menu";
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
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
} from "@botanical/ui/components/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@botanical/ui/components/tooltip";
import { agentIdentity } from "@/lib/agent-identity";
import { agentChatHref, groupChats, ownChat } from "@/lib/chat-groups";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/routines", label: "Routines", icon: CalendarClock },
  { href: "/listeners", label: "Listeners", icon: Webhook },
  { href: "/usage", label: "Usage", icon: Gauge },
] as const;

/** Round icon button for the sidebar's top and bottom rows. */
function RoundButton({ label, children, ...props }: React.ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={label}
            className="size-9 rounded-full bg-sidebar-accent/60 text-sidebar-foreground hover:bg-sidebar-accent"
            {...props}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function AppSidebar() {
  const pathname = usePathname();
  const { ready, me, agents, chats, error } = useWorkspace();
  const { openAgent, openSettings } = useAppDialogs();
  const { resolvedTheme, setTheme } = useTheme();

  const activeChatId = pathname.startsWith("/chats/") ? pathname.split("/")[2] : undefined;
  // An agent is active on its chat, the page that opens it, and its settings.
  const activeAgentId = useMemo(() => {
    if (pathname.startsWith("/agents/")) {
      const id = pathname.split("/")[2];
      if (id && id !== "new") return id;
    }
    const chat = activeChatId ? chats.find((item) => item.id === activeChatId) : undefined;
    return chat && ownChat(chat.agentId, chats)?.id === chat.id ? chat.agentId : undefined;
  }, [pathname, activeChatId, chats]);

  const groups = useMemo(() => groupChats(chats).slice(0, 20), [chats]);
  const brand = me?.brandName && me.brandName !== "Botanical" ? me.brandName : "Botanical";

  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader className="gap-3 px-3 pt-3">
        <div className="flex items-center gap-2">
          <Link href="/" className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-1" aria-label={`${brand} home`}>
            <Mark className="size-7 shrink-0" />
            <span className="truncate text-[0.9375rem] font-semibold tracking-tight">{brand}</span>
          </Link>
          <CommandMenu
            trigger={(open) => (
              <RoundButton label="Search (⌘K)" onClick={open} data-testid="sidebar-search">
                <Search />
              </RoundButton>
            )}
          />
          <RoundButton label="New chat" nativeButton={false} render={<Link href="/chats/new" />}>
            <SquarePen />
          </RoundButton>
        </div>
      </SidebarHeader>

      <SidebarContent className="scrollbar-thin gap-0 px-1">
        <SidebarGroup className="pb-1">
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map(({ href, label, icon: Icon }) => (
                <SidebarMenuItem key={href}>
                  <SidebarMenuButton
                    render={<Link href={href} />}
                    isActive={pathname.startsWith(href)}
                    tooltip={label}
                    className="h-9 rounded-lg text-sidebar-foreground/80"
                  >
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
          <SidebarGroupAction title="New agent" aria-label="New agent" onClick={() => openAgent(null)}>
            <Plus />
          </SidebarGroupAction>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
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
                  <AgentItem
                    key={agent.id}
                    agent={agent}
                    chat={ownChat(agent.id, chats) ?? null}
                    href={agentChatHref(agent.id, chats)}
                    active={agent.id === activeAgentId}
                  />
                ))
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Group chats</SidebarGroupLabel>
          <SidebarGroupAction render={<Link href="/chats/new" />} title="New group chat" aria-label="New group chat">
            <Plus />
          </SidebarGroupAction>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {ready && groups.length === 0 ? (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">No group chats yet.</p>
              ) : (
                groups.map((chat) => (
                  <GroupItem key={chat.id} chat={chat} agents={agents} active={chat.id === activeChatId} />
                ))
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {error ? <p className="px-4 pb-3 text-xs text-destructive">{error}</p> : null}
      </SidebarContent>

      <SidebarFooter className="flex-row items-center gap-2 p-3">
        <NavUser />
        <Button
          variant="ghost"
          onClick={() => openSettings()}
          data-testid="sidebar-settings"
          className="h-9 flex-1 rounded-full bg-sidebar-accent/60 font-medium hover:bg-sidebar-accent"
        >
          <Settings />
          Settings
        </Button>
        {/* Icons swap in CSS: the theme is unknown on the server, so render can't branch on it. */}
        <RoundButton
          label="Toggle theme"
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          data-testid="theme-toggle"
        >
          <Sun className="hidden dark:block" />
          <Moon className="dark:hidden" />
        </RoundButton>
      </SidebarFooter>
    </Sidebar>
  );
}

/** Title as a small pill after the name, like a role tag. */
function TitlePill({ children }: { children: string }) {
  return (
    <span className="min-w-0 shrink truncate rounded-md border border-sidebar-border bg-sidebar-accent/70 px-1.5 py-px text-2xs font-normal text-muted-foreground">
      {children}
    </span>
  );
}

function AgentItem({ agent, chat, href, active }: { agent: Agent; chat: Chat | null; href: string; active: boolean }) {
  const identity = agentIdentity(agent);
  const title = identity.title || (agent.roles.length > 0 ? agent.roles.map((role) => role.name).join(", ") : "");
  const line = identity.description || (chat ? "" : "No messages yet");
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        size="lg"
        render={<Link href={href} />}
        isActive={active}
        title={identity.description ? `${identity.name} — ${identity.description}` : identity.name}
        className="h-14 gap-3 rounded-xl px-2 data-active:font-normal [&_svg]:size-5"
      >
        <AgentAvatar
          icon={identity.icon}
          color={identity.color}
          shape={identity.shape}
          picture={identity.picture}
          name={identity.name}
          size="lg"
        />
        <span className="grid min-w-0 flex-1 gap-0.5 leading-tight">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-semibold">{identity.name}</span>
            {title ? <TitlePill>{title}</TitlePill> : null}
            {chat ? (
              <span className="ml-auto shrink-0 pl-1 text-2xs text-muted-foreground tabular-nums">
                {relativeTime(chat.updatedAt)}
              </span>
            ) : null}
          </span>
          {line ? <span className="truncate text-xs text-muted-foreground">{line}</span> : null}
        </span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/** Two marks on a diagonal in the space one agent avatar takes, so group rows line up with agent rows. */
function GroupMark({ agents, active }: { agents: Agent[]; active: boolean }) {
  const [first, second] = agents.map((agent) => agentIdentity(agent));
  const mark = (identity: NonNullable<typeof first>) => (
    <AgentAvatar
      icon={identity.icon}
      color={identity.color}
      shape={identity.shape}
      picture={identity.picture}
      name={identity.name}
      size="sm"
      className="size-6.5"
    />
  );
  return (
    <span className="relative size-10 shrink-0" aria-hidden>
      {first ? <span className="absolute top-0 left-0">{mark(first)}</span> : null}
      {second ? (
        <span
          className={cn(
            "absolute right-0 bottom-0 rounded-full ring-[3px]",
            active ? "ring-sidebar-accent" : "ring-sidebar group-hover/menu-button:ring-sidebar-accent",
          )}
        >
          {mark(second)}
        </span>
      ) : null}
    </span>
  );
}

function GroupItem({ chat, agents, active }: { chat: Chat; agents: Agent[]; active: boolean }) {
  const title = chat.title || "Untitled chat";
  const people = [chat.agentId, ...chat.memberIds]
    .map((id) => agents.find((agent) => agent.id === id))
    .filter((agent): agent is Agent => Boolean(agent));
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        size="lg"
        render={<Link href={`/chats/${chat.id}`} />}
        isActive={active}
        title={people.length > 0 ? `${title} · ${people.map((agent) => agent.name).join(", ")}` : title}
        className="h-14 gap-3 rounded-xl px-2 data-active:font-normal [&_svg]:size-3.5"
      >
        <GroupMark agents={people} active={active} />
        <span className="grid min-w-0 flex-1 gap-0.5 leading-tight">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-semibold">{title}</span>
            <span className="ml-auto shrink-0 pl-1 text-2xs text-muted-foreground tabular-nums">
              {relativeTime(chat.updatedAt)}
            </span>
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {people.map((agent) => agent.name).join(", ") || "No agents"}
          </span>
        </span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
