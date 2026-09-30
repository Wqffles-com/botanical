"use client";

import { useAppDialogs } from "@/components/app-dialogs";
import { MemoryDialog } from "@/components/memory/memory-dialog";
import { MemoryRow } from "@/components/memory/memory-row";
import type { Agent, Chat, ChatMessage, MemoryRecord, ModelProfile, WorkspaceFile, WorkspaceListing } from "@botanical/core";
import { ArrowLeft, Brain, File, Folder, FolderOpen, Link2, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "@botanical/ui/components/button";
import { EmptyState } from "@botanical/ui/components/empty-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@botanical/ui/components/select";
import { Skeleton } from "@botanical/ui/components/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@botanical/ui/components/tabs";
import { api } from "@/lib/api";
import { chatDetails, formatBytes, formatCount, parentPath } from "@/lib/chat-details";
import { errorText } from "@/lib/errors";
import { profileLabel, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export type ChatPanelTab = "files" | "memory" | "details";

/**
 * Right-hand chat sidebar: the agent's workspace files, the memory it recalls,
 * and facts about this chat. Read-only; editing lives on the settings pages.
 */
export function ChatSidePanel({
  chat,
  participants,
  messages,
  profile,
  className,
}: {
  chat: Chat;
  /** Owner first, then group members in speaking order. */
  participants: Agent[];
  messages: ChatMessage[];
  profile: ModelProfile | null;
  className?: string;
}) {
  const [tab, setTab] = useState<ChatPanelTab>("files");
  const [agentId, setAgentId] = useState(chat.agentId);
  const selected = participants.find((agent) => agent.id === agentId) ?? participants[0] ?? null;
  // A new row may mean the agent wrote a file or saved a memory; refetch then.
  const revision = messages.length;

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => setTab(value as ChatPanelTab)}
      className={cn("flex h-full min-h-0 flex-col gap-0", className)}
      data-testid="chat-side-panel"
    >
      <div className="flex h-12 shrink-0 items-center border-b px-3">
        <TabsList className="w-full">
          <TabsTrigger value="files">Files</TabsTrigger>
          <TabsTrigger value="memory">Memory</TabsTrigger>
          <TabsTrigger value="details">Details</TabsTrigger>
        </TabsList>
      </div>
      {participants.length > 1 && tab !== "details" ? (
        <div className="shrink-0 border-b px-3 py-2">
          <Select
            items={participants.map((agent) => ({ value: agent.id, label: agent.name }))}
            value={selected?.id ?? null}
            onValueChange={(value) => {
              if (value) setAgentId(value);
            }}
          >
            <SelectTrigger className="w-full" size="sm" aria-label="Agent">
              <SelectValue placeholder="Choose an agent" />
            </SelectTrigger>
            <SelectContent>
              {participants.map((agent) => (
                <SelectItem key={agent.id} value={agent.id}>
                  {agent.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      <TabsContent value="files" className="min-h-0 flex-1 overflow-y-auto">
        {selected ? <FilesTab key={selected.id} agent={selected} revision={revision} /> : null}
      </TabsContent>
      <TabsContent value="memory" className="min-h-0 flex-1 overflow-y-auto">
        {selected ? <MemoryTab key={selected.id} agent={selected} revision={revision} /> : null}
      </TabsContent>
      <TabsContent value="details" className="min-h-0 flex-1 overflow-y-auto">
        <DetailsTab chat={chat} participants={participants} messages={messages} profile={profile} />
      </TabsContent>
    </Tabs>
  );
}

function FilesTab({ agent, revision }: { agent: Agent; revision: number }) {
  const [dir, setDir] = useState(".");
  const [listing, setListing] = useState<WorkspaceListing | null>(null);
  const [open, setOpen] = useState<WorkspaceFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .listAgentFiles(agent.id, dir === "." ? undefined : dir)
      .then((next) => {
        if (cancelled) return;
        setListing(next);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorText(err));
      });
    return () => {
      cancelled = true;
    };
  }, [agent.id, dir, revision, reload]);

  async function openFile(path: string) {
    try {
      setOpen(await api.readAgentFile(agent.id, path));
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  }

  if (open) {
    return (
      <div className="flex min-h-full flex-col">
        <PanelBar>
          <Button variant="ghost" size="icon-sm" aria-label="Back to files" onClick={() => setOpen(null)}>
            <ArrowLeft />
          </Button>
          <span className="min-w-0 flex-1 truncate font-mono text-xs" title={open.path}>
            {open.path}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(open.bytes)}</span>
        </PanelBar>
        <pre className="flex-1 overflow-x-auto p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
          {open.content || <span className="text-muted-foreground">Empty file</span>}
        </pre>
      </div>
    );
  }

  const up = parentPath(dir);
  return (
    <div className="flex min-h-full flex-col">
      <PanelBar>
        {up !== null ? (
          <Button variant="ghost" size="icon-sm" aria-label="Up one folder" onClick={() => setDir(up)}>
            <ArrowLeft />
          </Button>
        ) : (
          <FolderOpen className="ml-1 size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-xs" title={dir}>
          {dir === "." ? "/" : `/${dir}`}
        </span>
        <Button variant="ghost" size="icon-sm" aria-label="Refresh files" onClick={() => setReload((n) => n + 1)}>
          <RefreshCw />
        </Button>
      </PanelBar>
      {error ? (
        <p role="alert" className="px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {!listing && !error ? (
        <PanelSkeleton />
      ) : listing && listing.entries.length === 0 ? (
        <EmptyState
          icon={Folder}
          title="No files yet"
          body={`Files ${agent.name} writes show up here.`}
          className="flex-1 px-4"
        />
      ) : (
        <ul className="py-1" data-testid="workspace-files">
          {sortEntries(listing?.entries ?? []).map((entry) => (
            <li key={entry.path}>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted disabled:cursor-default disabled:hover:bg-transparent"
                disabled={entry.type !== "file" && entry.type !== "directory"}
                onClick={() => (entry.type === "directory" ? setDir(entry.path) : void openFile(entry.path))}
              >
                {entry.type === "directory" ? (
                  <Folder className="size-4 shrink-0 text-muted-foreground" />
                ) : entry.type === "symlink" ? (
                  <Link2 className="size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <File className="size-4 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {entry.type === "file" ? formatBytes(entry.size) : relativeTime(entry.modifiedAt)}
                </span>
              </button>
            </li>
          ))}
          {listing?.truncated ? (
            <li className="px-3 py-1.5 text-xs text-muted-foreground">More entries not shown.</li>
          ) : null}
        </ul>
      )}
    </div>
  );
}

function sortEntries<T extends { type: string; name: string }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => {
    const dirA = a.type === "directory" ? 0 : 1;
    const dirB = b.type === "directory" ? 0 : 1;
    return dirA - dirB || a.name.localeCompare(b.name);
  });
}

function MemoryTab({ agent, revision }: { agent: Agent; revision: number }) {
  const { openSettings } = useAppDialogs();
  const [shared, setShared] = useState<MemoryRecord[] | null>(null);
  const [own, setOwn] = useState<MemoryRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<MemoryRecord | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.listMemories({ scope: "shared", limit: 100 }),
      api.listMemories({ scope: "agent", agentId: agent.id, limit: 100 }),
    ])
      .then(([sharedRows, agentRows]) => {
        if (cancelled) return;
        setShared(sharedRows);
        setOwn(agentRows);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorText(err));
      });
    return () => {
      cancelled = true;
    };
  }, [agent.id, revision]);

  if (error) {
    return (
      <p role="alert" className="px-3 py-2 text-xs text-destructive">
        {error}
      </p>
    );
  }
  if (!shared || !own) return <PanelSkeleton />;

  return (
    <div className="flex flex-col gap-4 py-3" data-testid="chat-memory">
      <MemorySection
        title={`${agent.name}'s memory`}
        rows={own}
        empty={`${agent.name} has not saved anything yet.`}
        onOpen={setViewing}
      />
      <MemorySection
        title="Global memory"
        rows={shared}
        empty="No shared memories. Every agent can read these."
        onOpen={setViewing}
      />
      <p className="px-3 text-xs text-muted-foreground">
        Edit memories in{" "}
        <button
          type="button"
          onClick={() => openSettings("memory")}
          className="underline underline-offset-2 hover:text-foreground"
        >
          Settings
        </button>
        .
      </p>
      <MemoryDialog
        memory={viewing}
        scopeLabel={viewing?.scope === "agent" ? `${agent.name}'s memory` : "Global memory"}
        onOpenChange={(open) => !open && setViewing(null)}
        footer={
          <button
            type="button"
            onClick={() => {
              setViewing(null);
              openSettings("memory");
            }}
            className="underline underline-offset-2 hover:text-foreground"
          >
            Edit in Settings
          </button>
        }
      />
    </div>
  );
}

