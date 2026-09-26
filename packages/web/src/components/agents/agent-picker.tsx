"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { LayoutGrid, List, Plus } from "lucide-react";
import { AgentAvatar } from "@/components/agent-avatar";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { AgentIdentity } from "@/lib/agent-identity";
import { filterAgents } from "@/lib/agent-identity";
import { cn } from "@/lib/utils";

export type AgentPickerLayout = "grid" | "list";

export function AgentCard({
  agent,
  selected,
  onSelect,
  layout = "grid",
}: {
  agent: AgentIdentity;
  selected?: boolean;
  onSelect?: (agentId: string) => void;
  layout?: AgentPickerLayout;
}) {
  const body = (
    <>
      <AgentAvatar
        name={agent.name}
        icon={agent.icon}
        color={agent.color}
        size={layout === "grid" ? "lg" : "sm"}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium leading-tight">{agent.name}</span>
        <span
          className={cn(
            "mt-0.5 block text-xs text-muted-foreground",
            layout === "grid" ? "line-clamp-2" : "truncate",
          )}
        >
          {agent.description || "No description yet."}
        </span>
      </span>
    </>
  );

  const classes = cn(
    "w-full rounded-xl border bg-card text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    layout === "grid" ? "flex flex-col items-start gap-3 p-4" : "flex items-start gap-3 px-3 py-2.5",
    selected && "border-primary ring-2 ring-primary/20",
  );

  if (onSelect) {
    return (
      <button type="button" onClick={() => onSelect(agent.id)} className={classes} aria-pressed={selected}>
        {body}
      </button>
    );
  }

  return (
    <Link href={`/agents/${encodeURIComponent(agent.id)}`} className={cn(classes, "block")}>
      {body}
    </Link>
  );
}

export function AgentPicker({
  agents,
  selectedId,
  onSelect,
  layout = "grid",
  onLayoutChange,
  query,
  onQueryChange,
  heading = "Agents",
  emptyHint = "Create an agent to start a chat.",
  createHref = "/agents/new",
  showCreate = true,
}: {
  agents: AgentIdentity[];
  selectedId?: string | null;
  onSelect?: (agentId: string) => void;
  layout?: AgentPickerLayout;
  onLayoutChange?: (layout: AgentPickerLayout) => void;
  query?: string;
  onQueryChange?: (query: string) => void;
  heading?: string;
  emptyHint?: string;
  createHref?: string;
  showCreate?: boolean;
}) {
  const [internalQuery, setInternalQuery] = useState("");
  const [internalLayout, setInternalLayout] = useState<AgentPickerLayout>(layout);
  const search = query ?? internalQuery;
  const view = onLayoutChange ? layout : internalLayout;
  const filtered = useMemo(() => filterAgents(agents, search), [agents, search]);

  function setSearch(next: string) {
    onQueryChange?.(next);
    if (query === undefined) setInternalQuery(next);
  }

  function setView(next: AgentPickerLayout) {
    onLayoutChange?.(next);
    if (!onLayoutChange) setInternalLayout(next);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2">
        <Command shouldFilter={false} className="min-w-0 flex-1 overflow-visible rounded-lg border bg-background">
          <CommandInput value={search} onValueChange={setSearch} placeholder="Search agents…" />
        </Command>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="icon"
            variant={view === "grid" ? "secondary" : "ghost"}
            aria-label="Grid view"
            aria-pressed={view === "grid"}
            onClick={() => setView("grid")}
          >
            <LayoutGrid className="size-4" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant={view === "list" ? "secondary" : "ghost"}
            aria-label="List view"
            aria-pressed={view === "list"}
            onClick={() => setView("list")}
          >
            <List className="size-4" />
          </Button>
          {showCreate ? (
            <Button nativeButton={false} render={<Link href={createHref} />} size="sm">
              <Plus className="size-3.5" />
              New
            </Button>
          ) : null}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-16 text-center">
          <p className="text-sm font-medium">{agents.length === 0 ? heading : "No agents match."}</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {agents.length === 0 ? emptyHint : "Try a different name or description."}
          </p>
          {showCreate && agents.length === 0 ? (
            <Button nativeButton={false} render={<Link href={createHref} />} className="mt-2">
              Create agent
            </Button>
          ) : null}
        </div>
      ) : view === "grid" ? (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              selected={agent.id === selectedId}
              onSelect={onSelect}
              layout="grid"
            />
          ))}
        </div>
      ) : (
        <div className="mt-3 space-y-1">
          {filtered.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              selected={agent.id === selectedId}
              onSelect={onSelect}
              layout="list"
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function AgentPickerDialog({
  open,
  onOpenChange,
  agents,
  selectedId,
  onSelect,
  title = "Pick an agent",
  description = "One agent owns the thread. You can still pick a model profile later.",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agents: AgentIdentity[];
  selectedId?: string | null;
  onSelect: (agentId: string) => void;
  title?: string;
  description?: string;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => filterAgents(agents, query), [agents, query]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setQuery("");
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-lg p-0 sm:max-w-lg">
        <DialogHeader className="px-4 pt-4">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Command shouldFilter={false} className="border-t">
          <CommandInput placeholder="Search agents…" value={query} onValueChange={setQuery} />
          <CommandList className="max-h-80 p-2">
            <CommandEmpty>No agents match.</CommandEmpty>
            <CommandGroup>
              {filtered.map((agent) => (
                <CommandItem
                  key={agent.id}
                  value={`${agent.name} ${agent.description} ${agent.id}`}
                  data-checked={agent.id === selectedId || undefined}
                  onSelect={() => {
                    onSelect(agent.id);
                    setQuery("");
                    onOpenChange(false);
                  }}
                  className="items-start gap-3 py-2"
                >
                  <AgentAvatar name={agent.name} icon={agent.icon} color={agent.color} size="md" />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{agent.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {agent.description || "No description yet."}
                    </span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
