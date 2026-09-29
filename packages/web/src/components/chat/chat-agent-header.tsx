"use client";

import type { Agent } from "@botanical/core";
import { ChevronDown, MessageSquare, Settings2 } from "lucide-react";
import Link from "next/link";
import { AgentAvatar } from "@/components/agent-avatar";
import { AgentStack } from "@/components/agent-stack";
import { useAppDialogs } from "@/components/app-dialogs";
import { RoleBadges } from "@/components/role-badges";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@botanical/ui/components/dropdown-menu";
import type { AgentIdentity } from "@/lib/agent-identity";
import { agentChatHref } from "@/lib/chat-groups";
import { useWorkspace } from "@/components/workspace-provider";

/**
 * The chat's name as a pill in the middle of the shell header. It opens a menu with the agent's
 * details and its settings dialog.
 */
export function ChatAgentHeader({
  agent,
  title,
  creator,
  members,
}: {
  agent: AgentIdentity | null | undefined;
  title?: string;
  creator?: Agent | null;
  /** The other agents in a group chat. */
  members?: Agent[];
}) {
  const { openAgent } = useAppDialogs();
  const { agents, chats } = useWorkspace();

  if (!agent) {
    return (
      <span className="flex h-9 max-w-full items-center truncate rounded-full px-4 text-sm font-medium">
        {title ?? "Chat"}
      </span>
    );
  }

  const group = Boolean(members && members.length > 0);
  const owner = agents.find((item) => item.id === agent.id);
  const label = group && title ? title : agent.name;
  const subtitle = group
    ? `With ${(members ?? []).map((member) => member.name).join(", ")}`
    : agent.title || agent.description;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-testid="chat-agent-pill"
        className="flex h-9 max-w-full min-w-0 items-center gap-2 rounded-full bg-bubble py-1 pr-3 pl-1.5 text-sm font-medium outline-none transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 data-popup-open:bg-accent"
      >
        {group && owner ? (
          <AgentStack agents={[owner, ...(members ?? [])]} ring="ring-bubble" />
        ) : (
          <AgentAvatar
            name={agent.name}
            icon={agent.icon}
            color={agent.color}
            shape={agent.shape}
            picture={agent.picture}
            size="sm"
          />
        )}
        <span className="truncate">{label}</span>
        {!group && agent.title ? (
          <span className="hidden truncate font-normal text-muted-foreground sm:inline">{agent.title}</span>
        ) : null}
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" sideOffset={6} className="w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-start gap-2.5 px-2 py-2 font-normal">
            <AgentAvatar
              name={agent.name}
              icon={agent.icon}
              color={agent.color}
              shape={agent.shape}
              picture={agent.picture}
            />
            <span className="grid min-w-0 flex-1 gap-1 leading-tight">
              <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                <span className="truncate text-sm font-medium text-foreground">{agent.name}</span>
                <RoleBadges roles={agent.roles} />
              </span>
              {subtitle ? <span className="line-clamp-2 text-xs">{subtitle}</span> : null}
              {agent.createdByAgentId ? (
                <span className="text-xs">Created by {creator?.name ?? "another agent"}</span>
              ) : null}
            </span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => openAgent(agent.id)} data-testid="open-agent-settings">
          <Settings2 />
          {agent.name} settings
        </DropdownMenuItem>
        {group ? (
          <DropdownMenuItem render={<Link href={agentChatHref(agent.id, chats)} />}>
            <MessageSquare />
            Chat with {agent.name} alone
          </DropdownMenuItem>
        ) : null}
        {agent.createdByAgentId ? (
          <DropdownMenuItem render={<Link href={agentChatHref(agent.createdByAgentId, chats)} />}>
            <MessageSquare />
            Open {creator?.name ?? "creator"}&apos;s chat
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
