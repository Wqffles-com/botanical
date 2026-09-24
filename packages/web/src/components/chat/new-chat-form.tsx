"use client";

import type { Agent, ModelProfile } from "@botanical/core";
import Link from "next/link";
import { useMemo, useState } from "react";
import { AgentAvatar } from "@/components/agents/agent-avatar";
import { ProfileSelect } from "@/components/chat/profile-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { canStartChat } from "@/lib/chat-groups";
import { cn } from "@/lib/utils";

export function NewChatForm({
  agents,
  profiles,
  initialAgentId,
  pending,
  error,
  onSubmit,
}: {
  agents: Agent[];
  profiles: ModelProfile[];
  initialAgentId?: string | null;
  pending?: boolean;
  error?: string | null;
  onSubmit: (input: { agentId: string; profileId: string; title: string }) => void;
}) {
  const [query, setQuery] = useState("");
  const [agentId, setAgentId] = useState<string | null>(initialAgentId ?? null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const ready = canStartChat(agentId, profileId);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter(
      (agent) => agent.name.toLowerCase().includes(q) || agent.description.toLowerCase().includes(q),
    );
  }, [agents, query]);

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col gap-6 px-6 py-8">
      <header>
        <h1 className="font-heading text-3xl tracking-tight">New chat</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Each chat belongs to one agent and runs on the model profile you choose. There is no default model.
        </p>
      </header>

      <section className="space-y-2">
        <Label>Agent</Label>
        {agents.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Create an agent first, then come back.{" "}
            <Link href="/agents/new" className="text-primary underline-offset-2 hover:underline">
              New agent
            </Link>
          </p>
        ) : (
          <>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter agents"
            />
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Agent">
              {filtered.map((agent) => {
                const selected = agent.id === agentId;
                const identity = agent as Agent & { icon?: string; color?: string };
                return (
                  <button
                    key={agent.id}
                    type="button"
                    data-testid="agent-option"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setAgentId(agent.id)}
                    className={cn(
                      "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                      selected
                        ? "border-primary/55 bg-primary/8"
                        : "border-border hover:border-border hover:bg-muted/60",
                    )}
                  >
                    <AgentAvatar name={agent.name} icon={identity.icon} color={identity.color} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{agent.name}</span>
                      <span className="mt-0.5 block text-[12.5px] text-muted-foreground">
                        {agent.description || "No description"}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            {filtered.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No agents match.</p>
            ) : null}
          </>
        )}
      </section>

      <section className="space-y-2">
        <Label htmlFor="new-chat-profile">Model profile</Label>
        <ProfileSelect
          id="new-chat-profile"
          profiles={profiles}
          value={profileId}
          onChange={setProfileId}
          needed={!profileId}
        />
        {profiles.length === 0 ? (
          <p className="text-sm text-muted-foreground">Add a model profile on the server, then refresh.</p>
        ) : null}
      </section>

      <section className="space-y-2">
        <Label htmlFor="new-chat-title">Title</Label>
        <Input
          id="new-chat-title"
          value={title}
          placeholder="Optional"
          onChange={(event) => setTitle(event.target.value)}
        />
      </section>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button
          data-testid="start-chat"
          disabled={!ready || pending}
          onClick={() => {
            if (!agentId || !profileId) return;
            onSubmit({ agentId, profileId, title });
          }}
        >
          {pending ? "Starting…" : "Start chat"}
        </Button>
        <ul className="text-[12.5px] text-muted-foreground">
          <li className={agentId ? "text-foreground" : undefined}>Choose one agent for this chat.</li>
          <li className={profileId ? "text-foreground" : undefined}>Choose a model profile for this chat.</li>
        </ul>
      </div>
    </div>
  );
}
