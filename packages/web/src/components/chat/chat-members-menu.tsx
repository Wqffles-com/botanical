"use client";

import type { Agent } from "@botanical/core";
import { Users } from "lucide-react";
import { useState } from "react";
import { Button } from "@botanical/ui/components/button";
import { Checkbox } from "@botanical/ui/components/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@botanical/ui/components/popover";
import { AgentAvatar } from "@/components/agent-avatar";
import { agentIdentity } from "@/lib/agent-identity";
import { MAX_CHAT_MEMBERS, toggleMember } from "@/lib/chat-members";
import { cn } from "@/lib/utils";

/**
 * Header control for a chat's group members: the agents that answer beside the owner.
 * Changes save at once. Locked while an agent works.
 */
export function ChatMembersMenu({
  owner,
  agents,
  memberIds,
  disabled,
  onChange,
}: {
  owner: Agent;
  agents: Agent[];
  memberIds: string[];
  disabled?: boolean;
  onChange: (memberIds: string[]) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const members = memberIds.map((id) => byId.get(id)).filter((agent): agent is Agent => Boolean(agent));
  const candidates = agents.filter((agent) => agent.id !== owner.id);
  const full = memberIds.length >= MAX_CHAT_MEMBERS;
  const label = `${members.length + 1} agents`;

  const toggle = async (id: string) => {
    setSaving(true);
    try {
      await onChange(toggleMember(memberIds, id));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            data-testid="chat-members"
            aria-label={members.length > 0 ? `Group members, ${members.length + 1} agents` : "Add agents to this chat"}
          />
        }
      >
        {members.length > 0 ? (
          <span className="flex -space-x-1.5">
            {[owner, ...members].slice(0, 4).map((agent) => {
              const identity = agentIdentity(agent);
              return (
                <AgentAvatar
                  key={agent.id}
                  name={identity.name}
                  icon={identity.icon}
                  color={identity.color}
                  shape={identity.shape}
                  picture={identity.picture}
                  size="sm"
                  className="ring-2 ring-background"
                />
              );
            })}
          </span>
        ) : (
          <Users className="size-4" />
        )}
        <span className="hidden sm:inline">{label}</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <PopoverHeader className="border-b px-3 py-2">
          <PopoverTitle>Group members</PopoverTitle>
          <PopoverDescription className="text-xs">
            Everyone answers in turn. Mention an agent with @Name to ask only that agent.
          </PopoverDescription>
        </PopoverHeader>
        <div className="max-h-80 space-y-1 overflow-y-auto p-2">
          <MemberRow agent={owner} note="Owner" checked disabled />
          {candidates.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">Create another agent to make this a group chat.</p>
          ) : (
            candidates.map((agent) => {
              const checked = memberIds.includes(agent.id);
              // A group chat keeps at least one member. The owner's own chat is where it talks alone.
              const last = checked && memberIds.length === 1;
              return (
                <MemberRow
                  key={agent.id}
                  agent={agent}
                  checked={checked}
                  disabled={disabled || saving || last || (!checked && full)}
                  onToggle={() => void toggle(agent.id)}
                />
              );
            })
          )}
        </div>
        {disabled ? (
          <p className="border-t px-3 py-2 text-xs text-muted-foreground">Wait for the agents to finish to change members.</p>
        ) : full ? (
          <p className="border-t px-3 py-2 text-xs text-muted-foreground">A chat can have up to {MAX_CHAT_MEMBERS + 1} agents.</p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function MemberRow({
  agent,
  checked,
  disabled,
  note,
  onToggle,
}: {
  agent: Agent;
  checked: boolean;
  disabled?: boolean;
  note?: string;
  onToggle?: () => void;
}) {
  const identity = agentIdentity(agent);
  const id = `chat-member-${agent.id}`;
  return (
    <label
      htmlFor={id}
      data-testid="chat-member-option"
      className={cn(
        "flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-accent/50",
        disabled && "cursor-default hover:bg-transparent",
      )}
    >
      <Checkbox id={id} checked={checked} disabled={disabled} onCheckedChange={() => onToggle?.()} />
      <AgentAvatar
        name={identity.name}
        icon={identity.icon}
        color={identity.color}
        shape={identity.shape}
        picture={identity.picture}
        size="sm"
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{identity.name}</span>
        {identity.title ? <span className="block truncate text-xs text-muted-foreground">{identity.title}</span> : null}
      </span>
      {note ? <span className="text-xs text-muted-foreground">{note}</span> : null}
    </label>
  );
}
