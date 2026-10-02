"use client";

import {
  Bot,
  CalendarClock,
  Gauge,
  Inbox,
  MessageSquare,
  Monitor,
  Moon,
  Plus,
  Settings,
  Sun,
  Webhook,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { MessageSearchHit } from "@botanical/core";
import { api } from "@/lib/api";
import { AgentAvatar } from "@/components/agent-avatar";
import { useAppDialogs } from "@/components/app-dialogs";
import { useWorkspace } from "@/components/workspace-provider";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@botanical/ui/components/command";
import { agentChatHref, groupChats } from "@/lib/chat-groups";
import { agentIdentity } from "@/lib/agent-identity";
import { relativeTime } from "@/lib/format";

const PAGES = [
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/routines", label: "Routines", icon: CalendarClock },
  { href: "/listeners", label: "Listeners", icon: Webhook },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/usage", label: "Usage", icon: Gauge },
] as const;

/** ⌘K palette: jump to an agent, a chat, or a page, or run a quick action. */
export function CommandMenu({ trigger }: { trigger?: (open: () => void) => ReactNode }) {
  const router = useRouter();
  const { setTheme } = useTheme();
  const { agents, chats } = useWorkspace();
  const { openAgent, openSettings } = useAppDialogs();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<MessageSearchHit[]>([]);

  // Message text is searched on the server, so wait for a pause in typing before asking.
  useEffect(() => {
    const q = query.trim();
    if (!open || q.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api
        .searchMessages({ q, limit: 8 }, { signal: controller.signal })
        .then(setHits)
        .catch(() => {
          if (!controller.signal.aborted) setHits([]);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, open]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const shown = open && query.trim().length >= 2 ? hits : [];
  const recent = useMemo(() => groupChats(chats).slice(0, 12), [chats]);
  const agentName = useMemo(() => new Map(agents.map((agent) => [agent.id, agent.name])), [agents]);

  function go(href: string) {
    setOpen(false);
    setQuery("");
    router.push(href);
  }

  function run(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <>
      {trigger ? trigger(() => setOpen(true)) : null}
      <CommandDialog open={open} onOpenChange={setOpen} title="Search" description="Jump to an agent, chat, or page">
        <Command>
          <CommandInput placeholder="Search agents, chats, pages, and messages…" value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>No results.</CommandEmpty>
            <CommandGroup heading="Actions">
              <CommandItem value="new chat" onSelect={() => go("/chats/new")}>
                <Plus />
                New chat
              </CommandItem>
              <CommandItem value="new agent" onSelect={() => run(() => openAgent(null))}>
                <Bot />
                New agent
              </CommandItem>
            </CommandGroup>
            {agents.length > 0 ? (
              <CommandGroup heading="Agents">
                {agents.map((agent) => {
                  const identity = agentIdentity(agent);
                  return (
                    <CommandItem
                      key={agent.id}
                      value={`agent ${identity.name} ${identity.title}`}
                      onSelect={() => go(agentChatHref(agent.id, chats))}
                    >
                      <AgentAvatar
                        icon={identity.icon}
                        color={identity.color}
                        shape={identity.shape}
                        picture={identity.picture}
                        name={identity.name}
                        size="sm"
                        className="size-5"
                      />
                      <span className="truncate">{identity.name}</span>
                      {identity.title ? (
                        <span className="truncate text-xs text-muted-foreground">{identity.title}</span>
                      ) : null}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ) : null}
            {recent.length > 0 ? (
              <CommandGroup heading="Group chats">
                {recent.map((chat) => (
                  <CommandItem
                    key={chat.id}
                    value={`chat ${chat.title} ${agentName.get(chat.agentId) ?? ""} ${chat.id}`}
                    onSelect={() => go(`/chats/${chat.id}`)}
                  >
                    <MessageSquare />
                    <span className="truncate">{chat.title || "Untitled chat"}</span>
                    <CommandShortcut>{relativeTime(chat.updatedAt)}</CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {shown.length > 0 ? (
              <CommandGroup heading="Messages">
                {shown.map((hit) => (
                  <CommandItem
                    key={hit.message.id}
                    forceMount
                    value={`message ${hit.message.id}`}
                    onSelect={() => go(`/chats/${hit.message.chatId}?message=${encodeURIComponent(hit.message.id)}`)}
                  >
                    <MessageSquare />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm">
                        <Snippet snippet={hit.snippet} />
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {agentName.get(hit.agentId) ?? "Agent"}
                        {hit.message.role === "user" ? " · You" : ""}
                      </span>
                    </span>
                    <CommandShortcut>{relativeTime(hit.message.createdAt)}</CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            <CommandSeparator />
            <CommandGroup heading="Pages">
              {PAGES.map(({ href, label, icon: Icon }) => (
                <CommandItem key={href} value={`page ${label}`} onSelect={() => go(href)}>
                  <Icon />
                  {label}
                </CommandItem>
              ))}
              <CommandItem value="page settings" onSelect={() => run(() => openSettings())}>
                <Settings />
                Settings
              </CommandItem>
            </CommandGroup>
            <CommandGroup heading="Theme">
              <CommandItem value="theme light" onSelect={() => run(() => setTheme("light"))}>
                <Sun />
                Light
              </CommandItem>
              <CommandItem value="theme dark" onSelect={() => run(() => setTheme("dark"))}>
                <Moon />
                Dark
              </CommandItem>
              <CommandItem value="theme system" onSelect={() => run(() => setTheme("system"))}>
                <Monitor />
                System
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}

/** A message snippet with the matched text marked. */
function Snippet({ snippet }: { snippet: MessageSearchHit["snippet"] }) {
  const { text, start, end } = snippet;
  if (end <= start) return <>{text}</>;
  return (
    <>
      {text.slice(0, start)}
      <mark className="rounded-sm bg-primary/20 text-foreground">{text.slice(start, end)}</mark>
      {text.slice(end)}
    </>
  );
}