function MemorySection({
  title,
  rows,
  empty,
  onOpen,
}: {
  title: string;
  rows: MemoryRecord[];
  empty: string;
  onOpen: (memory: MemoryRecord) => void;
}) {
  return (
    <section>
      <h3 className="flex items-center gap-1.5 px-3 pb-1.5 text-xs font-medium text-muted-foreground">
        <Brain className="size-3.5" />
        {title}
        <span className="ml-auto tabular-nums">{rows.length}</span>
      </h3>
      {rows.length === 0 ? (
        <p className="px-3 text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-1 px-3">
          {rows.map((memory) => (
            <li key={memory.id}>
              <MemoryRow memory={memory} onOpen={onOpen} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DetailsTab({
  chat,
  participants,
  messages,
  profile,
}: {
  chat: Chat;
  participants: Agent[];
  messages: ChatMessage[];
  profile: ModelProfile | null;
}) {
  const details = useMemo(() => chatDetails(messages), [messages]);
  const rows: Array<[string, ReactNode]> = [
    ["Messages", formatCount(details.messages)],
    ["From you", formatCount(details.user)],
    ["Replies", formatCount(details.assistant)],
    ["Tool calls", formatCount(details.toolCalls)],
    [
      "Context length",
      details.contextTokens === null ? "Not reported" : `${formatCount(details.contextTokens)} tokens`,
    ],
    ["Input tokens", formatCount(details.inputTokens)],
    ["Output tokens", formatCount(details.outputTokens)],
    ["Characters", formatCount(details.characters)],
    ["Model", profile ? profileLabel(profile) : "None selected"],
    [participants.length > 1 ? "Agents" : "Agent", participants.map((agent) => agent.name).join(", ") || "—"],
    ["Created", formatDate(chat.createdAt)],
    ["Last message", details.lastAt ? formatDate(details.lastAt) : "—"],
  ];
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 p-3 text-sm" data-testid="chat-details">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 text-right break-words tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function PanelBar({ children }: { children: ReactNode }) {
  return <div className="sticky top-0 z-10 flex h-10 items-center gap-1 border-b bg-background px-2">{children}</div>;
}

function PanelSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-3">
      <Skeleton className="h-5 w-3/4" />
      <Skeleton className="h-5 w-1/2" />
      <Skeleton className="h-5 w-2/3" />
    </div>
  );
}
