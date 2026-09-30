"use client";

import { ConfirmDialog } from "@botanical/ui/components/alert-dialog";
import { Bot, Brain } from "lucide-react";
import type { Agent, MemoryRecord } from "@botanical/core";
import { isUnauthorized } from "@botanical/core";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@botanical/ui/components/empty-state";
import { Button } from "@botanical/ui/components/button";
import { Label } from "@botanical/ui/components/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@botanical/ui/components/select";
import { Tabs, TabsList, TabsTrigger } from "@botanical/ui/components/tabs";
import { Textarea } from "@botanical/ui/components/textarea";
import { Input } from "@botanical/ui/components/input";
import { api } from "@/lib/api";
import { errorText } from "@/lib/errors";
import { MemoryDialog } from "@/components/memory/memory-dialog";
import { MemoryRow } from "@/components/memory/memory-row";
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
  const [viewing, setViewing] = useState<MemoryRecord | null>(null);
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

  async function onSaveEdit(memory: MemoryRecord, patch: { content: string; tags: string }): Promise<boolean> {
    const text = patch.content.trim();
    if (!text) {
      toast.error("Memory content cannot be empty.");
      return false;
    }
    setSaving(true);
    try {
      const saved = await api.updateMemory(memory.id, { content: text, tags: parseTagList(patch.tags) });
      setMemories((current) => current.map((item) => (item.id === saved.id ? saved : item)));
      setViewing(saved);
      toast.success("Memory updated.");
      return true;
    } catch (err) {
      toast.error(errorText(err));
      return false;
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
      setViewing(null);
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
          icon={Bot}
          title="No agents"
          body="Create an agent before storing a private memory."
          bordered
        />
      ) : loading ? (
        <p className="text-sm text-muted-foreground">Loading memories…</p>
      ) : memories.length === 0 ? (
        <EmptyState
          icon={Brain}
          title="No memories"
          body={query.q || query.tag ? "Nothing matches that search." : "Save a note and it will show up here."}
          bordered
        />
      ) : (
        <ul className="space-y-1.5" data-testid="memory-list">
          {memories.map((memory) => (
            <li key={memory.id}>
              <MemoryRow memory={memory} onOpen={setViewing} />
            </li>
          ))}
        </ul>
      )}

      <MemoryDialog
        memory={viewing}
        scopeLabel={viewing?.scope === "agent" ? `${agents.find((agent) => agent.id === viewing.agentId)?.name ?? "Agent"}'s memory` : "Shared memory"}
        onOpenChange={(open) => !open && setViewing(null)}
        onSave={onSaveEdit}
        onDelete={setPendingDelete}
        saving={saving}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="Delete this memory?"
        description="Agents will stop seeing it on the next turn."
        pending={saving}
        pendingLabel="Deleting…"
        onConfirm={() => void onDelete()}
      />
    </div>
  );
}
