"use client";

import type { Agent, MemoryRecord } from "@botanical/core";
import { isUnauthorized } from "@botanical/core";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@botanical/ui/components/badge";
import { Button } from "@botanical/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@botanical/ui/components/dialog";
import { Label } from "@botanical/ui/components/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@botanical/ui/components/select";
import { Tabs, TabsList, TabsTrigger } from "@botanical/ui/components/tabs";
import { Textarea } from "@botanical/ui/components/textarea";
import { Input } from "@botanical/ui/components/input";
import { api } from "@/lib/api";
import { errorText } from "@/lib/errors";
import { relativeTime } from "@/lib/format";
import { parseTagList } from "@/lib/permissions";

export function MemoryPanel({ agents }: { agents: Agent[] }) {
  const router = useRouter();
  const [scope, setScope] = useState<"shared" | "agent">("shared");
  const [agentId, setAgentId] = useState("");
  const selectedAgent = agentId || agents[0]?.id || "";
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("");
  const [query, setQuery] = useState({ q: "", tag: "" });
  const timer = useRef<number | null>(null);
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [tags, setTags] = useState("");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<MemoryRecord | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editTags, setEditTags] = useState("");
  const [pendingDelete, setPendingDelete] = useState<MemoryRecord | null>(null);

  function schedule(nextQ: string, nextTag: string) {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setQuery({ q: nextQ, tag: nextTag }), 300);
  }

  useEffect(() => {
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  const needsAgent = scope === "agent" && !selectedAgent;

  useEffect(() => {
    if (needsAgent) return;
    let cancelled = false;
    api
      .listMemories({
        scope,
        ...(scope === "agent" ? { agentId: selectedAgent } : {}),
        ...(query.q.trim() ? { q: query.q.trim() } : {}),
        ...(query.tag.trim() ? { tag: query.tag.trim() } : {}),
        limit: 100,
      })
      .then((rows) => {
        if (cancelled) return;
        setMemories(rows);
        setError(null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (isUnauthorized(err)) {
          router.replace("/login");
          return;
        }
        setError(errorText(err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [needsAgent, query, router, scope, selectedAgent]);

  async function onAdd() {
    const text = content.trim();
    if (!text) {
      toast.error("Write a memory first.");
      return;
    }
    if (scope === "agent" && !selectedAgent) {
      toast.error("Choose an agent for this memory.");
      return;
    }
    setSaving(true);
    try {
      const created = await api.createMemory({
        scope,
        content: text,
        tags: parseTagList(tags),
        ...(scope === "agent" ? { agentId: selectedAgent } : {}),
      });
      setMemories((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      setContent("");
      setTags("");
      toast.success("Memory saved.");
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  async function onSaveEdit() {
    if (!editing) return;
    const text = editContent.trim();
    if (!text) {
      toast.error("Memory content cannot be empty.");
      return;
    }
    setSaving(true);
    try {
      const saved = await api.updateMemory(editing.id, { content: text, tags: parseTagList(editTags) });
      setMemories((current) => current.map((item) => (item.id === saved.id ? saved : item)));
      setEditing(null);
      toast.success("Memory updated.");
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!pendingDelete) return;
    setSaving(true);
    try {
      await api.deleteMemory(pendingDelete.id);
      setMemories((current) => current.filter((item) => item.id !== pendingDelete.id));
      setPendingDelete(null);
      toast.success("Memory deleted.");
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Tabs
          value={scope}
          onValueChange={(value) => {
            if (value === "shared" || value === "agent") {
              setLoading(true);
              setScope(value);
            }
          }}
        >
          <TabsList>
            <TabsTrigger value="shared">Shared</TabsTrigger>
            <TabsTrigger value="agent">Agent</TabsTrigger>
          </TabsList>
        </Tabs>
        {scope === "agent" ? (
          <Select
            items={agents.map((agent) => ({ value: agent.id, label: agent.name }))}
            value={selectedAgent || null}
            onValueChange={(value) => {
              if (!value) return;
              setLoading(true);
              setAgentId(value);
            }}
            disabled={agents.length === 0}
          >
            <SelectTrigger className="w-56" aria-label="Agent">
              <SelectValue placeholder="Choose an agent" />
            </SelectTrigger>
            <SelectContent>
              {agents.map((agent) => (
                <SelectItem key={agent.id} value={agent.id}>
                  {agent.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>

      <div className="grid gap-2 sm:grid-cols-[1fr_12rem]">
        <Input
          value={q}
          onChange={(event) => {
            setQ(event.target.value);
            schedule(event.target.value, tag);
          }}
          placeholder="Search memories"
          aria-label="Search memories"
        />
        <Input
          value={tag}
          onChange={(event) => {
            setTag(event.target.value);
            schedule(q, event.target.value);
          }}
          placeholder="Tag"
          aria-label="Filter by tag"
        />
      </div>

      <div className="space-y-2 rounded-xl border p-3">
        <Label htmlFor="memory-content">Add a memory</Label>
        <Textarea
          id="memory-content"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          rows={3}
          placeholder={scope === "shared" ? "Something every agent can recall" : "Something only this agent should recall"}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder="tags, comma separated"
            aria-label="Tags"
            className="max-w-xs"
          />
          <Button type="button" onClick={() => void onAdd()} disabled={saving || (scope === "agent" && !selectedAgent)}>
            Add
          </Button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {needsAgent ? (
        <EmptyState
          title="No agents"
          body="Create an agent before storing a private memory."
          className="min-h-32 rounded-xl border border-dashed"
        />
      ) : loading ? (
        <p className="text-sm text-muted-foreground">Loading memories…</p>
      ) : memories.length === 0 ? (
        <EmptyState
          title="No memories"
          body={query.q || query.tag ? "Nothing matches that search." : "Save a note and it will show up here."}
          className="min-h-32 rounded-xl border border-dashed"
        />
      ) : (
        <ul className="space-y-2">
          {memories.map((memory) => (
            <li key={memory.id} className="rounded-xl border px-3 py-3">
              <p className="text-sm whitespace-pre-wrap">{memory.content}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {memory.tags.map((item) => (
                  <Badge key={item} variant="outline">
                    {item}
                  </Badge>
                ))}
                <time className="ml-auto shrink-0 text-xs whitespace-nowrap text-muted-foreground" dateTime={memory.updatedAt}>
                  {relativeTime(memory.updatedAt)}
                </time>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setEditing(memory);
                    setEditContent(memory.content);
                    setEditTags(memory.tags.join(", "));
                  }}
                >
                  Edit
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setPendingDelete(memory)}>
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit memory</DialogTitle>
            <DialogDescription>Update the note and its tags.</DialogDescription>
          </DialogHeader>
          <Textarea value={editContent} onChange={(event) => setEditContent(event.target.value)} rows={5} />
          <Input value={editTags} onChange={(event) => setEditTags(event.target.value)} aria-label="Tags" placeholder="tags, comma separated" />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button type="button" disabled={saving} onClick={() => void onSaveEdit()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this memory?</DialogTitle>
            <DialogDescription>Agents will stop seeing it on the next turn.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" disabled={saving} onClick={() => void onDelete()}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
